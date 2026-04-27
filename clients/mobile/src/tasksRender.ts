import type { RepoTaskSearchHit } from './types';

/**
 * Mirror of `renderRepoTaskSearchPlain` exported from
 * `src/modules/repo-tasks/render.ts`: id (min width 2), state (min width
 * 5), priority (min width 4) padded to the widest value across the result
 * set, joined by two spaces, with the title last. An empty result returns
 * the empty string. Sharing this line shape keeps the mobile body
 * identical to the Telegram, CLI, daemon HTTP, and macOS surfaces — five
 * operator pull-surfaces, one rendered line shape.
 */
export function renderRepoTaskSearchPlain(hits: RepoTaskSearchHit[]): string {
  if (hits.length === 0) return '';
  const idWidth = Math.max(...hits.map((h) => h.id.length), 2);
  const stateWidth = Math.max(...hits.map((h) => h.state.length), 5);
  const prioWidth = Math.max(...hits.map((h) => h.priority.length), 4);
  return hits
    .map((hit) => {
      const id = hit.id.padEnd(idWidth);
      const state = hit.state.padEnd(stateWidth);
      const priority = hit.priority.padEnd(prioWidth);
      return `${id}  ${state}  ${priority}  ${hit.title}`;
    })
    .join('\n');
}
