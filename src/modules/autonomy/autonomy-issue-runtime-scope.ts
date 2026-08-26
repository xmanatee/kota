import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";

export type AutonomyIssueEventScope = {
  scopeId: string;
};

export type AutonomyIssueRuntimeScope = {
  scopeId: string;
  workspaceRoot: string;
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
  if (scopeId === undefined) {
    throw new Error("Autonomy issue source event is missing scopeId");
  }

  const provider = ctx.getProvider(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE);
  if (provider === null) {
    throw new Error(
      `Autonomy issue source cannot resolve scope ${scopeId}: ` +
        "daemon scope runtime authority is unavailable",
    );
  }
  const resolution = provider.resolve(scopeId);
  if (!resolution.ok) {
    throw new Error(`Autonomy issue source references unknown scope ${scopeId}`);
  }
  if (resolution.runtime.scope.scopeId !== scopeId) {
    throw new Error(
      `Autonomy issue source scope authority returned ` +
        `${resolution.runtime.scope.scopeId} for ${scopeId}`,
    );
  }

  const workspaceRoot = resolution.runtime.scope.scopeRoot;
  return {
    scopeId,
    workspaceRoot,
    runStore: resolution.runtime.runStore,
    deadLetterQueue: resolution.runtime.deadLetterQueue,
    ownerQuestionQueue: resolution.runtime.ownerQuestionQueue,
  };
}
