import { KnownBlock, SectionBlock } from "@slack/types";

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
