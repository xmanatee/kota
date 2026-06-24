/**
 * Plain-text rendering of cross-store recall hits.
 *
 * One line per hit with the columns: source tag, normalized score, id, and
 * a per-source title/preview. Matches the column layout of
 * `renderRepoTaskSearchPlain` and the other per-store search renderers so
 * operators see consistent output across `kota recall` and the existing
 * per-store search commands.
 */

import { formatWorkMemoryMetadata } from "#core/modules/work-memory-metadata.js";
import type { RecallHit } from "./client.js";

const SCORE_PRECISION = 3;

export function formatRecallScore(score: number): string {
  return score.toFixed(SCORE_PRECISION);
}

export function describeRecallHit(hit: RecallHit): string {
  const metadata = formatRecallHitMetadata(hit);
  switch (hit.source) {
    case "knowledge":
      return appendMetadata(hit.title, metadata);
    case "memory":
      return appendMetadata(hit.preview, metadata);
    case "history":
      return hit.title;
    case "tasks":
      return `[${hit.state}/${hit.priority}] ${hit.title}`;
    case "answer": {
      const badge = hit.result.ok
        ? `ok(${hit.citationCount})`
        : hit.result.reason;
      return `[${badge}] ${hit.query}`;
    }
  }
}

function formatRecallHitMetadata(hit: RecallHit): string {
  if (hit.source !== "knowledge" && hit.source !== "memory") return "";
  return formatWorkMemoryMetadata({
    ...(hit.provenance && { provenance: hit.provenance }),
    ...(hit.freshness && { freshness: hit.freshness }),
  });
}

function appendMetadata(label: string, metadata: string): string {
  return metadata ? `${label} | ${metadata}` : label;
}

export function renderRecallHitsPlain(hits: RecallHit[]): string {
  if (hits.length === 0) return "";
  const sourceWidth = Math.max(...hits.map((h) => h.source.length), 6);
  const idWidth = Math.max(...hits.map((h) => h.id.length), 2);
  const scoreWidth = SCORE_PRECISION + 2; // "0.xxx"
  return hits
    .map((hit) => {
      const source = hit.source.padEnd(sourceWidth);
      const score = formatRecallScore(hit.score).padStart(scoreWidth);
      const id = hit.id.padEnd(idWidth);
      return `${source}  ${score}  ${id}  ${describeRecallHit(hit)}`;
    })
    .join("\n");
}
