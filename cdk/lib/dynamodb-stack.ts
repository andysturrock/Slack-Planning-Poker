import {Stack, StackProps, RemovalPolicy} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class DynamoDBStack extends Stack {
  public readonly sessionStateTable: dynamodb.Table;
  public readonly channelDefaultsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.sessionStateTable = new dynamodb.Table(this, 'PlanningPoker_SessionState', {
      tableName: "PlanningPoker_SessionState",
      partitionKey: {name: 'session_id', type: dynamodb.AttributeType.STRING},
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY
    });

    this.channelDefaultsTable = new dynamodb.Table(this, 'PlanningPoker_ChannelDefaults', {
      tableName: "PlanningPoker_ChannelDefaults",
      partitionKey: {name: 'channel_id', type: dynamodb.AttributeType.STRING},
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Create exports from the CF template so that CF knows that other stacks depend on this stack.
    this.exportValue(this.sessionStateTable.tableArn);
    this.exportValue(this.channelDefaultsTable.tableArn);
  }
}
