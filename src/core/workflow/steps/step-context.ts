import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import {
  type EventBus,
  type EventSchemaReference,
  resolveEventSchemaReference,
} from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { executeTool } from "#core/tools/index.js";
import type { WorkflowRunStore } from "../run-store.js";
import type {
  WorkflowAgentHarnessRunner,
  WorkflowRunMetadata,
  WorkflowRunToolRunner,
  WorkflowRuntimeResources,
  WorkflowStepContext,
  WorkflowStepResult,
} from "../run-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";

function buildToolContext(
  metadata: WorkflowRunMetadata,
  pbus: ProjectScopedEventBus,
  stepId: string,
  workspaceDir: string,
  runtimeResources: WorkflowRuntimeResources | undefined,
  approvalQueue: ApprovalQueue | undefined,
): {
  approvalQueue?: ApprovalQueue;
  cwd: string;
  env?: Record<string, string>;
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
    ...(approvalQueue !== undefined ? { approvalQueue } : {}),
    cwd: workspaceDir,
    ...(runtimeResources !== undefined
      ? { env: runtimeResources.env }
      : {}),
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
    workspaceDir?: string;
    runtimeResources?: WorkflowRuntimeResources;
    bus: EventBus;
    pbus: ProjectScopedEventBus;
    store: WorkflowRunStore;
    deadLetterQueue?: DeadLetterQueueStore;
    approvalQueue?: ApprovalQueue;
    eventJournal?: EventJournal;
    runTool?: WorkflowRunToolRunner;
    runAgentHarness: WorkflowAgentHarnessRunner;
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
  const workspaceDir = deps.workspaceDir ?? deps.projectDir;
  const stateDir = deps.eventJournal
    ? dirname(dirname(deps.eventJournal.getPath()))
    : deps.store.rootDir;
  return {
    ...(deps.approvalQueue !== undefined
      ? { approvalQueue: deps.approvalQueue }
      : {}),
    projectDir: deps.projectDir,
    workspaceDir,
    ...(deps.runtimeResources !== undefined
      ? { runtimeResources: deps.runtimeResources }
      : {}),
    stateDir,
    ...(deps.eventJournal !== undefined
      ? { eventJournal: deps.eventJournal }
      : {}),
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
      const context = buildToolContext(
        metadata,
        deps.pbus,
        stepId,
        workspaceDir,
        deps.runtimeResources,
        deps.approvalQueue,
      );
      if (deps.runTool) {
        return deps.runTool(name, input, context);
      }
      const result = await executeTool(name, input, context);
      if (result.is_error) {
        throw new Error(result.content);
      }
      return result;
    },
    runAgentHarness: deps.runAgentHarness,
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
