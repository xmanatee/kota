import { isAbsolute } from "node:path";
import type { WorkflowStepResult } from "./run-types.js";
import type { WorkflowDefinition } from "./types.js";

export function workspaceDirFromStepOutput(
  stepId: string,
  output: WorkflowStepResult["output"],
): string {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    throw new Error(
      `Step "${stepId}" updatesWorkspaceDir output must be an object with workspaceDir`,
    );
  }
  const workspaceDir = (output as { workspaceDir?: string }).workspaceDir;
  if (typeof workspaceDir !== "string" || !workspaceDir.trim()) {
    throw new Error(
      `Step "${stepId}" updatesWorkspaceDir output.workspaceDir must be a non-empty string`,
    );
  }
  if (!isAbsolute(workspaceDir)) {
    throw new Error(
      `Step "${stepId}" updatesWorkspaceDir output.workspaceDir must be absolute`,
    );
  }
  return workspaceDir;
}

export function replayWorkspaceDirUpdates(
  definition: WorkflowDefinition,
  retryFromIndex: number,
  stepResultsById: Record<string, WorkflowStepResult>,
  fallbackWorkspaceDir: string,
): string {
  let workspaceDir = fallbackWorkspaceDir;
  for (let i = 0; i < retryFromIndex; i++) {
    const step = definition.steps[i];
    if (step?.type !== "code" || step.updatesWorkspaceDir !== true) continue;
    const result = stepResultsById[step.id];
    if (result?.status !== "success") continue;
    workspaceDir = workspaceDirFromStepOutput(step.id, result.output);
  }
  return workspaceDir;
}
