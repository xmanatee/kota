import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { TaskClaimInspection } from "#modules/autonomy/task-claims.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { normalizePriority } from "./aggregate-queue.js";
import { scopeFromPayload, taskFromPayload } from "./supervision-load-json.js";
import type { SupervisionLoadWorkstreamGroup } from "./supervision-load-types.js";

export function buildWorkstreamGroups(
  activeRuns: readonly WorkflowRunMetadata[],
  claims: readonly TaskClaimInspection[],
  taskById: ReadonlyMap<string, RepoTaskFullRecord>,
): SupervisionLoadWorkstreamGroup[] {
  const groups = new Map<string, SupervisionLoadWorkstreamGroup>();
  const add = (
    partial: Omit<
      SupervisionLoadWorkstreamGroup,
      "activeRuns" | "taskClaims" | "pendingMergeTaskClaims"
    >,
    kind: "run" | "claim" | "pending-merge-claim",
  ) => {
    const key = [
      partial.workflow,
      partial.taskClass,
      partial.priority,
      partial.scopeId ?? "",
      partial.projectId ?? "",
    ].join("\u0000");
    const existing = groups.get(key) ?? {
      ...partial,
      activeRuns: 0,
      taskClaims: 0,
      pendingMergeTaskClaims: 0,
    };
    if (kind === "run") existing.activeRuns += 1;
    if (kind === "claim") existing.taskClaims += 1;
    if (kind === "pending-merge-claim") {
      existing.taskClaims += 1;
      existing.pendingMergeTaskClaims += 1;
    }
    groups.set(key, existing);
  };

  for (const run of activeRuns) {
    const payload = run.trigger.payload as KotaJsonObject;
    const task = taskFromPayload(payload, taskById);
    const scope = scopeFromPayload(payload);
    add(
      {
        workflow: run.workflow,
        taskClass: task?.taskClass ?? "Unclassified",
        priority: task ? normalizePriority(task.priority) : "unknown",
        scopeId: scope.scopeId,
        projectId: scope.projectId,
      },
      "run",
    );
  }

  for (const inspection of claims) {
    const task = taskById.get(inspection.claim.taskId);
    add(
      {
        workflow: inspection.claim.workflowId,
        taskClass: task?.taskClass ?? "Unclassified",
        priority: task ? normalizePriority(task.priority) : "unknown",
        scopeId: null,
        projectId: null,
      },
      inspection.claim.status === "pending-merge"
        ? "pending-merge-claim"
        : "claim",
    );
  }

  return [...groups.values()].sort(compareWorkstreamGroups);
}

function compareWorkstreamGroups(
  a: SupervisionLoadWorkstreamGroup,
  b: SupervisionLoadWorkstreamGroup,
): number {
  const loadA = a.activeRuns + a.taskClaims + a.pendingMergeTaskClaims;
  const loadB = b.activeRuns + b.taskClaims + b.pendingMergeTaskClaims;
  return (
    loadB - loadA ||
    a.workflow.localeCompare(b.workflow) ||
    a.priority.localeCompare(b.priority) ||
    a.taskClass.localeCompare(b.taskClass)
  );
}
