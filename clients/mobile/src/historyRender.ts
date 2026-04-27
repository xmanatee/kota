import type { ConversationRecord } from './types';

/**
 * Mirror of `renderHistorySearchPlain` exported from
 * `src/modules/history/render.ts`: id padded to the widest value across
 * the result set (min width 2), then the updated timestamp sliced to
 * `YYYY-MM-DD HH:MM` (16 chars), then `messageCount` right-padded to
 * width 4 followed by ` msgs`, then the title. Sharing this line shape
 * keeps the mobile body identical to the Telegram, CLI, daemon HTTP, and
 * macOS surfaces — six operator pull-surfaces, one rendered line shape.
 */
export function renderHistorySearchPlain(
  conversations: ConversationRecord[],
): string {
  const idWidth = Math.max(...conversations.map((c) => c.id.length), 2);
  return conversations
    .map((c) => {
      const updated = c.updatedAt.slice(0, 16).replace('T', ' ').padEnd(16);
      const msgs = `${String(c.messageCount).padStart(4)} msgs`;
      return `${c.id.padEnd(idWidth)}  ${updated}  ${msgs}  ${c.title}`;
    })
    .join('\n');
}
