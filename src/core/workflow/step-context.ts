import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventBus } from "../events/event-bus.js";
import { executeTool } from "../tools/index.js";
import type { WorkflowRunStore } from "./run-store.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
  WorkflowStepResult,
} from "./run-types.js";
import type { WorkflowRunTrigger } from "./types.js";

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
    triggerWorkflow?: (
      workflowName: string,
      payload: Record<string, unknown>,
      waitFor: "queued" | "completed",
      signal?: AbortSignal,
    ) => Promise<{ runId: string; status: "queued" | "completed" | "failed" }>;
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
    triggerWorkflow: async (workflowName, payload, waitFor, signal) => {
      if (!deps.triggerWorkflow) {
        throw new Error("triggerWorkflow is not supported in this execution context");
      }
      return deps.triggerWorkflow(workflowName, payload, waitFor, signal);
    },
  };
}
