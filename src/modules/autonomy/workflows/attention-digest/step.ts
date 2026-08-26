import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { loadRecentRuns, type RunSummary } from "#modules/autonomy/shared.js";
import { countRepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import { blockedAttentionItems } from "./blocked-attention.js";

const DIGEST_EVERY_N_RUNS = 10;
export const ATTENTION_DIGEST_COUNTER_STATE_KEY = "attention-digest/counter";
// KOTA_DIGEST_WARNINGS_COUNT: number of builder runs with warnings to trigger the check (default 3)
// KOTA_DIGEST_WARNINGS_WINDOW: how many recent builder runs to inspect (default 10)
const DEFAULT_WARNINGS_COUNT = 3;
const DEFAULT_WARNINGS_WINDOW = 10;
// KOTA_DIGEST_BLOCKED_AGE_DAYS: a blocked task is "long-blocked" when its
// updated_at is older than this many days (default 3)
// KOTA_DIGEST_BLOCKED_AGED_DAYS: an additional escalation threshold for
// blocked tasks the autonomy loop genuinely cannot promote on its own —
// owner-decision and operator-capture preconditions surface here so they do
// not silently absorb queue capacity (default 14, matching the
// blocked-promoter owner-ask cadence).

export type AttentionItem = { label: string; detail: string };

export type RenderedAttention = {
  items: AttentionItem[];
  text: string;
};

export const NO_ATTENTION_ITEMS_TEXT = "No attention items right now.";

export type AttentionDigestStepInput = {
  projectDir: string;
  runsDir: string;
  count: number;
};

export type AttentionDigestStepResult = {
  event?: {
    name: "workflow.attention.digest";
    payload: RenderedAttention;
  };
};

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
 * Inspect one cadence count. Durable counter ownership belongs to the workflow
 * runtime; this worker only performs repository and run-history reads.
 */
export function inspectAttentionDigestStep(
  input: AttentionDigestStepInput,
): AttentionDigestStepResult {
  if (!Number.isSafeInteger(input.count) || input.count < 1) {
    throw new Error("Attention digest count must be a positive integer");
  }
  if (input.count % DIGEST_EVERY_N_RUNS !== 0) return {};

  const { items, text } = renderOnDemandAttention({
    projectDir: input.projectDir,
    runsDir: input.runsDir,
  });
  if (items.length === 0) return {};

  return {
    event: {
      name: "workflow.attention.digest",
      payload: { items, text },
    },
  };
}

export const attentionDigestStepOperation = defineWorkflowBlockingOperation<
  AttentionDigestStepInput,
  AttentionDigestStepResult
>(import.meta.url, "inspectAttentionDigestStep");
