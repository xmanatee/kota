import { createHash } from "node:crypto";
import type { WatchlistSnapshot } from "./watchlist.js";

export type WatchlistFetchOutcome =
  | { accessible: true; content: string; summary: string }
  | { accessible: false };

export type WatchlistClassification =
  | { kind: "new"; fingerprint: string; summary: string; normalized: string }
  | {
      kind: "changed";
      fingerprint: string;
      summary: string;
      normalized: string;
      previousFingerprint: string;
    }
  | { kind: "unchanged"; fingerprint: string }
  | { kind: "inaccessible" };

const ISO_DATE_RE =
  /\b\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?\b/g;
const RELATIVE_TIME_RE =
  /\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/g;
const LAST_UPDATED_RE = /\b(?:last\s+)?(?:updated|modified)\s+[^.\n]{0,40}\bago\b/g;
const WS_RE = /\s+/g;
const SOFT_TIMESTAMP_RE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/g;

export function normalizeWatchlistContent(raw: string): string {
  return raw
    .toLowerCase()
    .replace(ISO_DATE_RE, "")
    .replace(LAST_UPDATED_RE, "")
    .replace(RELATIVE_TIME_RE, "")
    .replace(SOFT_TIMESTAMP_RE, "")
    .replace(WS_RE, " ")
    .trim();
}

export function computeWatchlistFingerprint(normalized: string): string {
  const hash = createHash("sha256").update(normalized, "utf-8").digest("hex");
  return `sha256:${hash.slice(0, 32)}`;
}

export function classifyWatchlistUpdate(
  previous: WatchlistSnapshot | undefined,
  outcome: WatchlistFetchOutcome,
): WatchlistClassification {
  if (!outcome.accessible) {
    return { kind: "inaccessible" };
  }
  const normalized = normalizeWatchlistContent(outcome.content);
  const fingerprint = computeWatchlistFingerprint(normalized);
  if (!previous) {
    return {
      kind: "new",
      fingerprint,
      summary: outcome.summary,
      normalized,
    };
  }
  if (previous.fingerprint === fingerprint) {
    return { kind: "unchanged", fingerprint };
  }
  return {
    kind: "changed",
    fingerprint,
    summary: outcome.summary,
    normalized,
    previousFingerprint: previous.fingerprint,
  };
}
