import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { reportRunTriggerPayload } from "#modules/autonomy/run-delivery-evidence.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { normalizePriority } from "./aggregate-queue.js";
import {
  builderTaskAssociation,
  scopeFromPayload,
} from "./supervision-load-json.js";
import type { SupervisionLoadWorkstreamGroup } from "./supervision-load-types.js";

export function buildWorkstreamGroups(
  activeRuns: readonly WorkflowRunMetadata[],
  taskById: ReadonlyMap<string, RepoTaskFullRecord>,
): SupervisionLoadWorkstreamGroup[] {
  const groups = new Map<string, SupervisionLoadWorkstreamGroup>();
  const add = (partial: Omit<SupervisionLoadWorkstreamGroup, "activeRuns">) => {
    const key = [
      partial.workflow,
      partial.priority,
      partial.scopeId ?? "",
      partial.scopeId ?? "",
    ].join("\u0000");
    const existing = groups.get(key) ?? {
      ...partial,
      activeRuns: 0,
    };
    existing.activeRuns += 1;
    groups.set(key, existing);
  };

  for (const run of activeRuns) {
    const payload = reportRunTriggerPayload(run);
    if (payload === null) {
      throw new Error(`Malformed current workflow run "${run.id}": missing trigger`);
    }
    const task = builderTaskAssociation(run, taskById)?.task ?? null;
    const scope = scopeFromPayload(payload);
    add({
      workflow: run.workflow,
      priority: task ? normalizePriority(task.priority) : "unknown",
      scopeId: scope.scopeId,
    });
  }

  return [...groups.values()].sort(compareWorkstreamGroups);
}

function compareWorkstreamGroups(
  a: SupervisionLoadWorkstreamGroup,
  b: SupervisionLoadWorkstreamGroup,
): number {
  return (
    b.activeRuns - a.activeRuns ||
    a.workflow.localeCompare(b.workflow) ||
    a.priority.localeCompare(b.priority)
  );
}
