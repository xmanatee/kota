import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type {
  WorkflowRunMetadata,
  WorkflowRuntimeResources,
} from "../run-types.js";

export function buildWorkflowToolContext(
  metadata: WorkflowRunMetadata,
  pbus: ProjectScopedEventBus,
  stepId: string,
  projectDir: string,
  workspaceDir: string,
  sessionId: string | undefined,
  runtimeResources: WorkflowRuntimeResources | undefined,
  approvalQueue: ApprovalQueue | undefined,
  authorityConfigPath: string,
) {
  const scopeId = pbus.getScopeId();
  const projectId = pbus.getProjectId();
  return {
    ...(approvalQueue !== undefined ? { approvalQueue } : {}),
    authorityConfigPath,
    projectDir,
    cwd: workspaceDir,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(runtimeResources !== undefined ? { env: runtimeResources.env } : {}),
    stepId,
    scopeId,
    projectId,
    workflow: {
      workflowName: metadata.workflow,
      runId: metadata.id,
      stepId,
      spanId: `${metadata.id}:${stepId}`,
      scopeId,
      projectId,
    },
  };
}
