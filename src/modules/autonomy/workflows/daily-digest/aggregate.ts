/**
 * Pure aggregation for the operator-facing daily digest. Reads only what is
 * already on disk: per-run metadata under `.kota/runs/`, optional builder
 * runtime-owned writer integration evidence for commit enrichment, the blocked
 * task tree (with typed unblock preconditions), and the in-process owner
 * question queue.
 *
 * Intentionally has no I/O beyond reads — emit and persistence are the
 * workflow step's responsibility — and no dependency on any agent context,
 * so the digest cannot leak cost/throughput signals into autonomy prompts.
 */

import { join } from "node:path";
import type {
  OwnerQuestionQueue,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { readAutonomyRunDeliveryEvidence } from "#modules/autonomy/run-delivery-evidence.js";
import { parseBlockedPrecondition } from "#modules/repo-tasks/blocked-precondition.js";
import {
  listRepoTasksInState,
  type RepoTaskRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";

export const DEFAULT_DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Max individual rows surfaced per category before tail summarization. */
const PER_CATEGORY_LIMIT = 5;
/**
 * Operator-capture preconditions are surfaced as aging once they sit past
 * this threshold; matches the attention-digest / blocked-promoter cadence.
 */
const OPERATOR_CAPTURE_AGED_DAYS = 14;

export type BuilderCommitItem = {
  runId: string;
  taskId: string | null;
  taskTitle: string | null;
  commitSubject: string;
  durationMs: number | null;
};

export type WorkflowRunRow = {
  runId: string;
  workflow: string;
  status: WorkflowRunMetadata["status"];
};

export type DecomposerSplitItem = {
  runId: string;
  parentTaskId: string | null;
  childTaskCount: number;
};

export type BlockedPromoterMoveItem = {
  runId: string;
  promotedTaskIds: string[];
  toOpen: string[];
};

export type ExplorerAdditionItem = {
  runId: string;
  taskCount: number;
  watchlistAdds: number;
};

export type FailedRunItem = {
  runId: string;
  workflow: string;
  status: "failed" | "interrupted";
  startedAt: string;
};

export type PendingOwnerQuestionItem = {
  id: string;
  question: string;
  source: string;
  ageDays: number;
};

export type AgingOperatorCaptureItem = {
  taskId: string;
  ageDays: number;
  path: string;
};

export type QueueCounts = {
  open: number;
  blocked: number;
};

export type QueueDelta = {
  current: QueueCounts;
  previous: QueueCounts | null;
  /** current - previous for each state; null entries when no previous snapshot. */
  delta: { [K in keyof QueueCounts]: number | null };
};

export type DailyDigestData = {
  windowStartedAt: string;
  windowEndedAt: string;
  builderCommits: BuilderCommitItem[];
  explorerAdditions: ExplorerAdditionItem[];
  decomposerSplits: DecomposerSplitItem[];
  blockedPromoterMoves: BlockedPromoterMoveItem[];
  failedMonitoredRuns: FailedRunItem[];
  pendingOwnerQuestions: PendingOwnerQuestionItem[];
  agingOperatorCaptures: AgingOperatorCaptureItem[];
  queueDelta: QueueDelta;
  /** True when every category in this window has zero entries. */
  quiet: boolean;
};

export type DailyDigestInput = {
  runsDir: string;
  stateDir: string;
  workspaceRoot: string;
  ownerQuestions: OwnerQuestionQueue;
  windowEndMs: number;
  windowMs?: number;
  previousQueueCounts: QueueCounts | null;
  currentQueueCounts: QueueCounts;
};

export function aggregateDailyDigest(input: DailyDigestInput): DailyDigestData {
  const windowMs = input.windowMs ?? DEFAULT_DIGEST_WINDOW_MS;
  const windowStartMs = input.windowEndMs - windowMs;
  const allRuns = loadRunsInWindow(input.runsDir, windowStartMs, {
    stateDir: input.stateDir,
    scopeRoot: input.workspaceRoot,
  });

  const builderCommits = collectBuilderCommits(allRuns, input.runsDir).slice(
    0,
    PER_CATEGORY_LIMIT,
  );
  const explorerAdditions = collectExplorerAdditions(allRuns, input.runsDir).slice(
    0,
    PER_CATEGORY_LIMIT,
  );
  const decomposerSplits = collectDecomposerSplits(allRuns, input.runsDir).slice(
    0,
    PER_CATEGORY_LIMIT,
  );
  const blockedPromoterMoves = collectBlockedPromoterMoves(allRuns).slice(
    0,
    PER_CATEGORY_LIMIT,
  );
  const failedMonitoredRuns = collectFailedMonitoredRuns(allRuns).slice(
    0,
    PER_CATEGORY_LIMIT,
  );
  const pendingOwnerQuestions = collectPendingOwnerQuestions(
    input.ownerQuestions.list("pending"),
    input.windowEndMs,
  );
  const agingOperatorCaptures = collectAgingOperatorCaptures(
    listRepoTasksInState(input.workspaceRoot, "blocked"),
    input.windowEndMs,
  );

  const queueDelta = computeQueueDelta(
    input.currentQueueCounts,
    input.previousQueueCounts,
  );

  const quiet =
    builderCommits.length === 0 &&
    explorerAdditions.length === 0 &&
    decomposerSplits.length === 0 &&
    blockedPromoterMoves.length === 0 &&
    failedMonitoredRuns.length === 0 &&
    pendingOwnerQuestions.length === 0 &&
    agingOperatorCaptures.length === 0;

  return {
    windowStartedAt: new Date(windowStartMs).toISOString(),
    windowEndedAt: new Date(input.windowEndMs).toISOString(),
    builderCommits,
    explorerAdditions,
    decomposerSplits,
    blockedPromoterMoves,
    failedMonitoredRuns,
    pendingOwnerQuestions,
    agingOperatorCaptures,
    queueDelta,
    quiet,
  };
}

function collectBuilderCommits(
  runs: WorkflowRunMetadata[],
  runsDir: string,
): BuilderCommitItem[] {
  const items: BuilderCommitItem[] = [];
  for (const run of runs) {
    if (run.workflow !== "builder") continue;
    if (run.status !== "success" && run.status !== "completed-with-warnings") {
      continue;
    }
    const delivery = readAutonomyRunDeliveryEvidence(runsDir, run);
    if (!delivery) continue;
    items.push({
      runId: run.id,
      taskId: delivery.taskId,
      taskTitle: delivery.taskTitle,
      commitSubject: delivery.commitSubject ?? "",
      durationMs: delivery.durationMs,
    });
  }
  return items;
}

function collectExplorerAdditions(
  runs: WorkflowRunMetadata[],
  runsDir: string,
): ExplorerAdditionItem[] {
  const items: ExplorerAdditionItem[] = [];
  for (const run of runs) {
    if (run.workflow !== "explorer") continue;
    if (run.status !== "success") continue;
    const apply = run.steps.find((s) => s.id === "apply-watchlist-updates");
    const watchlistAdds = readWatchlistAddCount(apply?.output);
    const taskCount = countCommittedTaskAdditions(run, runsDir);
    if (taskCount === 0 && watchlistAdds === 0) continue;
    items.push({ runId: run.id, taskCount, watchlistAdds });
  }
  return items;
}

function readWatchlistAddCount(output: unknown): number {
  if (!output || typeof output !== "object") return 0;
  const apply = output as { applied?: { kind?: string }[] };
  if (!Array.isArray(apply.applied)) return 0;
  return apply.applied.filter((entry) => entry.kind === "added").length;
}

function countCommittedTaskAdditions(
  run: WorkflowRunMetadata,
  runsDir: string,
): number {
  return readAutonomyRunDeliveryEvidence(runsDir, run)?.changedPaths.filter(
    (path) => /^data\/tasks\/task-.*\.md$/.test(path),
  ).length ?? 0;
}

function collectDecomposerSplits(
  runs: WorkflowRunMetadata[],
  runsDir: string,
): DecomposerSplitItem[] {
  const items: DecomposerSplitItem[] = [];
  for (const run of runs) {
    if (run.workflow !== "decomposer") continue;
    if (run.status !== "success") continue;
    const decompose = run.steps.find((s) => s.id === "decompose");
    if (!decompose || decompose.status !== "success") continue;
    const assess = run.steps.find((s) => s.id === "assess-failure");
    const assessOutput = assess?.output as
      | { taskId?: string; shouldDecompose?: boolean }
      | undefined;
    const parentTaskId = assessOutput?.taskId ?? null;
    const childTaskCount = countDecomposerChildren(run, runsDir);
    items.push({ runId: run.id, parentTaskId, childTaskCount });
  }
  return items;
}

function countDecomposerChildren(
  run: WorkflowRunMetadata,
  runsDir: string,
): number {
  return readAutonomyRunDeliveryEvidence(runsDir, run)?.changedPaths.filter(
    (path) => /^data\/tasks\/task-.*\.md$/.test(path),
  ).length ?? 0;
}

function collectBlockedPromoterMoves(
  runs: WorkflowRunMetadata[],
): BlockedPromoterMoveItem[] {
  const items: BlockedPromoterMoveItem[] = [];
  for (const run of runs) {
    if (run.workflow !== "blocked-promoter") continue;
    const emit = run.steps.find((s) => s.id === "emit-promoted");
    if (!emit || emit.status !== "success") continue;
    const det = run.steps.find((s) => s.id === "promote-deterministic")
      ?.output as { promotions?: { id: string; toState: string }[] } | undefined;
    const after = run.steps.find((s) => s.id === "promote-after-approval")
      ?.output as { promotions?: { id: string; toState: string }[] } | undefined;
    const all = [
      ...(det?.promotions ?? []),
      ...(after?.promotions ?? []),
    ];
    if (all.length === 0) continue;
    items.push({
      runId: run.id,
      promotedTaskIds: all.map((m) => m.id),
      toOpen: all.filter((m) => m.toState === "open").map((m) => m.id),
    });
  }
  return items;
}

function collectFailedMonitoredRuns(
  runs: WorkflowRunMetadata[],
): FailedRunItem[] {
  const items: FailedRunItem[] = [];
  for (const run of runs) {
    if (!Array.isArray(run.tags) || !run.tags.includes("monitored")) continue;
    if (run.status !== "failed" && run.status !== "interrupted") continue;
    items.push({
      runId: run.id,
      workflow: run.workflow,
      status: run.status,
      startedAt: run.startedAt,
    });
  }
  return items;
}

function collectPendingOwnerQuestions(
  pending: PendingOwnerQuestion[],
  nowMs: number,
): PendingOwnerQuestionItem[] {
  return pending
    .map((q) => ({
      id: q.id,
      question: q.question,
      source: q.source,
      ageDays: Math.max(
        0,
        Math.floor((nowMs - new Date(q.createdAt).getTime()) / MS_PER_DAY),
      ),
    }))
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, PER_CATEGORY_LIMIT);
}

function collectAgingOperatorCaptures(
  blockedRecords: RepoTaskRecord[],
  nowMs: number,
): AgingOperatorCaptureItem[] {
  const items: AgingOperatorCaptureItem[] = [];
  for (const record of blockedRecords) {
    const updatedMs = Date.parse(record.observedModifiedAt);
    if (Number.isNaN(updatedMs)) continue;
    const ageDays = Math.floor((nowMs - updatedMs) / MS_PER_DAY);
    if (ageDays < OPERATOR_CAPTURE_AGED_DAYS) continue;
    const parsed = parseBlockedPrecondition(`---\n---\n${record.body}`);
    if (!parsed.ok) continue;
    if (parsed.precondition.kind !== "operator-capture") continue;
    items.push({
      taskId: record.id,
      ageDays,
      path: parsed.precondition.path,
    });
  }
  return items
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, PER_CATEGORY_LIMIT);
}

function computeQueueDelta(
  current: QueueCounts,
  previous: QueueCounts | null,
): QueueDelta {
  const delta: QueueDelta["delta"] = {
    open: previous ? current.open - previous.open : null,
    blocked: previous ? current.blocked - previous.blocked : null,
  };
  return { current, previous, delta };
}

export type DigestState = {
  /** ISO timestamp the snapshot was captured. */
  capturedAt: string;
  /** Queue counts at the time of capture. */
  counts: QueueCounts;
};

export function digestStateFromCounts(
  counts: QueueCounts,
  nowMs: number,
): DigestState {
  return {
    capturedAt: new Date(nowMs).toISOString(),
    counts: {
      open: counts.open,
      blocked: counts.blocked,
    },
  };
}

/**
 * Read raw JSON metadata (used by tests when fixturing run directories).
 * Exported so the workflow test does not duplicate the schema.
 */
export function readRunMetadataFile(
  runsDir: string,
  runId: string,
): WorkflowRunMetadata | null {
  return readWorkflowRunMetadataFile(join(runsDir, runId, "metadata.json"));
}
