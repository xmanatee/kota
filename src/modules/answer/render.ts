/**
 * Plain-text rendering of a cited answer.
 *
 * Two stacked sections: the synthesized prose first, followed by a
 * typed citation list that resolves each `[source:id]` marker against
 * its `RecallHit` payload. The list mirrors the per-source columns
 * `kota recall` already prints so operators see consistent attribution
 * across the two seams.
 */

import type { AnswerCitation, RecallHit } from "#core/server/kota-client.js";

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
  }
}

export function renderAnswerCitationsPlain(
  citations: AnswerCitation[],
  hits: RecallHit[],
): string {
  if (citations.length === 0) return "";
  const byKey = new Map(hits.map((hit) => [`${hit.source}:${hit.id}`, hit]));
  const rows = citations
    .map((c) => byKey.get(`${c.source}:${c.id}`))
    .filter((hit): hit is RecallHit => Boolean(hit));
  if (rows.length === 0) return "";
  const sourceWidth = Math.max(...rows.map((h) => h.source.length), 6);
  const idWidth = Math.max(...rows.map((h) => h.id.length), 2);
  const scoreWidth = SCORE_PRECISION + 2;
  return rows
    .map((hit) => {
      const source = hit.source.padEnd(sourceWidth);
      const score = formatScore(hit.score).padStart(scoreWidth);
      const id = hit.id.padEnd(idWidth);
      return `${source}  ${score}  ${id}  ${describeHit(hit)}`;
    })
    .join("\n");
}
