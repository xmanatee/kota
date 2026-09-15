import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { isTerminalOwnerDecisionStatus, type OwnerDecisionRecord } from "#core/daemon/owner-decision-store.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import {
  getRepoHeadSha,
  getRepoWorktreeStatus,
} from "#core/util/repo-worktree.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { hasGeneratedWorkRetirement } from "#modules/autonomy/generated-work-task.js";
import { observeOwnerDecisions } from "#modules/autonomy/owner-decision-observation.js";
import { readPublishedRepoTaskQueue } from "#modules/repo-tasks/published-task-queue.js";
import { inspectRepoWorkSupply, resolveRepoWorkSupplyInput } from "#modules/repo-tasks/work-supply.js";
import type { ProgressReviewRequest } from "../progress-reviewer/events.js";
import { progressReviewDispatchKey } from "../progress-reviewer/semantic-input.js";
import { changedSystemicRuns, collectSystemicRuns, type SystemicRun, type SystemicWindow, systemicRunSchema } from "../progress-reviewer/systemic-evidence.js";
import {
  changedTaskPaths,
  taskTransitions,
} from "./semantic-task-transitions.js";

export type { ScopeBoundaryInspection } from "./semantic-scope-reflection.js";
export { inspectScopeSemanticBoundary } from "./semantic-scope-reflection.js";

export const PROGRESS_BOUNDARY_STATE_KEY =
  "dispatcher/progress-semantic-boundary";

const snapshotSchema = z.object({
  head: z.string(),
  ownerDecisionWatermark: z.string().nullable(),
  runs: z.array(systemicRunSchema),
  outcomeCohort: z.array(systemicRunSchema),
  observedAt: z.iso.datetime(),
}).strict();
const boundaryStateSchema = z.object({
  schemaVersion: z.literal(2),
  scopeId: z.string(),
  inputRevision: z.number().int().nonnegative(),
  baseline: snapshotSchema,
  pending: snapshotSchema.nullable(),
}).strict();
export type ProgressBoundaryState = z.infer<typeof boundaryStateSchema>;

export type ProgressBoundaryInspection = {
  shouldEmit: boolean;
  reason: string;
  payload: ProgressReviewRequest | null;
  nextState: ProgressBoundaryState | null;
};

export function reserveObservedProgressBoundary(args: {
  observedState: unknown;
  currentState: unknown;
  consumedRevision: number;
  inspection: ProgressBoundaryInspection;
}): ProgressBoundaryInspection {
  if (args.inspection.shouldEmit && !Number.isSafeInteger(args.inspection.payload?.inputRevision)) {
    throw new Error("progress boundary observation requires an input revision");
  }
  if (!isDeepStrictEqual(args.observedState, args.currentState) ||
      (args.inspection.payload?.inputRevision !== undefined && args.inspection.payload.inputRevision <= args.consumedRevision)) {
    return { shouldEmit: false, reason: "progress window advanced after inspection; retain current revision authority", payload: null, nextState: null };
  }
  return args.inspection;
}

function resolvedDecisionKey(record: OwnerDecisionRecord): string | null {
  if (!isTerminalOwnerDecisionStatus(record.status)) {
    return null;
  }
  return `${record.updatedAt}:${record.id}`;
}

function latestOwnerDecisionWatermark(records: readonly OwnerDecisionRecord[]): string | null {
  return records
    .flatMap((record) => {
      const key = resolvedDecisionKey(record);
      return key ? [key] : [];
    })
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? null;
}

function outcomeProfile(run: SystemicRun): string {
  return JSON.stringify([run.workflow, run.status, run.delivery, run.errors]);
}

/** Compare like workflows with their last consumed outcome cohort.
 * Historical failures must not make every later healthy batch look like recovery.
 */
function outcomeYieldChanged(baseline: readonly SystemicRun[], current: readonly SystemicRun[]): boolean {
  for (const workflow of new Set(current.map((run) => run.workflow))) {
    const after = current.filter((run) => run.workflow === workflow);
    const before = baseline.filter((run) => !run.observationOnly && run.workflow === workflow);
    if (after.length < 2 || before.length < 2) continue;
    const profiles = new Set([...before, ...after].map(outcomeProfile));
    for (const profile of profiles) {
      const beforeCount = before.filter((run) => outcomeProfile(run) === profile).length;
      const afterCount = after.filter((run) => outcomeProfile(run) === profile).length;
      if (beforeCount * after.length !== afterCount * before.length) return true;
    }
  }
  return false;
}

export async function inspectProgressSemanticBoundary(args: {
  workspaceRoot: string;
  scopeRoot: string;
  stateDir: string;
  runtimeStateDir: string;
  progressBoundaryState: unknown;
  consumedRevision: number;
  runCommand: WorkflowCommandRunner;
}): Promise<ProgressBoundaryInspection> {
  const quiet = (reason: string, nextState: ProgressBoundaryState | null = null): ProgressBoundaryInspection =>
    ({ shouldEmit: false, reason, payload: null, nextState });
  const worktree = getRepoWorktreeStatus(args.scopeRoot);
  if (!worktree.available || worktree.dirty) {
    return quiet("systemic evidence is parked until the canonical worktree is clean");
  }
  const scopeId = deriveDirectoryScopeId(args.scopeRoot);
  const head = getRepoHeadSha(args.workspaceRoot);
  if (!head) return quiet("systemic evidence requires a canonical Git head");
  const now = new Date().toISOString();
  const collected = collectSystemicRuns(args.scopeRoot, args.stateDir);
  const ownerDecisions = observeOwnerDecisions(args.stateDir, scopeId);
  const current = {
    head,
    ownerDecisionWatermark: latestOwnerDecisionWatermark(ownerDecisions),
    runs: collected.runs,
    observedAt: now,
  };
  // The old row observed commits without retaining rejected evidence. Preserve
  // its revision authority, then establish an honest baseline for the new window.
  const legacy = z.object({ schemaVersion: z.literal(1), scopeId: z.string(),
    lastObservedHead: z.string(), ownerDecisionWatermark: z.string().nullable(),
    parked: z.boolean(), inputRevision: z.number().int().nonnegative() }).strict();
  let previous: ProgressBoundaryState;
  if (args.progressBoundaryState === null || args.progressBoundaryState === undefined || legacy.safeParse(args.progressBoundaryState).success) {
    const old = args.progressBoundaryState == null ? null : legacy.parse(args.progressBoundaryState);
    if (old && old.scopeId !== scopeId) throw new Error("progress evidence belongs to another scope");
    previous = {
      schemaVersion: 2, scopeId, inputRevision: old?.inputRevision ?? 0,
      baseline: { ...current, head: old?.lastObservedHead || head,
        ownerDecisionWatermark: old?.ownerDecisionWatermark ?? current.ownerDecisionWatermark,
        runs: [], outcomeCohort: [], observedAt: collected.runs[0]?.startedAt ?? now },
      pending: null,
    };
  } else {
    previous = boundaryStateSchema.parse(args.progressBoundaryState);
    if (previous.scopeId !== scopeId) throw new Error("progress evidence belongs to another scope");
  }
  if (previous.pending) {
    if (args.consumedRevision < previous.inputRevision) {
      return quiet("systemic evidence window is reserved; newer evidence remains pending until publication", previous);
    }
    previous = { ...previous, baseline: previous.pending, pending: null };
  }
  const changes = await changedTaskPaths(args.runCommand, args.workspaceRoot, previous.baseline.head, head);
  if (changes === null) return quiet("systemic evidence Git range is unavailable; retained baseline was not consumed", previous);
  const transitions = taskTransitions(changes).filter((entry) => entry.fromState !== entry.toState);
  const decisions = ownerDecisions.flatMap((record) => {
    const key = resolvedDecisionKey(record);
    return key && (!previous.baseline.ownerDecisionWatermark || key > previous.baseline.ownerDecisionWatermark)
      ? [`.kota/owner-decisions/${record.id}.json`] : [];
  });
  const changedRuns = changedSystemicRuns(previous.baseline.runs, current.runs);
  const drivers = changedRuns.filter((run) => !run.observationOnly);
  const deliveries = transitions.filter((entry) => entry.toState === "done");
  // A generated proposal retirement is the review's own publication effect,
  // retained as context but never a new external disposition signal.
  const dispositions = transitions.filter((entry) =>
    (entry.toState === "blocked" || entry.toState === "dropped") &&
    !(entry.currentTask && hasGeneratedWorkRetirement({ task: entry.currentTask })));
  const queue = inspectRepoWorkSupply(resolveRepoWorkSupplyInput({ ...args, stateDir: args.runtimeStateDir }), readPublishedRepoTaskQueue(args.workspaceRoot));
  if (!queue.ownershipAvailable) return quiet("systemic evidence retained: queue ownership is unavailable", previous);
  // These are opportunities to compare independent outcomes, not architectural
  // conclusions or a build-count schedule. Source growth alone never admits AI.
  const baselineProfiles = new Set(previous.baseline.runs.filter((run) => !run.observationOnly).map(outcomeProfile));
  const changedOutcome = drivers.some((run) => !baselineProfiles.has(outcomeProfile(run)));
  const repeatedFailure = drivers.filter((run) => run.status !== "success" || run.errors.length > 0).length > 1;
  const crossRun = drivers.length > 1 && (changedOutcome || repeatedFailure || outcomeYieldChanged(previous.baseline.outcomeCohort, drivers));
  // Delivery backlog is not evidence that feedback can wait indefinitely.
  // Admit one reserved review for changed outcomes or owner feedback through
  // the normal queue; routine delivery-only reflection can use spare capacity.
  if (decisions.length === 0 && dispositions.length === 0 && !crossRun &&
      (queue.dispatchableCount > queue.availableCount || queue.availableCount + queue.runningCount + queue.queuedCount >= queue.capacity)) {
    return quiet("systemic evidence coalesced while useful builder work has priority", previous);
  }
  const deliveryBoundary = !queue.hasDispatchableWork && queue.runningCount === 0 && queue.queuedCount === 0 && deliveries.length > 1;
  const boundary = decisions.length > 0 ? "owner-decision-resolution" as const
    : dispositions.length > 0 ? "task-disposition" as const
    : crossRun || deliveryBoundary ? "evidence-window" as const : null;
  if (!boundary) return quiet("evidence-insufficient: retain the window until comparative outcomes or owner feedback change", previous);
  const inputRevision = previous.inputRevision + 1;
  const evidenceRefs = [...new Set([...transitions.flatMap((entry) => entry.refs), ...decisions,
    ...changedRuns.map((run) => `.kota/runs/${run.id}/metadata.json`)])].sort();
  const evidenceWindow: SystemicWindow = {
    fromHead: previous.baseline.head, toHead: head,
    startedAt: previous.baseline.observedAt, endedAt: now,
    baseline: previous.baseline.runs, current: changedRuns, excluded: collected.excluded,
  };
  return {
    shouldEmit: true,
    reason: `${boundary}: coalesced outcomes are ready for agent assessment; sufficiency is decision-dependent`,
    nextState: { ...previous, inputRevision, pending: { ...current,
      outcomeCohort: [
        ...previous.baseline.outcomeCohort.filter((run) => !drivers.some((driver) => driver.workflow === run.workflow)),
        ...drivers,
      ],
    } },
    payload: {
      automatic: true, boundary, inputRevision, deliveryAttempt: 0,
      idempotencyKey: progressReviewDispatchKey(scopeId, inputRevision, 0),
      evidenceRefs, evidenceWindow,
      reason: "Compare retained outcomes, challenge hypotheses, and follow integrated interventions",
      requestedBy: "dispatcher",
    },
  };
}
