import { listActiveApprovalExecutionIds } from "./approval-execution-activity.js";
import type { ProjectRuntime } from "./project-runtime.js";
import type { ScopeDrainBlocker } from "./scope-drain-inspection.js";
import {
  registeredDirectoryScope,
  type ScopeLifecycleOptions,
} from "./scope-lifecycle-types.js";
import type { ScopeId } from "./scope-registry.js";

export function collectScopeDrainBlockers(
  options: ScopeLifecycleOptions,
  runtime: ProjectRuntime,
): ScopeDrainBlocker[] {
  const runtimeState = runtime.workflowRuntime.getState();
  const activeRuns = runtimeState.activeRuns ?? [];
  const sessionIds = [...options.listSessionIds(runtime.project.projectId)];
  const approvals = runtime.approvalQueue.list("pending").map((item) => item.id);
  const approvalExecutions = listActiveApprovalExecutionIds(runtime.approvalQueue);
  const pendingRuns = runtimeState.pendingRuns.map((run, index) =>
    run.runId ?? `queued:${run.workflowName}:${run.enqueuedAtMs}:${index + 1}`
  );
  const pendingBatchBuffers = Object.values(runtimeState.batchBuffers ?? {}).map(
    (buffer) =>
      `batch:${buffer.definitionName}:${buffer.triggerIndex}:${buffer.scopeId}:${buffer.groupingKey}`,
  );
  const pendingWatchTriggerBuffers = runtime.workflowRuntime
    .listPendingWatchTriggerBuffers()
    .map((buffer) => `watch:${buffer.workflowName}:${buffer.triggerIndex}`);
  const awaitEventSuspensions = runtime.workflowRuntime.listAwaitEventSuspensions();
  const awaitsWithDeadline = awaitEventSuspensions
    .filter((suspension) => suspension.deadlineAtMs !== undefined)
    .map(awaitSuspensionId);
  const awaitsWithoutDeadline = awaitEventSuspensions
    .filter((suspension) => suspension.deadlineAtMs === undefined)
    .map(awaitSuspensionId);
  const blockers: ScopeDrainBlocker[] = [];
  appendBlocker(blockers, "active_run", "workflow-runtime", activeRuns.map((run) => run.runId), "wait-or-abort");
  appendBlocker(blockers, "session", "daemon-sessions", sessionIds, "close");
  appendBlocker(blockers, "pending_approval", "approval-queue", approvals, "resolve-or-reject");
  appendBlocker(
    blockers,
    "resource_lease",
    "approval-execution",
    approvalExecutions,
    "wait-or-abort",
  );
  appendBlocker(blockers, "pending_work", "workflow-runtime", pendingRuns, "cancel-or-complete");
  appendBlocker(
    blockers,
    "pending_work",
    "workflow-batch-buffer",
    pendingBatchBuffers,
    "cancel-or-complete",
  );
  appendBlocker(
    blockers,
    "pending_work",
    "workflow-file-watch-buffer",
    pendingWatchTriggerBuffers,
    "cancel-or-complete",
  );
  appendBlocker(
    blockers,
    "pending_work",
    "workflow-await-event",
    awaitsWithDeadline,
    "deliver-or-timeout",
  );
  appendBlocker(
    blockers,
    "pending_work",
    "workflow-await-event",
    awaitsWithoutDeadline,
    "deliver-event",
  );
  blockers.push(
    ...options.inspectExternalBlockers(
      registeredDirectoryScope(
        runtime.project.projectId,
        runtime.project.projectDir,
        runtime.project.displayName,
      ),
    ),
  );
  return blockers;
}

function awaitSuspensionId(suspension: { runId: string; stepId: string }): string {
  return `await:${suspension.runId}:${suspension.stepId}`;
}

export function defaultScopeBlocker(scopeId: ScopeId): ScopeDrainBlocker {
  return {
    kind: "default_scope",
    source: "scope-registry",
    count: 1,
    ids: [scopeId],
    requiredDisposition: "select-another-default",
    detail: "Select another default scope before draining for removal",
  };
}

export function runtimeStopBlocker(error: object | null): ScopeDrainBlocker {
  return {
    kind: "inspection_failure",
    source: "scope-runtime-host",
    count: 1,
    ids: [],
    requiredDisposition: "repair-inspection",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function appendBlocker(
  blockers: ScopeDrainBlocker[],
  kind: ScopeDrainBlocker["kind"],
  source: string,
  ids: string[],
  requiredDisposition: ScopeDrainBlocker["requiredDisposition"],
): void {
  if (ids.length === 0) return;
  blockers.push({
    kind,
    source,
    count: ids.length,
    ids,
    requiredDisposition,
    detail: `${ids.length} ${kind.replaceAll("_", " ")}(s) require ${requiredDisposition}`,
  });
}
