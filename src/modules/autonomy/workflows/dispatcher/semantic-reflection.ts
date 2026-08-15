import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OwnerDecisionRecord } from "#core/daemon/owner-decision-store.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import {
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";
import {
  getRepoHeadSha,
  getRepoWorktreeStatus,
} from "#core/util/repo-worktree.js";
import {
  getClaimAwareRepoTaskQueueSnapshot,
} from "#modules/autonomy/queue-availability.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { ProgressReviewRequest } from "../progress-reviewer/events.js";
import {
  progressReviewDispatchKey,
  readPendingProgressReviewInput,
  recordProgressReviewInputQueued,
} from "../progress-reviewer/semantic-input.js";
import {
  changedTaskPaths,
  isStrategicCompletion,
  taskTransitions,
} from "./semantic-task-transitions.js";

export type { ScopeBoundaryInspection } from "./semantic-scope-reflection.js";
export {
  inspectScopeSemanticBoundary,
  recordScopeSemanticBoundaryQueued,
} from "./semantic-scope-reflection.js";

const PROGRESS_BOUNDARY_STATE = join(
  ".kota",
  "progress-reviewer",
  "semantic-boundary-state.json",
);

type ProgressBoundaryState = {
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
};

function readProgressBoundaryState(
  projectDir: string,
): ProgressBoundaryState | null {
  const state = readOptionalJsonFile<Partial<ProgressBoundaryState>>(
    join(projectDir, PROGRESS_BOUNDARY_STATE),
  );
  if (
    state?.schemaVersion !== 1 ||
    typeof state.scopeId !== "string" ||
    typeof state.lastObservedHead !== "string" ||
    (state.ownerDecisionWatermark !== null &&
      typeof state.ownerDecisionWatermark !== "string") ||
    typeof state.parked !== "boolean" ||
    typeof state.inputRevision !== "number"
  ) {
    return null;
  }
  return state as ProgressBoundaryState;
}

function ownerDecisionRecords(projectDir: string): OwnerDecisionRecord[] {
  const directory = join(projectDir, ".kota", "owner-decisions");
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

function latestOwnerDecisionWatermark(projectDir: string): string | null {
  return ownerDecisionRecords(projectDir)
    .flatMap((record) => {
      const key = resolvedDecisionKey(record);
      return key ? [key] : [];
    })
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? null;
}

function writeProgressBoundaryState(
  projectDir: string,
  state: ProgressBoundaryState,
): void {
  writeJsonFileAtomic(join(projectDir, PROGRESS_BOUNDARY_STATE), state);
}

export function inspectProgressSemanticBoundary(args: {
  projectDir: string;
}): ProgressBoundaryInspection {
  const worktree = getRepoWorktreeStatus(args.projectDir);
  if (!worktree.available || worktree.dirty) {
    return {
      shouldEmit: false,
      reason: "semantic progress input is parked until the canonical worktree is clean",
      payload: null,
    };
  }
  const scopeId = deriveDirectoryScopeId(args.projectDir);
  const head = getRepoHeadSha(args.projectDir);
  const queue = getClaimAwareRepoTaskQueueSnapshot(args.projectDir);
  const parked = queue.openCount > 0 && !queue.hasDispatchableWork;
  const ownerWatermark = latestOwnerDecisionWatermark(args.projectDir);
  const stored = readProgressBoundaryState(args.projectDir);
  const previous = stored?.scopeId === scopeId ? stored : null;
  if (!previous || !head) {
    writeProgressBoundaryState(args.projectDir, {
      schemaVersion: 1,
      scopeId,
      lastObservedHead: head,
      ownerDecisionWatermark: ownerWatermark,
      parked,
      inputRevision: previous?.inputRevision ?? 0,
    });
    return deferredProgressInput(args.projectDir) ?? {
      shouldEmit: false,
      reason: "initialized semantic progress watermark",
      payload: null,
    };
  }

  const changedPaths = changedTaskPaths(
    args.projectDir,
    previous.lastObservedHead,
    head,
  );
  if (changedPaths === null) {
    writeProgressBoundaryState(args.projectDir, {
      ...previous,
      lastObservedHead: head,
      ownerDecisionWatermark: ownerWatermark,
      parked,
    });
    return {
      shouldEmit: false,
      reason: "reset semantic progress watermark after an unavailable Git range",
      payload: null,
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
  const newlyResolvedDecisions = ownerDecisionRecords(args.projectDir)
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
  writeProgressBoundaryState(args.projectDir, {
    ...previous,
    lastObservedHead: head,
    ownerDecisionWatermark: ownerWatermark,
    parked,
    inputRevision: nextRevision,
  });
  if (!boundary) {
    return deferredProgressInput(args.projectDir) ?? {
      shouldEmit: false,
      reason: readPendingProgressReviewInput(args.projectDir)?.delivery === "queued"
        ? "latest semantic progress input is already queued"
        : "no accepted semantic progress boundary",
      payload: null,
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

function deferredProgressInput(
  projectDir: string,
): ProgressBoundaryInspection | null {
  const pending = readPendingProgressReviewInput(projectDir);
  if (pending?.delivery !== "deferred") return null;
  return {
    shouldEmit: true,
    reason:
      `${pending.boundary} semantic input revision ${pending.inputRevision} resumed after cleanup`,
    payload: pending.payload,
  };
}

export function recordProgressSemanticBoundaryQueued(args: {
  projectDir: string;
  payload: ProgressReviewRequest;
}): void {
  recordProgressReviewInputQueued(args);
}
