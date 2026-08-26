import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import type {
  WorkflowRunMetadata,
  WorkflowRuntimeResources,
} from "../run-types.js";

export function buildWorkflowToolContext(
  metadata: WorkflowRunMetadata,
  pbus: ScopedEventBus,
  stepId: string,
  scopeRoot: string,
  workspaceRoot: string,
  sessionId: string | undefined,
  runtimeResources: WorkflowRuntimeResources | undefined,
  approvalQueue: ApprovalQueue | undefined,
  authorityConfigPath: string,
) {
  const scopeId = pbus.getScopeId();
  return {
    ...(approvalQueue !== undefined ? { approvalQueue } : {}),
    authorityConfigPath,
    scopeRoot,
    cwd: workspaceRoot,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(runtimeResources !== undefined ? { env: runtimeResources.env } : {}),
    stepId,
    scopeId,
    workflow: {
      workflowName: metadata.workflow,
      runId: metadata.id,
      stepId,
      spanId: `${metadata.id}:${stepId}`,
      scopeId,
    },
  };
}
