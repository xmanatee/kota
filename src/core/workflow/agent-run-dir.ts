import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  WorkflowRunMetadata,
  WorkflowRuntimeResources,
  WorkflowStepContext,
} from "./run-types.js";

export const WORKFLOW_AGENT_OUTPUT_DIRNAME = "agent-output";

export function resolveAgentRunDir(input: {
  metadata: Pick<WorkflowRunMetadata, "runDir">;
  scopeRoot: string;
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
    input.scopeRoot,
    input.metadata.runDir,
    WORKFLOW_AGENT_OUTPUT_DIRNAME,
  );
}

export function resolveAgentRunDirFromContext(
  context: Pick<
    WorkflowStepContext,
    "scopeRoot" | "runtimeResources" | "workflow"
  >,
): string {
  return resolveAgentRunDir({
    metadata: context.workflow,
    scopeRoot: context.scopeRoot,
    ...(context.runtimeResources === undefined
      ? {}
      : { runtimeResources: context.runtimeResources }),
  });
}

export function agentRunDirWriteScopes(
  workspaceDir: string,
  agentRunDir: string,
): string[] {
  const scopeRoot = resolve(workspaceDir);
  const outputRoot = resolve(agentRunDir);
  const child = relative(scopeRoot, outputRoot);
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
  scopeRoot: string,
  metadata: Pick<WorkflowRunMetadata, "runDir">,
  runtimeResources: Pick<WorkflowRuntimeResources, "agentRunDir"> | undefined,
): string[] {
  return agentRunDirWriteScopes(
    workspaceDir,
    resolveAgentRunDir({
      metadata,
      scopeRoot,
      ...(runtimeResources === undefined ? {} : { runtimeResources }),
    }),
  );
}
