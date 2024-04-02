import {generateImmediateSlackResponseBlocks} from './generateImmediateSlackResponseBlocks';
import querystring from 'querystring';
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda";
import {verifySlackRequest} from "./verifySlackRequest";
import {getSecretValue, invokeLambda} from "./awsAPI";
import {SlashCommand} from "@slack/bolt";

export async function handleSlashCommand(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if(!event.body) {
      throw new Error("Missing event body");
    }
    const body = querystring.parse(event.body) as unknown as SlashCommand;

    const signingSecret = await getSecretValue('PlanningPoker', 'slackSigningSecret');

    // Verify that this request really did come from Slack
    verifySlackRequest(signingSecret, event.headers, event.body);

    // We need to send an immediate response within 3000ms.
    // So this lambda will invoke another one to do the real work.
    // It will use the response_url which comes from the body of the event param.
    // Here we just return an interim result with a 200 code.
    // See https://api.slack.com/interactivity/handling#acknowledgment_response

    const blocks = generateImmediateSlackResponseBlocks();
    const responseBody = {
      response_type: "ephemeral",
      blocks
    };
    const result: APIGatewayProxyResult = {
      body: JSON.stringify(responseBody),
      statusCode: 200
    };

    // Dispatch to the appropriate lambda depending on meeting args
    // and whether we are logged into AAD/Entra and Google
    const functionName = "PlanningPoker-handlePlanningPokerCommandLambda";

    await invokeLambda(functionName, JSON.stringify(body));

    return result;
  }
  catch (error) {
    console.error(error);
    return createErrorResult("There was an error.  Please contact support.");
  }
}

function createErrorResult(text: string) {
  const blocks = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text
        }
      }
    ]
  };
  const result: APIGatewayProxyResult = {
    body: JSON.stringify(blocks),
    statusCode: 200
  };
  return result;
}