import { runWorkflowBlockingOperation } from "./blocking-operation.js";
import type { WorkflowRunMetadata } from "./run-types.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowAgentBackoffKind, WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export async function runTerminalFinalizer(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
  metadata: WorkflowRunMetadata,
  workspaceDir: string,
  agentFailureKind?: WorkflowAgentBackoffKind,
): Promise<void> {
  if (definition.terminalFinalizer === undefined) return;
  try {
    await definition.terminalFinalizer({
      projectDir: state.projectDir,
      workspaceDir,
      metadata,
      trigger,
      ...(agentFailureKind !== undefined ? { agentFailureKind } : {}),
      emit: (event, payload) => {
        state.pbus.emitDynamic(event, payload);
      },
      log: state.log,
      runBlocking: (operation, input) =>
        runWorkflowBlockingOperation(operation, input),
    });
  } catch (error) {
    state.log(
      `Workflow "${definition.name}" terminal finalizer failed for ${metadata.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
