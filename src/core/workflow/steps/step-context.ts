import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { EventBus } from "#core/events/event-bus.js";
import { executeTool } from "#core/tools/index.js";
import type { WorkflowRunStore } from "../run-store.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
  WorkflowStepResult,
} from "../run-types.js";
import type { WorkflowRunTrigger } from "../types.js";

/**
 * Per-run append-only log of events a step emitted via `ctx.emit`. The
 * harness eval layer's `run-emits-event` / `run-omits-event` predicates
 * inspect this file; emit-only workflows whose failure mode is a wrong bus
 * event need an observable artifact that does not depend on the step
 * choosing to include the emission in its output.
 */
export const EMITTED_EVENTS_LOG_FILENAME = "emitted-events.jsonl";

function recordEmittedEvent(
  runDirPath: string,
  event: string,
  payload: Record<string, unknown>,
): void {
  const logPath = join(runDirPath, EMITTED_EVENTS_LOG_FILENAME);
  const entry = {
    event,
    payload,
    emittedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
}

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
      recordEmittedEvent(runDirPath, event, payload);
      deps.bus.emit(event, payload);
    },
    requestRestart: (reason) => {
      const payload = {
        reason,
        workflow: metadata.workflow,
        runId: metadata.id,
      };
      recordEmittedEvent(runDirPath, "runtime.restart_requested", payload);
      deps.bus.emit("runtime.restart_requested", payload);
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
