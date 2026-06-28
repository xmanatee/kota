import type {
  WorkflowRuntimeResources,
  WorkflowStepResult,
} from "./run-types.js";
import {
  replayRuntimeResourceUpdates,
  runtimeResourcesFromStepOutput,
} from "./runtime-resources.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowDefinition } from "./types.js";
import { replayWorkspaceDirUpdates, workspaceDirFromStepOutput } from "./workspace-update.js";

type MutableRunRuntimeState = {
  workspaceDir: string;
  runtimeResources?: WorkflowRuntimeResources;
};

export function replayRunRuntimeState(
  deps: MutableRunRuntimeState,
  definition: WorkflowDefinition,
  retryFromIndex: number,
  stepResultsById: Record<string, WorkflowStepResult>,
): void {
  deps.workspaceDir = replayWorkspaceDirUpdates(
    definition,
    retryFromIndex,
    stepResultsById,
    deps.workspaceDir,
  );
  deps.runtimeResources = replayRuntimeResourceUpdates(
    definition,
    retryFromIndex,
    stepResultsById,
    deps.runtimeResources,
  );
}

export function updateRunRuntimeStateFromStep(
  deps: MutableRunRuntimeState,
  step: WorkflowStep,
  completed: WorkflowStepResult,
): void {
  if (completed.status !== "success" || step.type !== "code") return;
  if (step.updatesWorkspaceDir === true) {
    deps.workspaceDir = workspaceDirFromStepOutput(step.id, completed.output);
  }
  if (step.updatesRuntimeResources === true) {
    deps.runtimeResources = runtimeResourcesFromStepOutput(step.id, completed.output);
  }
}
