import {WebClient, LogLevel, ViewsOpenArguments, OAuthV2AccessArguments} from "@slack/web-api";
import {Block, KnownBlock, MessageAttachment, ModalView} from "@slack/bolt";
import {getSecretValue, putSecretValue} from "./awsAPI";
import axios from "axios";

/**
 * Refreshes the refresh token and returns an access token
 * @returns new access token
 */
export async function refreshToken() {
  const slackClientId = await getSecretValue("PlanningPoker", "slackClientId");
  const slackClientSecret = await getSecretValue('PlanningPoker', 'slackClientSecret');
  const slackRefreshToken = await getSecretValue('PlanningPoker', 'slackRefreshToken');

  // We don't have a token at this point so pass undefined.
  const client = new WebClient(undefined, {
    logLevel: LogLevel.INFO
  });
  const oauthV2AccessArguments: OAuthV2AccessArguments = {
    grant_type: "refresh_token",
    refresh_token: slackRefreshToken,
    client_id: slackClientId,
    client_secret: slackClientSecret
  };
  const response = await client.oauth.v2.access(oauthV2AccessArguments);
  if(!response.refresh_token) {
    throw new Error("Failed to obtain new refresh token");
  }
  if(!response.access_token) {
    throw new Error("Failed to obtain new access token");
  }
  await putSecretValue('PlanningPoker', 'slackRefreshToken', response.refresh_token);
  await putSecretValue('PlanningPoker', 'slackAccessToken', response.access_token);

  return response.access_token;
}

async function createClient() {
  const slackBotAccessToken = await refreshToken();
  console.log(`createClient slackBotAccessToken = ${slackBotAccessToken}`);

  return new WebClient(slackBotAccessToken, {
    logLevel: LogLevel.INFO
  });
}

export async function postMessage(channelId: string, text:string, blocks: (KnownBlock | Block)[], thread_ts?: string, attachments?: MessageAttachment[]) {
  const client = await createClient();
  await client.chat.postMessage({
    channel: channelId,
    text,
    blocks,
    thread_ts,
    attachments
  });
}

export async function postEphemeralMessage(channelId: string, userId: string, text:string, blocks: (KnownBlock | Block)[]) {
  const client = await createClient();
  await client.chat.postEphemeral({
    user: userId,
    channel: channelId,
    text,
    blocks
  });  
}

export async function postEphmeralErrorMessage(channelId: string, userId:string, text: string) {
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text
      }
    }
  ];
  await postEphemeralMessage(channelId, userId, text, blocks);
}

export async function openView(trigger_id: string, modalView: ModalView) {
  const client = await createClient();
  const viewsOpenArguments: ViewsOpenArguments = {
    trigger_id,
    view: modalView
  };
  await client.views.open(viewsOpenArguments);
}

export async function postToResponseUrl(responseUrl: string, responseType: "ephemeral" | "in_channel", text: string, blocks: KnownBlock[]) {
  const messageBody = {
    response_type: responseType,
    text,
    blocks
  };
  const result = await axios.post(responseUrl, messageBody);
  return result;
}

export async function postErrorMessageToResponseUrl(responseUrl: string, text: string) {
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text
      }
    }
  ];
  await postToResponseUrl(responseUrl, "ephemeral", text, blocks);
}

export type PlanningPokerCommandPayload = {
  response_url?: string,
  channel?: string,
  user_id: string,
  text: string,
  command?: string,
  event_ts?: string
};

// export type Action = {
//   action_id: string,
//   value: string
// };

// export type InteractionPayload = {
//   type: string,
//   user: {
//     id: string,
//     username: string,
//     name: string,
//     team_id: string,
//   },
//   container: {
//     type: string,
//     message_ts: string,
//     channel_id: string,
//     is_ephemeral: boolean
//   },
//   team: {
//     id: string,
//     domain: string
//   },
//   channel: {
//     id: string,
//     name: string,
//   },
//   message: {
//     type: 'message',
//     subtype: string,
//     text: string,
//     ts: string,
//     bot_id: string,
//   },
//   response_url: string,
//   actions: Action[]
// };