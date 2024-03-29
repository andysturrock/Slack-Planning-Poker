import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda";
import {verifySlackRequest} from './verifySlackRequest';
import {getSecretValue} from './awsAPI';
import util from 'util';
import {KnownBlock, ViewSubmitAction, ViewOutput, ContextBlock, MrkdwnElement, SectionBlock, PlainTextElement, Button, ActionsBlock, BlockAction, ButtonAction} from "@slack/bolt";
import {postMessage} from "./slackAPI";
import {nanoid} from 'nanoid';
import {SessionState, getState, putState} from "./sessionStateTable";

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
      const title = getTitle(viewSubmitAction.view) || "";
      const participants = getParticipants(viewSubmitAction.view);
      // Only show the voting message if there are some participants.
      if(participants && participants.length > 0) {
        const sessionId = nanoid();
        const channelId = viewSubmitAction.view.private_metadata;
        const text = createPlanningPokerText(title, participants);
        const scores = ["1", "2", ":smile:"];
        const blocks = createPlanningPokerBlocks(sessionId, viewSubmitAction.user.id, title, participants, scores);
        const ts = await postMessage(channelId, text, blocks, undefined);
        if(!ts) {
          throw new Error("Failed to get ts when posting message.");
        }
        const sessionState: SessionState = {
          sessionId,
          ts,
          title,
          scores,
          channelId,
          participants,
          votes: {}
        };
        await putState(sessionState);
      }
      break;
    }
    case "block_actions": {
      const blockAction: BlockAction = payload as BlockAction;
      if(blockAction.actions[0].type === "button" && blockAction.actions[0].block_id === "voting_buttons") {
        const buttonAction: ButtonAction = blockAction.actions[0];
        const vote = buttonAction.value;
        const sessionId = buttonAction.action_id;
        console.log(`User ${blockAction.user.id} voted for ${vote} in session ${sessionId}`);
        const sessionState = await getState(sessionId);
        if(!sessionState) {
          throw new Error(`Failed to get state for session id ${sessionId}`);
        }
        sessionState.votes[blockAction.user.id] = vote;
        await putState(sessionState);
      }
      break;
    }
    
    default:
      break;
    }

    // Empty 200 tells Slack to close the dialog view if this was a view_submission event.
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

function createPlanningPokerText(title: string, participants: string[]) {
  const votesText = participants.map((participant) => `<@${participant}>: awaiting`).join("\n");
  return `Title: *${title}*\n\nVotes:\n${votesText}`;
}

function createPlanningPokerBlocks(sessionId: string, userId: string, title: string, participants: string[], scores: string[]) {
  const blocks: KnownBlock[] = [];

  let sectionBlock: SectionBlock = {
    type: "section",
    block_id: "overall_heading",
    text: {
      type: "mrkdwn",
      text: `<@${userId}> has started a planning poker session.`
    }
  };
  blocks.push(sectionBlock);
  sectionBlock = {
    type: "section",
    block_id: "title",
    text: {
      type: "mrkdwn",
      text: `Title: *${title}*`
    }
  };
  blocks.push(sectionBlock);
  sectionBlock = {
    type: "section",
    block_id: "votes_heading",
    text: {
      type: "mrkdwn",
      text: `Votes:`
    }
  };
  blocks.push(sectionBlock);

  const element: MrkdwnElement = {
    type: "mrkdwn",
    text: participants.map((participant) => `<@${participant}>: awaiting`).join("\n")
  };
  const contextBlock: ContextBlock = {
    type: "context",
    block_id: "votes",
    elements: [element]
  };
  blocks.push(contextBlock);

  const elements = scores.map((score) => {
    const plainTextElement: PlainTextElement = {
      type: "plain_text",
      text: `${score} :coffee:`,
      emoji: true
    };
    const button: Button = {
      type: "button",
      text: plainTextElement,
      value: score,
      action_id: `${sessionId}`
    };
    return button;
  });
  
  const actionsBlock: ActionsBlock = {
    type: 'actions',
    block_id: "voting_buttons",
    elements
  };
  blocks.push(actionsBlock);

  return blocks;
}

