import {KnownBlock, SectionBlock} from "@slack/bolt";

export function generateImmediateSlackResponseBlocks() {
  const blocks: KnownBlock[] = [];
  const sectionBlock: SectionBlock = {
    "type": "section",
    "text": {
      "type": "mrkdwn",
      "text": "Thinking..."
    }
  };
  blocks.push(sectionBlock);
  return blocks;
}
