import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";

export type AutonomyIssueEventScope = {
  projectId: string;
  scopeId?: string;
};

export type AutonomyIssueRuntimeScope = {
  scopeId: string;
  projectDir: string;
  runStore: WorkflowRunStore;
  deadLetterQueue: DeadLetterQueueStore;
  ownerQuestionQueue: OwnerQuestionQueue;
};

type AutonomyIssueScopeContext = Pick<ModuleRuntimeContext, "getProvider">;

function nonEmptySelector(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function resolveAutonomyIssueRuntimeScope(
  ctx: AutonomyIssueScopeContext,
  payload: AutonomyIssueEventScope,
): AutonomyIssueRuntimeScope {
  const scopeId = nonEmptySelector(payload.scopeId);
  const projectId = nonEmptySelector(payload.projectId);
  if (scopeId !== undefined && projectId !== undefined && scopeId !== projectId) {
    throw new Error(
      `Autonomy issue source received conflicting scope selectors: ` +
        `scopeId=${scopeId}, projectId=${projectId}`,
    );
  }
  const selectedId = scopeId ?? projectId;
  if (selectedId === undefined) {
    throw new Error("Autonomy issue source event is missing scopeId/projectId");
  }

  const provider = ctx.getProvider(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE);
  if (provider === null) {
    throw new Error(
      `Autonomy issue source cannot resolve scope ${selectedId}: ` +
        "daemon project runtime authority is unavailable",
    );
  }
  const resolution = provider.resolve(selectedId);
  if (!resolution.ok) {
    throw new Error(`Autonomy issue source references unknown scope ${selectedId}`);
  }
  if (resolution.runtime.project.projectId !== selectedId) {
    throw new Error(
      `Autonomy issue source scope authority returned ` +
        `${resolution.runtime.project.projectId} for ${selectedId}`,
    );
  }

  const projectDir = resolution.runtime.project.projectDir;
  return {
    scopeId: selectedId,
    projectDir,
    runStore: resolution.runtime.runStore,
    deadLetterQueue: resolution.runtime.deadLetterQueue,
    ownerQuestionQueue: resolution.runtime.ownerQuestionQueue,
  };
}
