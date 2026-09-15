import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { readPublishedRepoTaskQueue } from "#modules/repo-tasks/published-task-queue.js";
import { summarizeRepoTaskQueue } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  inspectRepoWorkSupply,
  type RepoWorkSupply,
  type RepoWorkSupplyInput,
} from "#modules/repo-tasks/work-supply.js";
import { listAvailableBuilderTasks } from "../builder/available-work.js";
import type {
  BuilderTaskDispatchPayload,
} from "../builder/task-contract.js";
import {
  inspectResearchRetryAvailability,
  type ResearchRetryAvailability,
  type ResearchSourceTool,
} from "../research-retry/precondition.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import {
  inspectSecurityReviewDue,
  type SecurityReviewDueDecision,
  type SecurityReviewGitEvidence,
} from "../security-review/due-check.js";
import {
  inspectScopeSemanticBoundary,
  type ScopeBoundaryInspection,
} from "./semantic-reflection.js";

export type DispatcherInspection = {
  queue: RepoWorkSupply;
  builderTasks: BuilderTaskDispatchPayload[];
  researchRetryAvailability: ResearchRetryAvailability;
  securityReviewDue: SecurityReviewDueDecision;
  scopeBoundary: ScopeBoundaryInspection;
};

export type DispatcherInspectionInput = {
  workspaceRoot: string;
  scopeRoot: string;
  scopeId: string;
  stateDir: string;
  workSupplyInput: RepoWorkSupplyInput;
  nowIso: string;
  scopePolicySnapshot: ScopePolicySnapshot | null;
  researchSourceTools: readonly ResearchSourceTool[];
  scopeImprovementState: ScopeImprovementState;
  securityReviewGitEvidence: SecurityReviewGitEvidence;
};

export function inspectDispatcherStateInWorker(
  input: DispatcherInspectionInput,
): DispatcherInspection {
  const now = new Date(input.nowIso);
  // Repository-free observers still reflect scope policy, but cannot publish work from editor files.
  const published = input.securityReviewGitEvidence.currentHead.kind === "unavailable"
    ? null : readPublishedRepoTaskQueue(input.workspaceRoot);
  const queue: RepoWorkSupply = published ? inspectRepoWorkSupply(input.workSupplyInput, published) : {
    ...summarizeRepoTaskQueue([], 0, ""),
    ownershipAvailable: false,
    capacity: input.workSupplyInput.capacity,
    availableTaskIds: [], owners: [], runningCount: 0, queuedCount: 0, retainedCount: 0, availableCount: 0,
  };
  return {
    queue,
    builderTasks: published ? listAvailableBuilderTasks({ ...input, published, supply: queue }) : [],
    researchRetryAvailability: inspectResearchRetryAvailability(input.workspaceRoot, input.researchSourceTools, published?.tasks ?? []),
    securityReviewDue: inspectSecurityReviewDue(input.workspaceRoot, {
      now,
      stateDir: input.stateDir,
    }, input.securityReviewGitEvidence, published?.tasks ?? []),
    scopeBoundary: input.scopePolicySnapshot
      ? inspectScopeSemanticBoundary({
          workspaceRoot: input.workspaceRoot,
          scopeRoot: input.scopeRoot,
          scopeId: input.scopeId,
          stateDir: input.stateDir,
          scopePolicySnapshot: input.scopePolicySnapshot,
          state: input.scopeImprovementState,
        })
      : {
          shouldEmit: false,
          reason: "authoritative resolved scope policy is unavailable",
          payload: null,
          nextState: null,
        },
  };
}

export const dispatcherInspectionOperation = defineWorkflowBlockingOperation<
  DispatcherInspectionInput,
  DispatcherInspection
>(import.meta.url, "inspectDispatcherStateInWorker");
