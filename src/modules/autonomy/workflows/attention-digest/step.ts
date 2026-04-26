import { join } from "node:path";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { loadRecentRuns, type RunSummary } from "#modules/autonomy/shared.js";
import { parseBlockedPrecondition } from "#modules/repo-tasks/blocked-precondition.js";
import {
  countRepoTaskState,
  listRepoTasksInState,
  type RepoTaskRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";

const DIGEST_EVERY_N_RUNS = 10;
// KOTA_DIGEST_WARNINGS_COUNT: number of builder runs with warnings to trigger the check (default 3)
// KOTA_DIGEST_WARNINGS_WINDOW: how many recent builder runs to inspect (default 10)
const DEFAULT_WARNINGS_COUNT = 3;
const DEFAULT_WARNINGS_WINDOW = 10;
// KOTA_DIGEST_BLOCKED_AGE_DAYS: a blocked task is "long-blocked" when its
// updated_at is older than this many days (default 3)
const DEFAULT_BLOCKED_AGE_DAYS = 3;
// KOTA_DIGEST_BLOCKED_AGED_DAYS: an additional escalation threshold for
// blocked tasks the autonomy loop genuinely cannot promote on its own —
// owner-decision and operator-capture preconditions surface here so they do
// not silently absorb queue capacity (default 14, matching the
// blocked-promoter owner-ask cadence).
const DEFAULT_BLOCKED_AGED_DAYS = 14;
const MAX_INDIVIDUAL_BLOCKED_ITEMS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type AttentionItem = { label: string; detail: string };

export type RenderedAttention = {
  items: AttentionItem[];
  text: string;
};

export const NO_ATTENTION_ITEMS_TEXT = "No attention items right now.";

function builderFailureStreak(recentRuns: RunSummary[]): number {
  // recentRuns is most-recent-first; count consecutive builder failures from the head
  let streak = 0;
  for (const run of recentRuns) {
    if (run.workflow !== "builder") continue;
    if (run.status === "failed" || run.status === "interrupted") {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function builderWarningsCheck(recentRuns: RunSummary[]): AttentionItem | null {
  const countN =
    Number(process.env.KOTA_DIGEST_WARNINGS_COUNT) || DEFAULT_WARNINGS_COUNT;
  const windowM =
    Number(process.env.KOTA_DIGEST_WARNINGS_WINDOW) || DEFAULT_WARNINGS_WINDOW;

  const builderRuns = recentRuns
    .filter((r) => r.workflow === "builder")
    .slice(0, windowM);

  const warningRuns = builderRuns.filter(
    (r) => r.status === "completed-with-warnings",
  );

  if (warningRuns.length < countN) return null;

  // Collect all warning types across the warning runs
  const allTypes = warningRuns.flatMap((r) =>
    (r.warnings ?? []).map((w) => w.type),
  );
  const allSameType =
    allTypes.length > 0 && allTypes.every((t) => t === allTypes[0]);

  const detail = allSameType
    ? `${warningRuns.length} of the last ${builderRuns.length} builder runs completed with warnings (${allTypes[0]})`
    : `${warningRuns.length} of the last ${builderRuns.length} builder runs completed with warnings`;

  return { label: "Repeated warnings", detail };
}

function hasOwnerBlocker(body: string): boolean {
  const match = body.match(/(?:^|\n)##\s+Blocker\b[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!match) return false;
  return /\bowner\b/i.test(match[1]);
}

type LongBlockedEntry = { record: RepoTaskRecord; ageDays: number };

function findLongBlocked(
  records: RepoTaskRecord[],
  thresholdDays: number,
  nowMs: number,
): LongBlockedEntry[] {
  const entries: LongBlockedEntry[] = [];
  for (const record of records) {
    const updatedMs = Date.parse(record.frontmatter.updatedAt);
    if (Number.isNaN(updatedMs)) continue;
    const ageDays = Math.floor((nowMs - updatedMs) / MS_PER_DAY);
    if (ageDays >= thresholdDays) entries.push({ record, ageDays });
  }
  entries.sort((a, b) => b.ageDays - a.ageDays);
  return entries;
}

function findOperatorGatedAged(
  records: RepoTaskRecord[],
  thresholdDays: number,
  nowMs: number,
): LongBlockedEntry[] {
  const entries: LongBlockedEntry[] = [];
  for (const record of records) {
    const updatedMs = Date.parse(record.frontmatter.updatedAt);
    if (Number.isNaN(updatedMs)) continue;
    const ageDays = Math.floor((nowMs - updatedMs) / MS_PER_DAY);
    if (ageDays < thresholdDays) continue;
    const parsed = parseBlockedPrecondition(
      `---\n---\n${record.body}`,
    );
    if (!parsed.ok) continue;
    if (
      parsed.precondition.kind === "owner-decision" ||
      parsed.precondition.kind === "operator-capture"
    ) {
      entries.push({ record, ageDays });
    }
  }
  entries.sort((a, b) => b.ageDays - a.ageDays);
  return entries;
}

function blockedAttentionItems(projectDir: string): AttentionItem[] {
  const blockedCount = countRepoTaskState(projectDir, "blocked");
  if (blockedCount === 0) return [];

  const threshold =
    Number(process.env.KOTA_DIGEST_BLOCKED_AGE_DAYS) || DEFAULT_BLOCKED_AGE_DAYS;
  const agedThreshold =
    Number(process.env.KOTA_DIGEST_BLOCKED_AGED_DAYS) || DEFAULT_BLOCKED_AGED_DAYS;
  const records = listRepoTasksInState(projectDir, "blocked");
  const longBlocked = findLongBlocked(records, threshold, Date.now());
  const operatorGatedAged = findOperatorGatedAged(records, agedThreshold, Date.now());

  const items: AttentionItem[] = [];
  // Aggregate pressure remains visible unless every blocked task is already
  // surfaced individually — otherwise operators would see the same tasks twice.
  if (blockedCount >= 2 && longBlocked.length < blockedCount) {
    items.push({
      label: "Blocked backlog",
      detail: `${blockedCount} blocked tasks`,
    });
  }

  const shown = longBlocked.slice(0, MAX_INDIVIDUAL_BLOCKED_ITEMS);
  for (const { record, ageDays } of shown) {
    const label = hasOwnerBlocker(record.body)
      ? "Owner decision pending"
      : "Stale blocker";
    items.push({
      label,
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

  // Operator-gated preconditions (owner-decision, operator-capture) cannot
  // auto-promote, so an aged one needs operator attention rather than another
  // autonomy retry. Surface them explicitly past the longer aging threshold.
  for (const { record, ageDays } of operatorGatedAged) {
    items.push({
      label: "Operator-gated blocker aged",
      detail: `${record.frontmatter.id} (blocked ${ageDays}d, operator-gated precondition)`,
    });
  }
  return items;
}

function detectAttentionItems(
  projectDir: string,
  recentRuns: RunSummary[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  const streak = builderFailureStreak(recentRuns);
  if (streak >= 3) {
    items.push({
      label: "Builder failure streak",
      detail: `${streak} consecutive failures`,
    });
  }

  const warningsItem = builderWarningsCheck(recentRuns);
  if (warningsItem) items.push(warningsItem);

  const doingCount = countRepoTaskState(projectDir, "doing");
  if (doingCount >= 2) {
    items.push({
      label: "Stalled work",
      detail: `${doingCount} tasks stuck in doing`,
    });
  }

  items.push(...blockedAttentionItems(projectDir));

  const readyCount = countRepoTaskState(projectDir, "ready");
  if (readyCount === 0) {
    items.push({
      label: "Empty ready queue",
      detail: "Builder has nothing to pull.",
    });
  }

  const backlogCount = countRepoTaskState(projectDir, "backlog");
  if (backlogCount === 0) {
    items.push({
      label: "Empty backlog",
      detail: "No reserves for explorer to promote.",
    });
  }

  return items;
}

function buildDigestText(items: AttentionItem[]): string {
  const header = `Attention digest (${items.length} item${items.length === 1 ? "" : "s"}):`;
  const body = items
    .map((item) => `• *${item.label}*: ${item.detail}`)
    .join("\n");
  return `${header}\n${body}`;
}

/**
 * Operator-initiated attention digest body. Runs the same detector + renderer
 * the cadence step uses, but does not touch the cadence counter and does not
 * emit `workflow.attention.digest`. When no items warrant attention the body
 * is a short fixed reply rather than the cadence-style empty header.
 *
 * Operator-facing only — this output must not be exposed to autonomy agents
 * in any prompt path.
 */
export function renderOnDemandAttention(opts: {
  projectDir: string;
  runsDir: string;
}): RenderedAttention {
  const recentRuns = loadRecentRuns(opts.runsDir);
  const items = detectAttentionItems(opts.projectDir, recentRuns);
  const text =
    items.length === 0 ? NO_ATTENTION_ITEMS_TEXT : buildDigestText(items);
  return { items, text };
}

/**
 * Run one attention digest step. Increments the persistent counter and, every
 * DIGEST_EVERY_N_RUNS invocations, checks for attention items and emits bus
 * events when any are found.
 *
 * Called directly by the attention-digest workflow code step.
 */
export function runAttentionDigestStep(
  projectDir: string,
  runsDir: string,
  _log?: (message: string) => void,
  emit?: (event: string, payload: Record<string, unknown>) => void,
): void {
  // Counter is persisted so it survives daemon restarts (which happen after every builder build).
  const counterFile = join(runsDir, "..", "attention-digest-counter.json");

  const saved = readOptionalJsonFile<{ count: number }>(counterFile);
  const count = (saved?.count ?? 0) + 1;
  writeJsonFileAtomic(counterFile, { count });
  if (count % DIGEST_EVERY_N_RUNS !== 0) return;

  const { items, text } = renderOnDemandAttention({ projectDir, runsDir });
  if (items.length === 0) return;

  emit?.("workflow.attention.digest", {
    items,
    text,
  });
}
