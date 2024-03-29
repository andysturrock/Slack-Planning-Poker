import {openView, postErrorMessageToResponseUrl, postToResponseUrl} from './slackAPI';
import {InputBlock, KnownBlock, ModalView, SectionBlock, SlashCommand} from '@slack/bolt';
import util from 'util';

/**
 * Create the modal dialog
 * @param event the payload from the slash command
 */
export async function handlePlanningPokerCommand(event: SlashCommand): Promise<void> {
  console.log(`event: ${util.inspect(event)}`);

  if(event.text === "help") {
    const sectionBlock: SectionBlock = {
      type: 'section',
      text: {
        type: "mrkdwn",
        text: "Usage: /planningpoker [session name]"
      }
    };
    await postToResponseUrl(event.response_url, "ephemeral", "Usage: /planningpoker [session name]", [sectionBlock]);
    return;
  }

  try {
    const blocks = createModalBlocks(event.text, ["1", "2", ":smile:"]);
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

function createModalBlocks(title: string, scores: string[]) {
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
      initial_users: [],
    },
    optional: false
  };
  blocks.push(inputBlock);

  const initial_value = scores.join(' ');
  inputBlock = {
    type: "input",
    block_id: "scores",
    element: {
      type: 'plain_text_input',
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