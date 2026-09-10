import { createHash } from "node:crypto";

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
