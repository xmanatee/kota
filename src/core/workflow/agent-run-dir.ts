import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  WorkflowRunMetadata,
  WorkflowRuntimeResources,
  WorkflowStepContext,
} from "./run-types.js";

export const WORKFLOW_AGENT_OUTPUT_DIRNAME = "agent-output";

export function resolveAgentRunDir(input: {
  metadata: Pick<WorkflowRunMetadata, "runDir">;
  projectDir: string;
  runtimeResources?: Pick<WorkflowRuntimeResources, "agentRunDir">;
}): string {
  const configured = input.runtimeResources?.agentRunDir;
  if (configured !== undefined) {
    if (!isAbsolute(configured)) {
      throw new Error(`runtimeResources.agentRunDir must be absolute: ${configured}`);
    }
    return configured;
  }
  return resolve(
    input.projectDir,
    input.metadata.runDir,
    WORKFLOW_AGENT_OUTPUT_DIRNAME,
  );
}

export function resolveAgentRunDirFromContext(
  context: Pick<
    WorkflowStepContext,
    "projectDir" | "runtimeResources" | "workflow"
  >,
): string {
  return resolveAgentRunDir({
    metadata: context.workflow,
    projectDir: context.projectDir,
    ...(context.runtimeResources === undefined
      ? {}
      : { runtimeResources: context.runtimeResources }),
  });
}

export function agentRunDirWriteScopes(
  workspaceDir: string,
  agentRunDir: string,
): string[] {
  const workspaceRoot = resolve(workspaceDir);
  const outputRoot = resolve(agentRunDir);
  const child = relative(workspaceRoot, outputRoot);
  if (
    child.length === 0 ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    return [];
  }
  return [child.split(sep).join("/")];
}

export function resolveAgentOutputWriteScopes(
  workspaceDir: string,
  projectDir: string,
  metadata: Pick<WorkflowRunMetadata, "runDir">,
  runtimeResources: Pick<WorkflowRuntimeResources, "agentRunDir"> | undefined,
): string[] {
  return agentRunDirWriteScopes(
    workspaceDir,
    resolveAgentRunDir({
      metadata,
      projectDir,
      ...(runtimeResources === undefined ? {} : { runtimeResources }),
    }),
  );
}
