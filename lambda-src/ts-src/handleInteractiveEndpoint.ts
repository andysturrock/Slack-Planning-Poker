import { BlockAction, ButtonAction, ViewOutput, ViewSubmitAction } from "@slack/bolt";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { nanoid } from 'nanoid';
import { getSecretValue } from './awsAPI';
import { ChannelDefaults, putChannelDefaults } from "./channelDefaultsTable";
import { SessionState, deleteState, getState } from "./sessionStateTable";
import { createPlanningPokerResultBlocks, showSessionView, updateSessionView } from "./sessionView";
import { postEphmeralErrorMessage, updateMessage } from "./slackAPI";
import { verifySlackRequest } from './verifySlackRequest';

/**
 * Handle the interaction posts from Slack.
 * @param event the event from Slack containing the interaction payload
 * @returns HTTP 200 back to Slack immediately to indicate the interaction payload has been received.
 */
export async function handleInteractiveEndpoint(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
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

    switch (payload.type) {
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

async function handleViewSubmission(viewSubmitAction: ViewSubmitAction) {
  const title = getTitle(viewSubmitAction.view) || "";
  const participants = getParticipants(viewSubmitAction.view);
  const scores = getScores(viewSubmitAction.view);
  // Only show the voting message if there are some participants and scores
  if (participants && participants.length > 0 && scores && scores.length > 0) {
    const sessionId = nanoid();
    const channelId = viewSubmitAction.view.private_metadata;

    // Save the values entered as new defaults for this channel
    const channelDefaults: ChannelDefaults = {
      channelId,
      participants,
      scores
    };
    await putChannelDefaults(channelDefaults);

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
    await showSessionView(sessionState);
  }
}

async function handleBlockAction(blockAction: BlockAction) {
  if (blockAction.actions[0].type === "button" && blockAction.actions[0].block_id.match(/voting_buttons:\d+/)) {
    const buttonAction: ButtonAction = blockAction.actions[0];
    const vote = buttonAction.value;
    const sessionId = buttonAction.action_id.split(":")[0];

    let sessionState = await getState(sessionId);
    if (!sessionState) {
      throw new Error(`Failed to get state for session id ${sessionId}`);
    }
    // Check the user who voted is one of the participants
    const participant = sessionState.participants.find((participant) => participant == blockAction.user.id);
    if (!participant) {
      // blockAction.channel can be undefined according to the type system but won't be.
      if (blockAction.channel) {
        await postEphmeralErrorMessage(blockAction.channel.id, blockAction.user.id, "You are not a participant in this session");
      }
      return;
    }

    if (vote) {
      sessionState.votes[blockAction.user.id] = vote;
    }
    sessionState = await updateSessionView(sessionState);

    const voted = Object.keys(sessionState.votes);
    if (voted.length == sessionState.participants.length) {
      await deleteState(sessionState.sessionId);
      const resultBlocks = createPlanningPokerResultBlocks(sessionState);
      await updateMessage(sessionState.channelId, `Results for ${sessionState.title}`, resultBlocks, sessionState.ts);
    }
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

function getScores(viewOutput: ViewOutput) {
  const titleViewStateValue = viewOutput.state.values["scores"];
  const value = titleViewStateValue["scores_text"].value;
  return value?.split("+");
}

