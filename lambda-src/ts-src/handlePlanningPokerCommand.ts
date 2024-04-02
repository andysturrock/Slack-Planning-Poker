import {deleteMessage, openView, postEphmeralErrorMessage, postErrorMessageToResponseUrl, postMessage, postToResponseUrl, updateMessage} from './slackAPI';
import {InputBlock, KnownBlock, ModalView, SectionBlock, SlashCommand} from '@slack/bolt';
import {deleteState, getStates} from './sessionStateTable';
import {createPlanningPokerResultBlocks, showSessionView} from './sessionView';
import {ChannelDefaults, getChannelDefaults} from './channelDefaultsTable';

/**
 * Create the modal dialog
 * @param event the payload from the slash command
 */
export async function handlePlanningPokerCommand(event: SlashCommand): Promise<void> {

  if(event.text === "help") {
    const usage = "Usage: /planningpoker [help] | [session name] | [list|show <id>|cancel<id>|finish<id>]";
    const sectionBlock: SectionBlock = {
      type: 'section',
      text: {
        type: "mrkdwn",
        text: usage
      }
    };
    await postToResponseUrl(event.response_url, "ephemeral", usage, [sectionBlock]);
    return;
  }

  if(event.text === "list") {
    let sessionStates = await getStates();
    // Only show sessions from this channel.
    // TODO This is not very efficient.  Should add secondary index on channelId in the database.
    sessionStates = sessionStates.filter((sessionState) => sessionState.channelId === event.channel_id);
    if(sessionStates.length == 0) {
      await postToResponseUrl(event.response_url, "ephemeral", "No Active Planning Poker sessions", []);
    }
    else {
      const blocks: KnownBlock[] = [];
      for(let sessionStateIndex = 0; sessionStateIndex < sessionStates.length; ++sessionStateIndex) {
        const sectionBlock: SectionBlock = {
          type: 'section',
          text: {
            type: "mrkdwn",
            text: `${sessionStateIndex}: ${sessionStates[sessionStateIndex].title}`
          }
        };
        blocks.push(sectionBlock);
      }
      await postToResponseUrl(event.response_url, "ephemeral", "Active Planning Poker sessions", blocks);
    }
    return;
  }

  // Eg show 12
  if(event.text.match(/^show\s+\d+/)) {
    const sessionState = await getSessionStateFromArgument(event.text);
    if(!sessionState) {
      return;
    }
    // Delete the old message so we don't have a duplicate.
    // Someone might have deleted it in the Slack UI, hence the try/catch.
    try {
      await deleteMessage(sessionState.channelId, sessionState.ts);
    }
    catch (error) {
      // Not much we can do here.  Just log at warn level in case we've got into some weird situation and want to debug.
      console.warn(error);
    }
    // And create a new message which will be the newest message in the channel
    await showSessionView(sessionState);
    return;
  }

  // Eg cancel 12
  if(event.text.match(/^cancel\s+\d+/)) {
    const sessionState = await getSessionStateFromArgument(event.text);
    if(!sessionState) {
      return;
    }
    // Delete the message if it still exists.
    // As above, someone might have deleted it in the Slack UI, hence try/catch
    try {
      await deleteMessage(sessionState.channelId, sessionState.ts);
    }
    catch (error) {
      // See above
      console.warn(error);
    }
    await deleteState(sessionState.sessionId);
    await postMessage(event.channel_id, `<@${event.user_id}> cancelled the session ${sessionState.title}`, []);
    return;
  }

  // Eg finish 12
  if(event.text.match(/^finish\s+\d+/)) {
    const sessionState = await getSessionStateFromArgument(event.text);
    if(!sessionState) {
      return;
    }

    const resultBlocks = createPlanningPokerResultBlocks(sessionState);

    try {
      await updateMessage(event.channel_id, `<@${event.user_id}> cancelled the session ${sessionState.title}`, resultBlocks, sessionState.ts);
      // Only delete the state if we were successful in updating the message.
      await deleteState(sessionState.sessionId);
    }
    catch (error) {
      await postEphmeralErrorMessage(event.channel_id, event.user_id, "Could not find the original message to show the results.\nTry `/planningpoker show` to recreate it.");
      console.warn(error);
    }
    
    return;
  }

  // Define locally here so we have access to the event.
  async function getSessionStateFromArgument(argument: string) {
    const sessionStateMatch = argument.match(/\d+/);
    if(!sessionStateMatch) {
      throw new Error("Logic error");
    }
    const sessionStateIndex = parseInt(sessionStateMatch[0]);
    let sessionStates = await getStates();
    // TODO see above
    sessionStates = sessionStates.filter((sessionState) => sessionState.channelId === event.channel_id);
    if(sessionStateIndex < 0 || sessionStateIndex > sessionStates.length - 1) {
      await postErrorMessageToResponseUrl(event.response_url, `Number must be between 0 and ${sessionStates.length - 1}`);
      return undefined;
    }
    return sessionStates[sessionStateIndex];
  }

  // The main command.  Create a dialog to set the options.  Submitting will create a new session.
  try {
    let channelDefaults = await getChannelDefaults(event.channel_id);
    if(!channelDefaults) {
      channelDefaults = {
        channelId: event.channel_id,
        // Use Fibonacci series as default.
        scores: ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "144"],
        participants: [event.user_id]
      };
    }
    
    const blocks = createModalBlocks(event.text, channelDefaults);
    const modalView: ModalView = {
      type: "modal",
      title: {
        type: "plain_text",
        text: "Planning Poker"
      },
      blocks,
      close: {
        type: "plain_text",
        text: "Cancel"
      },
      submit: {
        type: "plain_text",
        text: "Start Session"
      },
      private_metadata: event.channel_id,
      callback_id: "PlanningPokerModal"
    };
    await openView(event.trigger_id, modalView);
  }
  catch (error) {
    console.error(error);
    await postErrorMessageToResponseUrl(event.response_url, "Failed to create Planning Poker session");
  }
}

function createModalBlocks(title: string, channelDefaults: ChannelDefaults) {
  const blocks: KnownBlock[] = [];
  let inputBlock: InputBlock = {
    type: "input",
    block_id: "title",
    label: {
      type: "plain_text",
      text: "Title"
    },
    element: {
      type: "plain_text_input",
      action_id: "title_text",
      placeholder: {
        type: "plain_text",
        text: "Name of this planning poker session"
      },
      initial_value: title,
      multiline: false
    },
    optional: false
  };
  blocks.push(inputBlock);

  inputBlock = {
    type: "input",
    block_id: "participants",
    label: {
      type: "plain_text",
      text: "Participants"
    },
    element: {
      type: "multi_users_select",
      action_id: "participants_text",
      placeholder: {
        type: "plain_text",
        text: "Participant names"
      },
      initial_users: channelDefaults.participants,
    },
    optional: false
  };
  blocks.push(inputBlock);

  const initial_value = channelDefaults.scores.join(' ');
  inputBlock = {
    type: "input",
    block_id: "scores",
    element: {
      type: 'plain_text_input',
      action_id: "scores_text",
      placeholder: {
        type: 'plain_text',
        text: 'Enter scores separated by space',
      },
      initial_value
    },
    label: {
      type: 'plain_text',
      text: 'Scores',
    },
    hint: {
      type: 'plain_text',
      text: 'Enter scores separated by space',
    },
  };
  blocks.push(inputBlock);

  return blocks;
}