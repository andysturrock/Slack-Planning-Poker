import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda";
import {verifySlackRequest} from './verifySlackRequest';
import {getSecretValue} from './awsAPI';
import util from 'util';
import {KnownBlock, ViewSubmitAction, ViewOutput, ContextBlock, MrkdwnElement, SectionBlock, PlainTextElement, Button, ActionsBlock, BlockAction, ButtonAction} from "@slack/bolt";
import {postMessage, updateMessage} from "./slackAPI";
import {nanoid} from 'nanoid';
import {SessionState, deleteState, getState, putState} from "./sessionStateTable";

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
      await handleViewSubmission(viewSubmitAction);
      break;
    }
    case "block_actions": {
      const blockAction: BlockAction = payload as BlockAction;
      await handleBlockAction(blockAction);
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

function createPlanningPokerBlocks(sessionState: SessionState) {
  const blocks: KnownBlock[] = [];

  let sectionBlock: SectionBlock = {
    type: "section",
    block_id: "overall_heading",
    text: {
      type: "mrkdwn",
      text: `<@${sessionState.organiserUserId}> has started a planning poker session.`
    }
  };
  blocks.push(sectionBlock);
  sectionBlock = {
    type: "section",
    block_id: "title",
    text: {
      type: "mrkdwn",
      text: `Title: *${sessionState.title}*`
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

  const votesText = sessionState.participants.map((participant) => {
    if(sessionState.votes[participant]) {
      return `<@${participant}>: :white_check_mark:`;
    }
    else {
      return `<@${participant}>: not yet voted`;
    }
  });
  const element: MrkdwnElement = {
    type: "mrkdwn",
    text: votesText.join("\n")
  };
  const contextBlock: ContextBlock = {
    type: "context",
    block_id: "votes",
    elements: [element]
  };
  blocks.push(contextBlock);

  const elements = sessionState.scores.map((score) => {
    const plainTextElement: PlainTextElement = {
      type: "plain_text",
      text: `${score}`,
      emoji: true
    };
    const button: Button = {
      type: "button",
      text: plainTextElement,
      value: score,
      action_id: `${sessionState.sessionId}:${score}`
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

function createPlanningPokerResultBlocks(sessionState: SessionState) {
  const blocks: KnownBlock[] = [];

  let sectionBlock: SectionBlock = {
    type: "section",
    block_id: "overall_heading",
    text: {
      type: "mrkdwn",
      text: `<@${sessionState.organiserUserId}>'s planning poker session has finished.`
    }
  };
  blocks.push(sectionBlock);

  sectionBlock = {
    type: "section",
    block_id: "title",
    text: {
      type: "mrkdwn",
      text: `Title: *${sessionState.title}*`
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

  const votesText = sessionState.participants.map((participant) => {
    if(sessionState.votes[participant]) {
      return `<@${participant}>: ${sessionState.votes[participant]}`;
    }
    else {
      return `Cannot find vote for <@${participant}>`;
    }
  });
  const element: MrkdwnElement = {
    type: "mrkdwn",
    text: votesText.join("\n")
  };
  const contextBlock: ContextBlock = {
    type: "context",
    block_id: "votes",
    elements: [element]
  };
  blocks.push(contextBlock);

  return blocks;
}

async function handleViewSubmission(viewSubmitAction: ViewSubmitAction) {
  const title = getTitle(viewSubmitAction.view) || "";
  const participants = getParticipants(viewSubmitAction.view);
  // Only show the voting message if there are some participants.
  if(participants && participants.length > 0) {
    const sessionId = nanoid();
    const channelId = viewSubmitAction.view.private_metadata;
    const text = createPlanningPokerText(title, participants);
    const scores = ["1", "2", ":smile:"];
    const sessionState: SessionState = {
      sessionId,
      ts: "",
      title,
      organiserUserId: viewSubmitAction.user.id,
      scores,
      channelId,
      participants,
      votes: {}
    };
    const blocks = createPlanningPokerBlocks(sessionState);
    const ts = await postMessage(channelId, text, blocks);
    if(!ts) {
      throw new Error("Failed to get ts when posting message.");
    }
    sessionState.ts = ts;
    await putState(sessionState);
  }
}

async function handleBlockAction(blockAction: BlockAction) {
  if(blockAction.actions[0].type === "button" && blockAction.actions[0].block_id === "voting_buttons") {
    const buttonAction: ButtonAction = blockAction.actions[0];
    const vote = buttonAction.value;
    const sessionId = buttonAction.action_id.split(":")[0];
    console.log(`User ${blockAction.user.id} voted for ${vote} in session ${sessionId}`);
    const sessionState = await getState(sessionId);
    if(!sessionState) {
      throw new Error(`Failed to get state for session id ${sessionId}`);
    }
    sessionState.votes[blockAction.user.id] = vote;
    const text = createPlanningPokerText(sessionState.title, sessionState.participants);
    const blocks = createPlanningPokerBlocks(sessionState);
    const ts = await updateMessage(sessionState.channelId, text, blocks, sessionState.ts);
    if(!ts) {
      throw new Error("Failed to get ts when updating message.");
    }
    sessionState.ts = ts;
    await putState(sessionState);

    const voted = Object.keys(sessionState.votes);
    if(voted.length == sessionState.participants.length) {
      await deleteState(sessionState.sessionId);
      const resultBlocks = createPlanningPokerResultBlocks(sessionState);
      await updateMessage(sessionState.channelId, text, resultBlocks, sessionState.ts);
    }
  }
}