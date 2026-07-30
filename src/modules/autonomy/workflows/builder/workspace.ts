import { isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";

export function workflowWorkspaceDir(
  ctx: Pick<WorkflowStepContext, "projectDir" | "workspaceDir">,
): string {
  return ctx.workspaceDir ?? ctx.projectDir;
}

export function builderWorktreeRunId(
  ctx: Pick<WorkflowStepContext, "stepOutputs" | "workflow">,
): string {
  const workspace = ctx.stepOutputs["prepare-worktree"] as
    | { worktreeRunId?: string }
    | undefined;
  return workspace?.worktreeRunId ?? ctx.workflow.runId;
}

export function isBuilderPathInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function builderAgentRunDir(
  ctx: Pick<WorkflowStepContext, "projectDir" | "workspaceDir" | "runtimeResources">,
): string {
  const configured = ctx.runtimeResources?.agentRunDir;
  if (configured === undefined) {
    throw new Error("Builder runtime resources are missing agentRunDir");
  }
  if (!isAbsolute(configured)) {
    throw new Error(`Builder agentRunDir must be absolute: ${configured}`);
  }
  const workspaceDir = resolve(workflowWorkspaceDir(ctx));
  const agentRunDir = resolve(configured);
  if (!isBuilderPathInside(workspaceDir, agentRunDir)) {
    throw new Error(
      `Builder agentRunDir must be inside the active workspace: ${configured}`,
    );
  }
  const relativeRunDir = relative(workspaceDir, agentRunDir);
  const parts = relativeRunDir.split(sep);
  if (
    parts.length !== 3 ||
    parts[0] !== ".kota" ||
    parts[1] !== "builder-evidence"
  ) {
    throw new Error(
      `Builder agentRunDir must use .kota/builder-evidence/<run-id>: ${configured}`,
    );
  }
  return agentRunDir;
}
