import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PAUSE_SIGNAL_FILE } from "#core/workflow/runtime.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#root/json-file.js";
import { countRepoTaskState } from "#core/data/repo-tasks.js";
import {
  computeCostByWorkflow,
  loadRecentRuns,
  type RunSummary,
} from "#modules/autonomy/shared.js";

const DIGEST_EVERY_N_RUNS = 10;
const DEFAULT_COST_WARN_THRESHOLD_USD = 25;
const DEFAULT_COST_HARD_LIMIT_USD = 50;
// KOTA_DIGEST_WARNINGS_COUNT: number of builder runs with warnings to trigger the check (default 3)
// KOTA_DIGEST_WARNINGS_WINDOW: how many recent builder runs to inspect (default 10)
const DEFAULT_WARNINGS_COUNT = 3;
const DEFAULT_WARNINGS_WINDOW = 10;

type AttentionItem = { label: string; detail: string };

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

  const totalCost = Object.values(computeCostByWorkflow(recentRuns)).reduce(
    (a, b) => a + b,
    0,
  );
  const threshold =
    Number(process.env.KOTA_DIGEST_COST_THRESHOLD) ||
    DEFAULT_COST_WARN_THRESHOLD_USD;
  if (totalCost > threshold) {
    items.push({
      label: "Budget pressure",
      detail: `$${totalCost.toFixed(2)} spent in last 24h (threshold: $${threshold})`,
    });
  }

  const doingCount = countRepoTaskState(projectDir, "doing");
  if (doingCount >= 2) {
    items.push({
      label: "Stalled work",
      detail: `${doingCount} tasks stuck in doing`,
    });
  }

  const blockedCount = countRepoTaskState(projectDir, "blocked");
  if (blockedCount >= 2) {
    items.push({
      label: "Blocked backlog",
      detail: `${blockedCount} blocked tasks`,
    });
  }

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

  const recentRuns = loadRecentRuns(runsDir);
  const totalCost = Object.values(computeCostByWorkflow(recentRuns)).reduce(
    (a, b) => a + b,
    0,
  );
  const hardLimit =
    Number(process.env.KOTA_COST_HARD_LIMIT_USD) || DEFAULT_COST_HARD_LIMIT_USD;

  if (totalCost > hardLimit) {
    writeFileSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE), "");
    const text = `Cost circuit breaker tripped: $${totalCost.toFixed(2)} spent in last 24h (hard limit: $${hardLimit}). Autonomous dispatch paused. Delete \`.kota/${PAUSE_SIGNAL_FILE}\` to resume.`;
    emit?.("workflow.cost.limit.reached", {
      totalCost,
      hardLimit,
      text,
      pauseSignalFile: PAUSE_SIGNAL_FILE,
    });
    return;
  }

  const items = detectAttentionItems(projectDir, recentRuns);
  if (items.length === 0) return;

  const text = buildDigestText(items);
  emit?.("workflow.attention.digest", {
    items,
    text,
  });
}
