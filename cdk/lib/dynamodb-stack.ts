import {Stack, StackProps, RemovalPolicy} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class DynamoDBStack extends Stack {
  public readonly configTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.configTable = new dynamodb.Table(this, 'PlanningPoker_SlackIdToGCalToken', {
      tableName: "PlanningPoker_Config",
      partitionKey: {name: 'channel_id', type: dynamodb.AttributeType.STRING},
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Create exports from the CF template so that CF knows that other stacks depend on this stack.
    this.exportValue(this.configTable.tableArn);
  }
}
