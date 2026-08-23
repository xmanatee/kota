import { moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { WorkflowStateRecoveryArtifact } from "#modules/workflow-ops/state-recovery-provider.js";

export function completeWorkflowStateRecoveryTask(
  projectDir: string,
  taskId: string,
): NonNullable<WorkflowStateRecoveryArtifact["taskMove"]> {
  try {
    const moved = moveTaskById(projectDir, taskId, "done");
    return {
      attempted: true,
      moved: true,
      message: `moved ${taskId} from ${moved.fromState} to ${moved.toState}`,
      fromState: moved.fromState,
      toState: moved.toState,
      path: moved.path,
    };
  } catch (error) {
    return {
      attempted: true,
      moved: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
