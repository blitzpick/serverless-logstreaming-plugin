Serverless Log Streaming Plugin
=============================

This plugin will automatically configure your CloudWatch logs to stream to one of the Lambda functions in your project.

This plugin was motivated by a desire to consolidate CloudWatch logs in a service like Loggly.  However, by Streaming
your logs to a lambda, you can do any sort of aggregation or metrics on your logs you'd like.

**Note:** Requires Serverless *v0.5.0*.

### Setup

The plugin requires a custom setting in s-project.json

```javascript
{
  "custom": {
    "logStreaming": {
        "functionName": "logStreaming"
    }
  }
}
```

This will be a reference to the function you'll write to receive the log streams.  This function will be deployed just like any other
in your project.  The `serverless-logstreaming-plugin` will configure the CloudWatch logs for all of your other functions to stream
log events to this function.

It is also possible to specify optional "external" setting (bool value), to point that functionName is outside of current Serverless project (but in the same AWS account, stage and region):

```javascript
{
  "custom": {
    "logStreaming": {
        "functionName": "logStreaming",
        "external": true
    }
  }
}
```

Your log streaming function will receive events that are shaped like this:

```javascript
{
    "awslogs": {
        "data": "H4sIAAAAAAAAAM2ZW2/bRhCF/4qghz7Z0s7s7E1AUDiwkxefBmeLv+MEhwWWwcunuJr9NdiOvKoi5g6huZ72f3HzD1Bi9GuWGwAA"
    }
}
```

The `data` property is a gzipped JSON object containing one or more log events.  You can decode the data like this:

```javascript
const compressedBuffer = new Buffer(event.awslogs.data, "base64");
const decompressedBuffer = await gunzip(compressedBuffer);
const data = JSON.parse(decompressedBuffer.toString());
```

The decompressed data will look like this:

```javascript
{
  "messageType": "DATA_MESSAGE",
  "owner": "478975653623",
  "logGroup": "/aws/lambda/myFunction",
  "logStream": "2016/06/30/[26]e82a72c762484f97ae64789d2e5b7dee",
  "subscriptionFilters": [
    "yourLoggingFunctionName"
  ],
  "logEvents": [
    {
      "id": "32722257877424071767718648969301946065457340266792681472",
      "timestamp": 1467316790812,
      "message": "2016-06-30T19:59:50.812Z\t345da8e6-3efd-11e6-afb7-85911a72ebf4\tA log message from one of your executing Lambdas"
    }
  ]
}
```

### Setup

* Install the plugin in the root of your Serverless Project:
```
npm install serverless-logstreaming-plugin --save-dev
```

* Add the plugin to the `plugins` array in your Serverless Project's `s-project.json`, like this:

```
plugins: [
    "serverless-logstreaming-plugin"
]
```

Now, any time you deploy a function to AWS, `serverless-logstreaming-plugin` will automatically configure the Lambda's CloudWatch logs to send events to the
function you specified in your s-project.json.

`serverless-logstreaming-plugin` also includes a command that will fix the CloudWatch Log configuration for all of your lambdas, if it's ever necessary.

Just run `sls logStreaming fix`, and the plugin will configure CloudWatch log groups for all of your lambdas.  If you have more than one stage configured, you may need to provide
the `-s <stage>` and/or `-r <region` options.
