import type { MemoryEntry } from './types';

/**
 * Mirror of `renderMemorySearchPlain` exported from
 * `src/modules/memory/render.ts`: id padded to the widest value across
 * the result set, then the created timestamp sliced to
 * `YYYY-MM-DD HH:MM` (16 chars), then a 60-char snippet of the content
 * with newlines collapsed to single spaces. Sharing this line shape
 * keeps the mobile body identical to the Telegram, CLI, daemon HTTP,
 * and macOS surfaces — five operator pull-surfaces, one rendered line
 * shape.
 */
export function renderMemorySearchPlain(entries: MemoryEntry[]): string {
  const idWidth = Math.max(...entries.map((e) => e.id.length), 2);
  return entries
    .map((e) => {
      const date = e.created.slice(0, 16).replace('T', ' ');
      const snippet = e.content.replace(/\n/g, ' ').slice(0, 60);
      return `${e.id.padEnd(idWidth)}  ${date.padEnd(16)}  ${snippet}`;
    })
    .join('\n');
}
