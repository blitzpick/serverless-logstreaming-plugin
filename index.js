/* eslint-disable strict */
"use strict";

const _ = require("lodash");

module.exports = S => {
    class LogStreamingPlugin extends S.classes.Plugin {
        constructor() {
            super();
            this.name = "LogStreaming";
        }

        registerActions() {
            S.addAction(this._fixLogStreaming.bind(this), {
                handler: "fixLogStreaming",
                description: "Fixes the log streaming for all deployed functions",
                context: "logStreaming",
                contextAction: "fix",
                options: [
                    {
                        option: "stage",
                        shortcut: "s",
                        description: "Name of the stage to use"
                    },
                    {
                        option: "region",
                        shortcut: "r",
                        description: "Name of the region to use"
                    }
                ],
                parameters: []
            });

            return Promise.resolve();
        }

        registerHooks() {
            S.addHook(this._postDeploy.bind(this), {
                action: "functionDeploy",
                event: "post"
            });

            return Promise.resolve();
        }

        _fixLogStreaming(evt) {
            return new Promise((resolve, reject) => {
                try {
                    const project = S.getProject();
                    const aws = S.getProvider("aws");
                    const options = getStageAndRegion(evt, project);
                    const functionNames = _(project.getAllFunctions())
                        .map(func => func.getDeployedName(options))
                        .value();

                    return configureLogging(project, aws, functionNames, options)
                        .then(() => {
                            return resolve(evt);
                        });
                } catch (err) {
                    reject(err);
                }
            });
        }

        _postDeploy(evt) {
            return new Promise((resolve, reject) => {
                try {
                    const project = S.getProject();
                    const aws = S.getProvider("aws");
                    const options = getStageAndRegion(evt, project);
                    const functionNames = _(evt.data.deployed)
                        .flatMap()
                        .map(item => {
                            return item.lambdaName;
                        })
                        .value();

                    return configureLogging(project, aws, functionNames, options)
                        .then(() => {
                            return resolve(evt);
                        });
                } catch (err) {
                    reject(err);
                }
            });
        }
    }

    // Export Plugin Class
    return LogStreamingPlugin;
};

function delay(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function configureLogging(project, aws, functionNames, options) {
    const awsAccountId = aws.getAccountId(options.stage, options.region);

    const loggingFunctionName = getLoggingFunctionName(project, options);

    return removeLogStreamingPermissions(aws, options, loggingFunctionName, awsAccountId)
        .then(() => delay(1000)) // Give lambda a moment to realize the change.
        .then(() => {
            return addLogStreamingPermissions(aws, options, loggingFunctionName, awsAccountId);
        })
        .then(() => delay(1000)) // Give lambda a moment to realize the change.
        .then(() => {
            const logGroupNames = _(functionNames)
                .without(loggingFunctionName)
                .map(functionName => `/aws/lambda/${functionName}`)
                .value();

            let promise = Promise.resolve();
            _.each(logGroupNames, logGroupName => {
                promise = promise
                    .then(() => createLogGroup(aws, logGroupName, options))
                    .then(() => delay(50)) // Ensure we don't blow through the API throttling rate
                    .then(() => setLogGroupStreaming(aws, logGroupName, loggingFunctionName, awsAccountId, options))
                    .then(() => delay(50)); // Ensure we don't blow through the API throttling rate
            });

            return promise;
        });
}

function createLogGroup(aws, logGroupName, options) {
    const params = {
        logGroupName
    };

    return aws.request("CloudWatchLogs", "createLogGroup", params, options.stage, options.region)
        .catch(() => false);
}

function setLogGroupStreaming(aws, logGroupName, loggingFunctionName, awsAccountId, options) {
    const arn = getFunctionArn(loggingFunctionName, awsAccountId, options);

    const params = {
        destinationArn: arn,
        filterName: loggingFunctionName,
        filterPattern: "",
        logGroupName
    };

    return aws.request("CloudWatchLogs", "putSubscriptionFilter", params, options.stage, options.region);
}

function getFunctionArn(functionName, awsAccountId, options) {
    return `arn:aws:lambda:${options.region}:${awsAccountId}:function:${functionName}`;
}

function getLoggingFunctionName(project, options) {
    if (!project.custom.logStreaming.functionName) {
        throw new Error("The function name must be specified in s-project.json, under custom.logStreaming.functionName");
    }

    if (project.custom.logStreaming.external && project.custom.logStreaming.external === true) {
        return project.custom.logStreaming.functionName;
    }
    else {
        return project.getFunction(project.custom.logStreaming.functionName).getDeployedName(options);
    }
}

function removeLogStreamingPermissions(aws, options, loggingFunctionName, awsAccountId) {
    const arn = getFunctionArn(loggingFunctionName, awsAccountId, options);

    const params = {
        FunctionName: arn,
        StatementId: loggingFunctionName
    };

    return aws.request("Lambda", "removePermission", params, options.stage, options.region)
        .catch(() => false);
}

function addLogStreamingPermissions(aws, options, loggingFunctionName, awsAccountId) {
    const arn = getFunctionArn(loggingFunctionName, awsAccountId, options);

    const params = {
        FunctionName: arn,
        StatementId: loggingFunctionName,
        Action: "lambda:InvokeFunction",
        Principal: `logs.${options.region}.amazonaws.com`
    };

    return aws.request("Lambda", "addPermission", params, options.stage, options.region);
}

function getStageAndRegion(evt, project) {
    const numStages = _.size(project.stages);

    if (numStages > 1 && !evt.options.stage) {
        throw new Error("-s <stage> is required");
    }

    let stage;
    if (evt.options.stage) {
        stage = project.getStage(evt.options.stage);
    } else {
        stage = _.first(_.values(project.stages));
    }

    const numRegions = _.size(stage.regions);

    if (numRegions > 1 && !evt.options.region) {
        throw new Error("-r <region> is required");
    }

    let region;
    if (evt.options.region) {
        region = stage.getRegion(evt.options.region);
    } else {
        region = _.first(_.values(stage.regions));
    }

    return {
        stage: stage.name,
        region: region.name
    };
}
