import type { RecallHit } from './types';

const SCORE_PRECISION = 3;

function formatScore(score: number): string {
  return score.toFixed(SCORE_PRECISION);
}

/**
 * Per-source title/preview derivation, mirrored one-to-one from
 * `src/modules/recall/render.ts:18-29` and the macOS
 * `RecallHit.describe` computed property. Keeping the per-arm describe
 * shape canonical means the per-row body in `RecallScreen`, the macOS
 * row body, and the plain-text helper all read off the same field
 * mapping — no third describe shape on the mobile side.
 */
export function describeRecallHit(hit: RecallHit): string {
  switch (hit.source) {
    case 'knowledge':
      return hit.title;
    case 'memory':
      return hit.preview;
    case 'history':
      return hit.title;
    case 'tasks':
      return `[${hit.state}/${hit.priority}] ${hit.title}`;
  }
}

/**
 * Mirror of `renderRecallHitsPlain` exported from
 * `src/modules/recall/render.ts:31-44`: source padded to the widest
 * source (min width 6), score right-padded to width 5 (`0.xxx`), id
 * padded to the widest id (min width 2), columns joined by two spaces,
 * with the per-source describe last. An empty result returns the empty
 * string. Sharing the line shape keeps the mobile body identical to the
 * `kota recall` CLI, the Telegram `/recall` body, and the macOS
 * `renderRecallHitsPlain` line shape — six operator pull-surfaces, one
 * rendered line shape.
 */
export function renderRecallHitsPlain(hits: RecallHit[]): string {
  if (hits.length === 0) return '';
  const sourceWidth = Math.max(...hits.map((h) => h.source.length), 6);
  const idWidth = Math.max(...hits.map((h) => h.id.length), 2);
  const scoreWidth = SCORE_PRECISION + 2; // "0.xxx"
  return hits
    .map((hit) => {
      const source = hit.source.padEnd(sourceWidth);
      const score = formatScore(hit.score).padStart(scoreWidth);
      const id = hit.id.padEnd(idWidth);
      return `${source}  ${score}  ${id}  ${describeRecallHit(hit)}`;
    })
    .join('\n');
}
