
import {DynamoDBClient, PutItemCommand, PutItemCommandInput, QueryCommand, QueryCommandInput} from '@aws-sdk/client-dynamodb';

const TableName = "PlanningPoker_ChannelDefaults";

/**
 * Defaults (eg participants and scores) for a channel
 */
export type ChannelDefaults = {
  channelId: string,
  scores: string[],
  participants: string[]
};

export async function getChannelDefaults(channelId: string) : Promise<ChannelDefaults | undefined>  { 
  const ddbClient = new DynamoDBClient({});

  const params: QueryCommandInput = {
    TableName,
    KeyConditionExpression: "channel_id = :channelId",
    ExpressionAttributeValues: {
      ":channelId" : {"S" : channelId}
    }
  };
  const data = await ddbClient.send(new QueryCommand(params));
  const items = data.Items;
  if(items && items[0] && items[0].channel_defaults.S) {
    const channelDefaults = JSON.parse(items[0].channel_defaults.S) as ChannelDefaults;
    return channelDefaults;
  }
  else {
    return undefined;
  }
}

export async function putChannelDefaults(channelDefaults: ChannelDefaults) {
  const ddbClient = new DynamoDBClient({});

  const putItemCommandInput: PutItemCommandInput = {
    TableName,
    Item: {
      channel_id: {S: channelDefaults.channelId},
      channel_defaults: {S: JSON.stringify(channelDefaults)}
    }
  };
  await ddbClient.send(new PutItemCommand(putItemCommandInput));
}
