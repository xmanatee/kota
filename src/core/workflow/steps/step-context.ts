import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import {
  type EventBus,
  type EventSchemaReference,
  resolveEventSchemaReference,
} from "#core/events/event-bus.js";
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

function buildToolContext(
  metadata: WorkflowRunMetadata,
  pbus: ProjectScopedEventBus,
  stepId: string,
): {
  stepId: string;
  scopeId: string;
  projectId: string;
  workflow: {
    workflowName: string;
    runId: string;
    stepId: string;
    spanId: string;
    scopeId: string;
    projectId: string;
  };
} {
  const scopeId = pbus.getScopeId();
  const projectId = pbus.getProjectId();
  return {
    stepId,
    scopeId,
    projectId,
    workflow: {
      workflowName: metadata.workflow,
      runId: metadata.id,
      stepId,
      spanId: `${metadata.id}:${stepId}`,
      scopeId,
      projectId,
    },
  };
}

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
  schemaRef: EventSchemaReference | null,
  payload: Record<string, unknown>,
): void {
  const logPath = join(runDirPath, EMITTED_EVENTS_LOG_FILENAME);
  const entry = {
    event,
    schemaRef,
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
    deadLetterQueue?: DeadLetterQueueStore;
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
      const stepId = toolContext?.stepId ?? deps.currentStepId ?? "unknown";
      const context = buildToolContext(metadata, deps.pbus, stepId);
      if (deps.runTool) {
        return deps.runTool(name, input, context);
      }
      const result = await executeTool(name, input, context);
      if (result.is_error) {
        throw new Error(result.content);
      }
      return result;
    },
    emit: (event, payload) => {
      const emittedPayload = deps.pbus.emitDynamic(event, payload);
      recordEmittedEvent(
        runDirPath,
        event,
        resolveEventSchemaReference(event),
        emittedPayload,
      );
    },
    requestRestart: (reason) => {
      const payload = {
        reason,
        workflow: metadata.workflow,
        runId: metadata.id,
      };
      recordEmittedEvent(runDirPath, "runtime.restart_requested", null, payload);
      deps.pbus.emit("runtime.restart_requested", payload);
    },
    readPrompt: (promptPath) => {
      return readFileSync(resolve(deps.projectDir, promptPath), "utf-8");
    },
    readRuntimeState: () => deps.store.readState(),
    ...(deps.deadLetterQueue !== undefined
      ? { deadLetterQueue: deps.deadLetterQueue }
      : {}),
    reportProgress: () => {},
    triggerWorkflow: async (workflowName, payload, waitFor, signal) => {
      if (!deps.triggerWorkflow) {
        throw new Error("triggerWorkflow is not supported in this execution context");
      }
      return deps.triggerWorkflow(workflowName, payload, waitFor, signal);
    },
  };
}
