import {KnownBlock, ContextBlock, MrkdwnElement, SectionBlock, PlainTextElement, Button, ActionsBlock} from "@slack/bolt";
import {postMessage, updateMessage} from "./slackAPI";
import {SessionState, putState} from "./sessionStateTable";

/**
 * Show the session message in the given channel.
 * @param channelId Id of channel to post to
 * @param sessionState Current session state.  This will be updated with the ts of the new post and stored.
 * @returns The updated session state (with the new ts value).
 */
export async function showSessionView(sessionState: SessionState) {
  const blocks = createPlanningPokerBlocks(sessionState);
  const ts = await postMessage(sessionState.channelId, `Planning Poker: ${sessionState.title}`, blocks);
  if(!ts) {
    throw new Error("Failed to get ts when posting message.");
  }
  sessionState.ts = ts;
  await putState(sessionState);
  return sessionState;
}

/**
 * Update the view for this session.  The ts field of the sessionState must refer to an existing message.
 * @param sessionState New state of the seesion.  This will be updated with the ts of the new post and stored.
 * @returns The updated session state (with the new ts value).
 */
export async function updateSessionView(sessionState: SessionState) {
  const blocks = createPlanningPokerBlocks(sessionState);
  const ts = await updateMessage(sessionState.channelId, `Planning Poker: ${sessionState.title}`, blocks, sessionState.ts);
  if(!ts) {
    throw new Error("Failed to get ts when posting message.");
  }
  sessionState.ts = ts;
  await putState(sessionState);
  return sessionState;
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

  // Chunk the scores into arrays of length 5 so
  // the score buttons fit on the message properly.
  // Also remove duplicates.
  function chunk(arr: string[], size: number) {
    const chunks = Array.from({length: Math.ceil(arr.length / size)}, (v, i) =>
      arr.slice(i * size, i * size + size)
    );
    return [...new Set(chunks)];
  }
  const scoresChunks = chunk(sessionState.scores, 5);
  for(let scoresChunkIndex = 0; scoresChunkIndex < scoresChunks.length; ++scoresChunkIndex) {
    const elements = scoresChunks[scoresChunkIndex].map((score) => {
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
      block_id: `voting_buttons:${scoresChunkIndex}`,
      elements
    };
    blocks.push(actionsBlock);
  }

  return blocks;
}

export function createPlanningPokerResultBlocks(sessionState: SessionState) {
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
      return `<@${participant}> did not vote`;
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