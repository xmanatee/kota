/**
 * Citation parser for synthesizer output.
 *
 * The synthesizer emits citation markers in the form `[source:id]`. The
 * parser extracts them, validates each against the typed `RecallHit` pile
 * the synthesizer was shown, and returns:
 *
 * - the structured `AnswerCitation[]` (de-duplicated, original order)
 * - the raw `[source:id]` literals that did not resolve
 *
 * Unknown markers are not rewritten in the output text — the caller
 * decides whether to retry the synthesis or surface `synthesis_failed`.
 */

import type {
  AnswerCitation,
  RecallHit,
  RecallSource,
} from "#core/server/kota-client.js";
import { ANSWER_MAX_CITATIONS, type ParsedSynthesis } from "./answer-types.js";

const RECALL_SOURCES: ReadonlyArray<RecallSource> = [
  "knowledge",
  "memory",
  "history",
  "tasks",
  "answer",
];

const SOURCE_PATTERN = RECALL_SOURCES.join("|");

const CITATION_RE = new RegExp(`\\[(${SOURCE_PATTERN}):([^\\]\\s]+)\\]`, "g");

function citationKey(c: AnswerCitation): string {
  return `${c.source}:${c.id}`;
}

export function parseCitations(
  text: string,
  hits: RecallHit[],
): ParsedSynthesis {
  const allowed = new Set(hits.map((h) => `${h.source}:${h.id}`));
  const seen = new Set<string>();
  const citations: AnswerCitation[] = [];
  const unknownMarkers: string[] = [];

  for (const match of text.matchAll(CITATION_RE)) {
    const source = match[1] as RecallSource;
    const id = match[2];
    if (!id) continue;
    const key = `${source}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!allowed.has(key)) {
      unknownMarkers.push(`[${key}]`);
      continue;
    }
    if (citations.length >= ANSWER_MAX_CITATIONS) continue;
    citations.push({ source, id });
  }

  return { citations, unknownMarkers };
}

/**
 * Filter the typed hit pile down to only the hits referenced by the
 * citation list. Preserves the original recall ordering.
 */
export function selectCitedHits(
  citations: AnswerCitation[],
  hits: RecallHit[],
): RecallHit[] {
  if (citations.length === 0) return [];
  const wanted = new Set(citations.map(citationKey));
  return hits.filter((hit) => wanted.has(`${hit.source}:${hit.id}`));
}
