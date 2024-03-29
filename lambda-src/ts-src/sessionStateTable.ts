
import {DynamoDBClient, PutItemCommand, PutItemCommandInput, QueryCommand, QueryCommandInput, DeleteItemCommand, DeleteItemCommandInput} from '@aws-sdk/client-dynamodb';

const TableName = "PlanningPoker_SessionState";

/**
 * Represents the current state of a session.
 */
export type SessionState = {
  sessionId: string,
  ts: string,
  title: string,
  scores: string[],
  channelId: string,
  /**
   * List of Slack user ids of participants in this session
   */
  participants: string[],
  /**
   * Current votes, keyed by Slack user id
   */
  votes: { [key: string]: string };
};

/**
 * Gets the state for the given id.
 * @param sessionId
 * @returns state or undefined if no state exists for the id
 */
export async function getState(sessionId: string) : Promise<SessionState | undefined>  { 
  const ddbClient = new DynamoDBClient({});

  const params: QueryCommandInput = {
    TableName,
    KeyConditionExpression: "session_id = :sessionId",
    ExpressionAttributeValues: {
      ":sessionId" : {"S" : sessionId}
    }
  };
  const data = await ddbClient.send(new QueryCommand(params));
  const items = data.Items;
  if(items && items[0] && items[0].state.S) {
    const sessionState = JSON.parse(items[0].state.S) as SessionState;
    return sessionState;
  }
  else {
    return undefined;
  }
}

export async function deleteState(sessionId: string) {
  const ddbClient = new DynamoDBClient({});

  const params: DeleteItemCommandInput = {
    TableName,
    Key: {
      'session_id': {S: sessionId}
    }
  };

  const command = new DeleteItemCommand(params);

  await ddbClient.send(command);
}

/**
 * Put (ie save new or overwite) state with id as the key
 * @param sessionId Key for the table
 * @param sessionState JSON value
 */
export async function putState(sessionState: SessionState) {
  const putItemCommandInput: PutItemCommandInput = {
    TableName,
    Item: {
      session_id: {S: sessionState.sessionId},
      state: {S: JSON.stringify(sessionState)}
    }
  };

  const ddbClient = new DynamoDBClient({});

  await ddbClient.send(new PutItemCommand(putItemCommandInput));
}
