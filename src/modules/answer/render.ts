/**
 * Plain-text rendering of cited-answer envelopes.
 *
 * Two responsibilities:
 *
 *   1. `renderAnswerCitationsPlain` lays out the typed citation list that
 *      resolves each `[source:id]` marker against its `RecallHit` payload.
 *      The list mirrors the per-source columns `kota recall` already
 *      prints so operators see consistent attribution across the two
 *      seams.
 *
 *   2. `renderAnswerHistoryEntriesPlain` renders the newest-first
 *      one-row-per-record projection used by `kota answer log` and the
 *      Telegram `/answer-log` command. Both surfaces share the same
 *      projection so a stored record looks the same when listed from a
 *      terminal and from chat.
 */

import type {
  AnswerCitation,
  AnswerHistoryEntry,
  RecallHit,
} from "#core/server/kota-client.js";

const SCORE_PRECISION = 3;
const ANSWER_LOG_QUERY_TRUNCATE = 60;
const ANSWER_LOG_BADGE_WIDTH = 20;

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

function formatAnswerHistoryTimestamp(iso: string): string {
  const idx = iso.indexOf(".");
  const head = idx >= 0 ? iso.slice(0, idx) : iso;
  return `${head}Z`.replace(/Z+$/, "Z");
}

function badgeForAnswerHistoryEntry(entry: AnswerHistoryEntry): string {
  if (entry.result.ok) return `ok(${entry.result.citationCount})`;
  return entry.result.reason;
}

function truncateQuery(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Render a list of typed `AnswerHistoryEntry`s as one row per entry. The
 * caller has already chosen ordering and limit; this helper renders the
 * already-ordered, already-paged projection. The row format is the
 * single source of truth for how an answer record appears in any
 * one-line listing context.
 */
export function renderAnswerHistoryEntriesPlain(
  entries: AnswerHistoryEntry[],
): string {
  return entries
    .map((entry) => {
      const ts = formatAnswerHistoryTimestamp(entry.createdAt);
      const badge = badgeForAnswerHistoryEntry(entry).padEnd(
        ANSWER_LOG_BADGE_WIDTH,
      );
      const query = truncateQuery(entry.query, ANSWER_LOG_QUERY_TRUNCATE);
      return `${ts}  ${badge}  ${entry.id}  ${query}`;
    })
    .join("\n");
}
