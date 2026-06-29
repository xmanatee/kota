import { isAbsolute, resolve } from "node:path";
import type {
  WorkflowRunMetadata,
  WorkflowRuntimeResources,
} from "./run-types.js";

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
  return resolve(input.projectDir, input.metadata.runDir);
}
