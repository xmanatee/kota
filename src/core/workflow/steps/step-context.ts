import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { EventBus } from "#core/events/event-bus.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { executeTool } from "#core/tools/index.js";
import type { WorkflowRunStore } from "../run-store.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunToolRunner,
  WorkflowStepContext,
  WorkflowStepResult,
} from "../run-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";

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
    pbus: ProjectScopedEventBus;
    store: WorkflowRunStore;
    runTool?: WorkflowRunToolRunner;
    currentStepId?: string;
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
    runTool: async (name, input, toolContext) => {
      if (deps.runTool) {
        return deps.runTool(name, input, {
          stepId: toolContext?.stepId ?? deps.currentStepId ?? "unknown",
        });
      }
      const result = await executeTool(name, input);
      if (result.is_error) {
        throw new Error(result.content);
      }
      return result;
    },
    emit: (event, payload) => {
      // Inject scope attribution for scoped events. Step authors emit
      // application events (queue-shape, autonomy state) without knowing
      // the runtime's scope id; the wrapper attaches it. Daemon-wide event
      // subscribers ignore the extra fields.
      const scopeId = deps.pbus.getScopeId();
      const augmented =
        "scopeId" in payload && typeof payload.scopeId === "string"
          ? payload
          : { ...payload, scopeId, projectId: scopeId };
      recordEmittedEvent(runDirPath, event, augmented);
      deps.pbus.emitDynamic(event, augmented);
    },
    requestRestart: (reason) => {
      const payload = {
        reason,
        workflow: metadata.workflow,
        runId: metadata.id,
      };
      recordEmittedEvent(runDirPath, "runtime.restart_requested", payload);
      deps.pbus.emit("runtime.restart_requested", payload);
    },
    readPrompt: (promptPath) => {
      return readFileSync(resolve(deps.projectDir, promptPath), "utf-8");
    },
    readRuntimeState: () => deps.store.readState(),
    reportProgress: () => {},
    triggerWorkflow: async (workflowName, payload, waitFor, signal) => {
      if (!deps.triggerWorkflow) {
        throw new Error("triggerWorkflow is not supported in this execution context");
      }
      return deps.triggerWorkflow(workflowName, payload, waitFor, signal);
    },
  };
}
