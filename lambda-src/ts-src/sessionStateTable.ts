
import {DynamoDBClient, PutItemCommand, PutItemCommandInput, QueryCommand, QueryCommandInput, DeleteItemCommand, DeleteItemCommandInput, ScanCommandInput, ScanCommand} from '@aws-sdk/client-dynamodb';

// The very useful TTL functionality in DynamoDB means we
// can set a TTL on storing the session state.
// This means that if there is an exception thrown etc and
// we end up with an orphan session state then it will get
// cleared down automatically after some period.
const TTL_IN_MS = 1000 * 60 * 60 * 24 * 7;  // 7 Days
const TableName = "PlanningPoker_SessionState";

/**
 * Represents the current state of a session.
 */
export type SessionState = {
  sessionId: string,
  ts: string,
  title: string,
  organiserUserId: string,
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
 * Get all current session states
 * @returns All the current session states
 */
export async function getStates() : Promise<SessionState[]>  { 
  const ddbClient = new DynamoDBClient({});

  const params: ScanCommandInput = {
    TableName
  };
  const data = await ddbClient.send(new ScanCommand(params));
  const sessionStates: SessionState[] = [];
  const items = data.Items;
  if(items) {
    for(const item of items) {
      if(item.state && item.state.S) {
        const sessionState = JSON.parse(item.state.S) as SessionState;
        sessionStates.push(sessionState);
      }
    }
    return sessionStates;
  }
  else {
    return [];
  }
}

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
  const now = Date.now();
  const ttl = new Date(now + TTL_IN_MS);

  const putItemCommandInput: PutItemCommandInput = {
    TableName,
    Item: {
      session_id: {S: sessionState.sessionId},
      state: {S: JSON.stringify(sessionState)},
      ttl: {N: `${Math.floor(ttl.getTime() / 1000)}`}
    }
  };

  const ddbClient = new DynamoDBClient({});

  await ddbClient.send(new PutItemCommand(putItemCommandInput));
}
