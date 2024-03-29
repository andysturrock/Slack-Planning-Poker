import {Duration, Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import {LambdaStackProps} from './common';
import {Rule, Schedule} from 'aws-cdk-lib/aws-events';
import {LambdaFunction} from 'aws-cdk-lib/aws-events-targets';

export class LambdaStack extends Stack {
  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // Semantic versioning has dots as separators but this is invalid in a URL
    // so replace the dots with underscores first.
    const lambdaVersionIdForURL = props.lambdaVersion.replace(/\./g, '_');

    // Common props for all lambdas, so define them once here.
    const allLambdaProps = {
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
      logRetention: logs.RetentionDays.THREE_DAYS,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
    };

    // The lambda for rotating the Slack refresh token.
    const rotateSlackRefreshTokenLambda = new lambda.Function(this, "rotateSlackRefreshTokenLambda", {
      handler: "rotateSlackRefreshToken.rotateSlackRefreshToken",
      functionName: 'PlanningPoker-rotateSlackRefreshToken',
      code: lambda.Code.fromAsset("../lambda-src/dist/rotateSlackRefreshToken"),
      ...allLambdaProps
    });
    // Allow read/write access to the secret it needs
    props.planningPokerSecret.grantRead(rotateSlackRefreshTokenLambda);
    props.planningPokerSecret.grantWrite(rotateSlackRefreshTokenLambda);
    // Schedule it to run every 2 hours.
    // The tokens last 12 hours but more secure to rotate more often.
    new Rule(this, 'Rule', {
      description: "Schedule the PlanningPoker-rotateSlackRefreshToken lambda every 2 hours",
      schedule: Schedule.rate(Duration.hours(2)),
      targets: [new LambdaFunction(rotateSlackRefreshTokenLambda)],
    });

    // The lambda for handling the callback for the Slack install
    const handleSlackAuthRedirectLambda = new lambda.Function(this, "handleSlackAuthRedirectLambda", {
      handler: "handleSlackAuthRedirect.handleSlackAuthRedirect",
      functionName: 'PlanningPoker-handleSlackAuthRedirect',
      code: lambda.Code.fromAsset("../lambda-src/dist/handleSlackAuthRedirect"),
      ...allLambdaProps
    });
    // Allow read/write access to the secret it needs
    props.planningPokerSecret.grantRead(handleSlackAuthRedirectLambda);
    props.planningPokerSecret.grantWrite(handleSlackAuthRedirectLambda);

    // Create the lambda which receives the slash command and generates an initial response.
    const handleSlashCommand = new lambda.Function(this, "handleSlashCommand", {
      handler: "handleSlashCommand.handleSlashCommand",
      functionName: 'PlanningPoker-handleSlashCommand',
      code: lambda.Code.fromAsset("../lambda-src/dist/handleSlashCommand"),
      ...allLambdaProps
    });
    // Allow read access to the secret it needs
    props.planningPokerSecret.grantRead(handleSlashCommand);

    // Create the lambda for handling interactions from the dialog.
    const handleInteractiveEndpointLambda = new lambda.Function(this, "handleInteractiveEndpointLambda", {
      handler: "handleInteractiveEndpoint.handleInteractiveEndpoint",
      functionName: 'PlanningPoker-handleInteractiveEndpoint',
      code: lambda.Code.fromAsset("../lambda-src/dist/handleInteractiveEndpoint"),
      memorySize: 512,
      ...allLambdaProps
    });
    // Allow read access to the secret it needs
    props.planningPokerSecret.grantRead(handleInteractiveEndpointLambda);
    props.planningPokerSecret.grantWrite(handleInteractiveEndpointLambda);

    // Create the lambda which creates the modal dialog.
    // This lambda is called from the initial response lambda, not via the API Gateway.
    const handlePlanningPokerCommandLambda = new lambda.Function(this, "handlePlanningPokerCommandLambda", {
      handler: "handlePlanningPokerCommand.handlePlanningPokerCommand",
      functionName: 'PlanningPoker-handlePlanningPokerCommandLambda',
      code: lambda.Code.fromAsset("../lambda-src/dist/handlePlanningPokerCommand"),
      memorySize: 1024,
      ...allLambdaProps
    });
    // This function is going to be invoked asynchronously, so set some extra config for that
    new lambda.EventInvokeConfig(this, 'handlePlanningPokerCommandLambdaEventInvokeConfig', {
      function: handlePlanningPokerCommandLambda,
      maxEventAge: Duration.minutes(2),
      retryAttempts: 2,
    });
    // Give the initial response lambda permission to invoke this one
    handlePlanningPokerCommandLambda.grantInvoke(handleSlashCommand);
    // Allow access to the DynamoDB table
    props.configTable.grantReadData(handlePlanningPokerCommandLambda);
    // Allow read/write access to the secret it needs
    props.planningPokerSecret.grantRead(handlePlanningPokerCommandLambda);
    props.planningPokerSecret.grantWrite(handlePlanningPokerCommandLambda);

    // Get hold of the hosted zone which has previously been created
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'R53Zone', {
      zoneName: props.customDomainName,
      hostedZoneId: props.route53ZoneId,
    });

    // Create the cert for the gateway.
    // Usefully, this writes the DNS Validation CNAME records to the R53 zone,
    // which is great as normal Cloudformation doesn't do that.
    const acmCertificateForCustomDomain = new acm.DnsValidatedCertificate(this, 'CustomDomainCertificate', {
      domainName: props.planningPokerDomainName,
      hostedZone: zone,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    // Create the custom domain
    const customDomain = new apigateway.DomainName(this, 'CustomDomainName', {
      domainName: props.planningPokerDomainName,
      certificate: acmCertificateForCustomDomain,
      endpointType: apigateway.EndpointType.REGIONAL,
      securityPolicy: apigateway.SecurityPolicy.TLS_1_2
    });

    // This is the API Gateway which then calls the lambdas
    const api = new apigateway.RestApi(this, "APIGateway", {
      restApiName: "PlanningPoker",
      description: "Service for the Slack Planning Poker app.",
      deploy: false // create the deployment below
    });

    // By default CDK creates a deployment and a "prod" stage.  That means the URL is something like
    // https://2z2ockh6g5.execute-api.eu-west-2.amazonaws.com/prod/
    // We want to create the stage to match the version id.
    const apiGatewayDeployment = new apigateway.Deployment(this, 'ApiGatewayDeployment', {
      api: api,
    });
    const stage = new apigateway.Stage(this, 'Stage', {
      deployment: apiGatewayDeployment,
      loggingLevel: apigateway.MethodLoggingLevel.INFO,
      dataTraceEnabled: true,
      stageName: lambdaVersionIdForURL
    });

    // Connect the API Gateway to the lambdas
    const handleSlashCommandLambdaIntegration = new apigateway.LambdaIntegration(handleSlashCommand, {
      requestTemplates: {"application/json": '{ "statusCode": "200" }'}
    });
    const handleSlackAuthRedirectLambdaIntegration = new apigateway.LambdaIntegration(handleSlackAuthRedirectLambda, {
      requestTemplates: {"application/json": '{ "statusCode": "200" }'}
    });
    const handleInteractiveEndpointLambdaIntegration = new apigateway.LambdaIntegration(handleInteractiveEndpointLambda, {
      requestTemplates: {"application/json": '{ "statusCode": "200" }'}
    });
    const handleSlashCommandResource = api.root.addResource('planningpoker');
    const handleSlackAuthRedirectResource = api.root.addResource('slack-oauth-redirect');
    const handleInteractiveEndpointResource = api.root.addResource('interactive-endpoint');
    // And add the methods.
    handleSlashCommandResource.addMethod("POST", handleSlashCommandLambdaIntegration);
    handleSlackAuthRedirectResource.addMethod("GET", handleSlackAuthRedirectLambdaIntegration);
    handleInteractiveEndpointResource.addMethod("POST", handleInteractiveEndpointLambdaIntegration);

    // Create the R53 "A" record to map from the custom domain to the actual API URL
    new route53.ARecord(this, 'CustomDomainAliasRecord', {
      recordName: props.planningPokerDomainName,
      zone: zone,
      target: route53.RecordTarget.fromAlias(new targets.ApiGatewayDomain(customDomain))
    });
    // And path mapping to the API
    customDomain.addBasePathMapping(api, {basePath: `${lambdaVersionIdForURL}`, stage: stage});
  }
}
