import type { KnowledgeEntry } from './types';

/**
 * Mirror of `renderKnowledgeSearchPlain` exported from
 * `src/modules/knowledge/render.ts`: id, type, status, and title columns
 * padded to the widest value across the result set. Sharing this line
 * shape keeps the mobile body identical to the Telegram, CLI, daemon
 * HTTP, web, and macOS surfaces — six operator pull-surfaces, one
 * rendered line shape.
 */
export function renderKnowledgeSearchPlain(entries: KnowledgeEntry[]): string {
  const idWidth = Math.max(...entries.map((e) => e.id.length), 2);
  const typeWidth = Math.max(...entries.map((e) => e.type.length), 4);
  const statusWidth = Math.max(...entries.map((e) => e.status.length), 6);
  return entries
    .map(
      (e) =>
        `${e.id.padEnd(idWidth)}  ${e.type.padEnd(typeWidth)}  ${e.status.padEnd(statusWidth)}  ${e.title}`,
    )
    .join('\n');
}
