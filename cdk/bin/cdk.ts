#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {LambdaStack} from '../lib/lambda-stack';
import {getEnv} from '../lib/common';
import {SecretsManagerStack} from '../lib/secretsmanager-stack';
import {DynamoDBStack} from '../lib/dynamodb-stack';

const lambdaVersion = getEnv('LAMBDA_VERSION', false)!;
const customDomainName = getEnv('CUSTOM_DOMAIN_NAME', false)!;
const route53ZoneId = getEnv('R53_ZONE_ID', false)!;
const planningPokerDomainName = `planningpoker.${customDomainName}`;

const app = new cdk.App();

const region = 'eu-west-2';

const secretsManagerStack = new SecretsManagerStack(app, 'PlanningPokerSecretsManagerStack', {
  env: {region},
  customDomainName,
});

const dynamoDBStack = new DynamoDBStack(app, 'PlanningPokerDynamoDBStack', {
  env: {region}
});

new LambdaStack(app, 'PlanningPokerLambdaStack', {
  env: {region},
  planningPokerSecret: secretsManagerStack.planningPokerSecret,
  configTable: dynamoDBStack.configTable,
  lambdaVersion,
  customDomainName,
  planningPokerDomainName: planningPokerDomainName,
  route53ZoneId
});

