import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventBus } from "../event-bus.js";
import { executeTool } from "../tools/index.js";
import type { WorkflowRunStore } from "./run-store.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunTrigger,
  WorkflowStepContext,
  WorkflowStepResult,
} from "./types.js";

export function createStepContext(
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  previousOutput: unknown,
  stepOutputsById: Record<string, unknown>,
  stepResultsById: Record<string, WorkflowStepResult>,
  stepOutputList: unknown[],
  deps: {
    projectDir: string;
    bus: EventBus;
    store: WorkflowRunStore;
  },
): WorkflowStepContext {
  const runDirPath = resolve(deps.projectDir, metadata.runDir);
  return {
    projectDir: deps.projectDir,
    workflow: {
      name: metadata.workflow,
      definitionPath: metadata.definitionPath,
      runId: metadata.id,
      runDir: metadata.runDir,
      runDirPath,
    },
    trigger,
    previousOutput,
    stepOutputs: stepOutputsById,
    stepResults: stepResultsById,
    stepOutputList,
    runTool: async (name, input) => {
      const result = await executeTool(name, input);
      if (result.is_error) {
        throw new Error(result.content);
      }
      return result;
    },
    emit: (event, payload) => {
      deps.bus.emit(event, payload);
    },
    requestRestart: (reason) => {
      deps.bus.emit("runtime.restart_requested", {
        reason,
        workflow: metadata.workflow,
        runId: metadata.id,
      });
    },
    readPrompt: (promptPath) => {
      return readFileSync(resolve(deps.projectDir, promptPath), "utf-8");
    },
    readRuntimeState: () => deps.store.readState(),
  };
}
