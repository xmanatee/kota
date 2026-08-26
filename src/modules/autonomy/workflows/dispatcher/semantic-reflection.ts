import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OwnerDecisionRecord } from "#core/daemon/owner-decision-store.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  getRepoHeadSha,
  getRepoWorktreeStatus,
} from "#core/util/repo-worktree.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  getRepoTaskQueueSnapshot,
  listFullRepoTasks,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import type { ProgressReviewRequest } from "../progress-reviewer/events.js";
import { progressReviewDispatchKey } from "../progress-reviewer/semantic-input.js";
import {
  changedTaskPaths,
  isStrategicCompletion,
  taskTransitions,
} from "./semantic-task-transitions.js";

export type { ScopeBoundaryInspection } from "./semantic-scope-reflection.js";
export { inspectScopeSemanticBoundary } from "./semantic-scope-reflection.js";

export const PROGRESS_BOUNDARY_STATE_KEY =
  "dispatcher/progress-semantic-boundary";

export type ProgressBoundaryState = {
  schemaVersion: 1;
  scopeId: string;
  lastObservedHead: string;
  ownerDecisionWatermark: string | null;
  parked: boolean;
  inputRevision: number;
};

export type ProgressBoundaryInspection = {
  shouldEmit: boolean;
  reason: string;
  payload: ProgressReviewRequest | null;
  nextState: ProgressBoundaryState | null;
};

function ownerDecisionRecords(stateDir: string): OwnerDecisionRecord[] {
  const directory = join(stateDir, "owner-decisions");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((file) => /^[0-9a-f]{8}\.json$/.test(file))
    .flatMap((file) => {
      const record = readOptionalJsonFile<OwnerDecisionRecord>(join(directory, file));
      return record ? [record] : [];
    });
}

function resolvedDecisionKey(record: OwnerDecisionRecord): string | null {
  if (
    record.status !== "answered" &&
    record.status !== "canceled" &&
    record.status !== "expired" &&
    record.status !== "consumed"
  ) {
    return null;
  }
  return `${record.updatedAt}:${record.id}`;
}

function latestOwnerDecisionWatermark(stateDir: string): string | null {
  return ownerDecisionRecords(stateDir)
    .flatMap((record) => {
      const key = resolvedDecisionKey(record);
      return key ? [key] : [];
    })
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? null;
}

export async function inspectProgressSemanticBoundary(args: {
  projectDir: string;
  scopeDir: string;
  stateDir: string;
  progressBoundaryState: ProgressBoundaryState | null;
  runCommand: WorkflowCommandRunner;
}): Promise<ProgressBoundaryInspection> {
  const worktree = getRepoWorktreeStatus(args.scopeDir);
  if (!worktree.available || worktree.dirty) {
    return {
      shouldEmit: false,
      reason: "semantic progress input is parked until the canonical worktree is clean",
      payload: null,
      nextState: null,
    };
  }
  const scopeId = deriveDirectoryScopeId(args.scopeDir);
  const head = getRepoHeadSha(args.projectDir);
  const queue = getRepoTaskQueueSnapshot(args.projectDir);
  const parked = queue.openCount > 0 && !queue.hasDispatchableWork;
  const ownerWatermark = latestOwnerDecisionWatermark(args.stateDir);
  const stored = args.progressBoundaryState;
  const previous = stored?.scopeId === scopeId ? stored : null;
  if (!previous || !head) {
    const nextState: ProgressBoundaryState = {
      schemaVersion: 1,
      scopeId,
      lastObservedHead: head,
      ownerDecisionWatermark: ownerWatermark,
      parked,
      inputRevision: previous?.inputRevision ?? 0,
    };
    return {
      shouldEmit: false,
      reason: "initialized semantic progress watermark",
      payload: null,
      nextState,
    };
  }

  const changedPaths = await changedTaskPaths(
    args.runCommand,
    args.projectDir,
    previous.lastObservedHead,
    head,
  );
  if (changedPaths === null) {
    const nextState: ProgressBoundaryState = {
      ...previous,
      lastObservedHead: head,
      ownerDecisionWatermark: ownerWatermark,
      parked,
    };
    return {
      shouldEmit: false,
      reason: "reset semantic progress watermark after an unavailable Git range",
      payload: null,
      nextState,
    };
  }

  const transitions = taskTransitions(changedPaths).filter(
    (transition) => transition.fromState !== transition.toState,
  );
  const taskById = new Map(
    listFullRepoTasks(args.projectDir).map((task) => [task.id, task]),
  );
  const dispositions = transitions.filter(
    (transition) =>
      transition.toState === "blocked" || transition.toState === "dropped",
  );
  const strategic = transitions.filter((transition) =>
    isStrategicCompletion({ ...transition, task: taskById.get(transition.id) })
  );
  const newlyResolvedDecisions = ownerDecisionRecords(args.stateDir)
    .flatMap((record) => {
      const key = resolvedDecisionKey(record);
      if (!key || (previous.ownerDecisionWatermark && key <= previous.ownerDecisionWatermark)) {
        return [];
      }
      return [{ key, ref: `.kota/owner-decisions/${record.id}.json` }];
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const boundary = dispositions.length > 0
    ? "task-disposition" as const
    : strategic.length > 0
      ? "strategic-completion" as const
      : !previous.parked && parked && transitions.length > 0
        ? "parked-queue" as const
        : newlyResolvedDecisions.length > 0
          ? "owner-decision-resolution" as const
          : null;
  const nextRevision = boundary ? previous.inputRevision + 1 : previous.inputRevision;
  const nextState: ProgressBoundaryState = {
    ...previous,
    lastObservedHead: head,
    ownerDecisionWatermark: ownerWatermark,
    parked,
    inputRevision: nextRevision,
  };
  if (!boundary) {
    return {
      shouldEmit: false,
      reason: "no accepted semantic progress boundary",
      payload: null,
      nextState,
    };
  }

  const transitionRefs = transitions.flatMap((transition) => transition.refs);
  const evidenceRefs = [
    ...new Set([
      ...transitionRefs,
      ...newlyResolvedDecisions.map((decision) => decision.ref),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  return {
    shouldEmit: true,
    reason: `${boundary} at semantic input revision ${nextRevision}`,
    nextState,
    payload: {
      automatic: true,
      boundary,
      inputRevision: nextRevision,
      deliveryAttempt: 0,
      idempotencyKey: progressReviewDispatchKey(scopeId, nextRevision, 0),
      evidenceRefs,
      reason: `${boundary} after canonical task/owner state changed`,
      requestedBy: "dispatcher",
    },
  };
}
