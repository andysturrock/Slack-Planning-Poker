import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda";
import {verifySlackRequest} from './verifySlackRequest';
import {getSecretValue} from './awsAPI';
import util from 'util';
import {HeaderBlock, KnownBlock, ViewSubmitAction, ViewOutput, ViewStateValue} from "@slack/bolt";
import {postMessage} from "./slackAPI";

/**
 * Handle the interaction posts from Slack.
 * @param event the event from Slack containing the interaction payload
 * @returns HTTP 200 back to Slack immediately to indicate the interaction payload has been received.
 */
export async function handleInteractiveEndpoint(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if(!event.body) {
      throw new Error("Missing event body");
    }

    const signingSecret = await getSecretValue('PlanningPoker', 'slackSigningSecret');
    
    // Verify that this request really did come from Slack
    verifySlackRequest(signingSecret, event.headers, event.body);

    let body = decodeURIComponent(event.body);
    // For some reason the body parses to "payload= {...}"
    // so remove the bit outside the JSON
    body = body.replace('payload=', '');

    type ActionType = {
      type: string
    };
    const payload = JSON.parse(body) as ActionType;

    console.log(`body: ${util.inspect(payload, false, null)}`);

    switch(payload.type) {
    case "view_submission": {
      const viewSubmitAction: ViewSubmitAction = payload as ViewSubmitAction;
      const title = getTitle(viewSubmitAction.view);
      const blocks = createPlanningPokerBlocks(title || "");
      const participants = getParticipants(viewSubmitAction.view);
      if(participants && participants.length > 0) {
        const participantsText = participants.map((participant) => {return `<@${participant}>: awaiting`;});
        const text = `Votes\n${participantsText.join('/n')}`;
        const attachments = undefined;
        await postMessage(viewSubmitAction.view.private_metadata, text, blocks, undefined, attachments);
      }

      break;
    }
    
    default:
      break;
    }

    const result: APIGatewayProxyResult = {
      body: "",
      statusCode: 200
    };

    return result;
  }
  catch (error) {
    console.error(error);

    const result: APIGatewayProxyResult = {
      body: "There was an error - check the logs",
      statusCode: 500
    };
    return result;
  }
}

function getTitle(viewOutput: ViewOutput) {
  const titleViewStateValue = viewOutput.state.values["title"];
  const value = titleViewStateValue["title_text"].value;
  return value;
}

function getParticipants(viewOutput: ViewOutput) {
  const titleViewStateValue = viewOutput.state.values["participants"];
  const value = titleViewStateValue["participants_text"].selected_users;
  return value;
}

function createPlanningPokerBlocks(title: string) {
  const blocks: KnownBlock[] = [];

  const headerBlock: HeaderBlock = {
    type: "header",
    text: {
      type: 'plain_text',
      text: `Title: *${title}*`
    }
  };
  blocks.push(headerBlock);
  return blocks;
}