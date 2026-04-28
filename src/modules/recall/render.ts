/**
 * Plain-text rendering of cross-store recall hits.
 *
 * One line per hit with the columns: source tag, normalized score, id, and
 * a per-source title/preview. Matches the column layout of
 * `renderRepoTaskSearchPlain` and the other per-store search renderers so
 * operators see consistent output across `kota recall` and the existing
 * per-store search commands.
 */
import type { RecallHit } from "#core/server/kota-client.js";

const SCORE_PRECISION = 3;

function formatScore(score: number): string {
  return score.toFixed(SCORE_PRECISION);
}

function describeHit(hit: RecallHit): string {
  switch (hit.source) {
    case "knowledge":
      return hit.title;
    case "memory":
      return hit.preview;
    case "history":
      return hit.title;
    case "tasks":
      return `[${hit.state}/${hit.priority}] ${hit.title}`;
    case "answer": {
      const badge = hit.result.ok ? `ok(${hit.citationCount})` : hit.result.reason;
      return `[${badge}] ${hit.query}`;
    }
  }
}

export function renderRecallHitsPlain(hits: RecallHit[]): string {
  if (hits.length === 0) return "";
  const sourceWidth = Math.max(...hits.map((h) => h.source.length), 6);
  const idWidth = Math.max(...hits.map((h) => h.id.length), 2);
  const scoreWidth = SCORE_PRECISION + 2; // "0.xxx"
  return hits
    .map((hit) => {
      const source = hit.source.padEnd(sourceWidth);
      const score = formatScore(hit.score).padStart(scoreWidth);
      const id = hit.id.padEnd(idWidth);
      return `${source}  ${score}  ${id}  ${describeHit(hit)}`;
    })
    .join("\n");
}
