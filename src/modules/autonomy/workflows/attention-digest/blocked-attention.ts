import {
  parseBlockedPrecondition,
  readOperatorCaptureInstructedMarker,
  readOwnerAskMarkers,
} from "#modules/repo-tasks/blocked-precondition.js";
import {
  countRepoTaskState,
  listRepoTasksInState,
  type RepoTaskRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import type { AttentionItem } from "./step.js";

const DEFAULT_BLOCKED_AGE_DAYS = 3;
const DEFAULT_BLOCKED_AGED_DAYS = 14;
const MAX_INDIVIDUAL_BLOCKED_ITEMS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTION_COOLDOWN_MS = 14 * MS_PER_DAY;

type LongBlockedEntry = { record: RepoTaskRecord; ageDays: number };

function hasOwnerBlocker(body: string): boolean {
  const match = body.match(/(?:^|\n)##\s+Blocker\b[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  return match ? /\bowner\b/i.test(match[1]) : false;
}

function hasFreshActionMarker(record: RepoTaskRecord, nowMs: number): boolean {
  const parsed = parseBlockedPrecondition(`---\n---\n${record.body}`);
  if (!parsed.ok) return false;
  const precondition = parsed.precondition;
  if (precondition.kind === "owner-decision") {
    return readOwnerAskMarkers(record.body).some((marker) => {
      if (marker.slot !== precondition.slot) return false;
      const markedAt = Date.parse(marker.lastAskedAt);
      return !Number.isNaN(markedAt) && nowMs - markedAt < ACTION_COOLDOWN_MS;
    });
  }
  if (precondition.kind !== "operator-capture") return false;
  const marker = readOperatorCaptureInstructedMarker(record.body);
  if (!marker) return false;
  const markedAt = Date.parse(marker.lastInstructedAt);
  return !Number.isNaN(markedAt) && nowMs - markedAt < ACTION_COOLDOWN_MS;
}

function ageInDays(record: RepoTaskRecord, nowMs: number): number | null {
  const updatedAt = Date.parse(record.frontmatter.updatedAt);
  return Number.isNaN(updatedAt)
    ? null
    : Math.floor((nowMs - updatedAt) / MS_PER_DAY);
}

function findLongBlocked(
  records: RepoTaskRecord[],
  thresholdDays: number,
  nowMs: number,
): LongBlockedEntry[] {
  return records
    .flatMap((record) => {
      const ageDays = ageInDays(record, nowMs);
      return ageDays !== null && ageDays >= thresholdDays &&
        !hasFreshActionMarker(record, nowMs)
        ? [{ record, ageDays }]
        : [];
    })
    .sort((a, b) => b.ageDays - a.ageDays);
}

function isOperatorGated(record: RepoTaskRecord): boolean {
  const parsed = parseBlockedPrecondition(`---\n---\n${record.body}`);
  return parsed.ok && (
    parsed.precondition.kind === "owner-decision" ||
    parsed.precondition.kind === "operator-capture"
  );
}

function findOperatorGatedAged(
  records: RepoTaskRecord[],
  thresholdDays: number,
  nowMs: number,
): LongBlockedEntry[] {
  return records
    .flatMap((record) => {
      const ageDays = ageInDays(record, nowMs);
      return ageDays !== null && ageDays >= thresholdDays &&
        isOperatorGated(record) && !hasFreshActionMarker(record, nowMs)
        ? [{ record, ageDays }]
        : [];
    })
    .sort((a, b) => b.ageDays - a.ageDays);
}

export function blockedAttentionItems(workspaceRoot: string): AttentionItem[] {
  const blockedCount = countRepoTaskState(workspaceRoot, "blocked");
  if (blockedCount === 0) return [];

  const records = listRepoTasksInState(workspaceRoot, "blocked");
  const nowMs = Date.now();
  const longBlocked = findLongBlocked(
    records,
    Number(process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS) || DEFAULT_BLOCKED_AGE_DAYS,
    nowMs,
  );
  const operatorGatedAged = findOperatorGatedAged(
    records,
    Number(process.env.KOTA_DIGEST_BLOCKED_AGED_DAYS) || DEFAULT_BLOCKED_AGED_DAYS,
    nowMs,
  );
  const items: AttentionItem[] = [];
  if (blockedCount >= 2 && longBlocked.length < blockedCount) {
    items.push({ label: "Blocked backlog", detail: `${blockedCount} blocked tasks` });
  }
  for (const { record, ageDays } of longBlocked.slice(0, MAX_INDIVIDUAL_BLOCKED_ITEMS)) {
    items.push({
      label: hasOwnerBlocker(record.body) ? "Owner decision pending" : "Stale blocker",
      detail: `${record.frontmatter.id} (blocked ${ageDays}d)`,
    });
  }
  const tail = longBlocked.length - MAX_INDIVIDUAL_BLOCKED_ITEMS;
  if (tail > 0) {
    items.push({
      label: "More long-blocked tasks",
      detail: `${tail} additional blocked tasks past threshold`,
    });
  }
  for (const { record, ageDays } of operatorGatedAged) {
    items.push({
      label: "Operator-gated blocker aged",
      detail: `${record.frontmatter.id} (blocked ${ageDays}d, operator-gated precondition)`,
    });
  }
  return items;
}
