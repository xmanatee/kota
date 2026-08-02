import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getGlobalConfigPath } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import {
  type EventBus,
  type EventSchemaReference,
  resolveEventSchemaReference,
} from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { assess } from "#core/tools/guardrails.js";
import { executeTool } from "#core/tools/index.js";
import { validateToolCallInput } from "#core/tools/tool-input-validation.js";
import { enforceToolScopePolicy } from "#core/tools/tool-runner-scope-policy.js";
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
  authorityConfigPath: string,
): {
  approvalQueue?: ApprovalQueue;
  authorityConfigPath: string;
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
    authorityConfigPath,
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

async function enforceWorkflowToolScopePolicy(args: {
  name: string;
  input: Parameters<WorkflowRunToolRunner>[1];
  context: ReturnType<typeof buildToolContext>;
  policy: ResolvedScopePolicy;
  approvalQueue: ApprovalQueue;
}): Promise<void> {
  const validation = validateToolCallInput(args.name, args.input);
  if (!validation.ok) throw new Error(validation.error);
  const block = {
    type: "tool_use" as const,
    id: `${args.context.workflow.spanId}:${args.name}`,
    name: args.name,
    input: validation.input,
  };
  const assessment = assess(args.name, validation.input);
  const denied = await enforceToolScopePolicy({
    block,
    options: {
      resultLimit: Number.MAX_SAFE_INTEGER,
      verbose: false,
      autonomyMode: "autonomous",
      approvalQueue: args.approvalQueue,
      scopePolicy: args.policy,
      cwd: args.context.cwd,
      scopeId: args.context.scopeId,
      projectId: args.context.projectId,
      workflowContext: args.context.workflow,
    },
    risk: assessment.risk,
    askClientApproval: async () => ({ outcome: "unavailable" }),
    emitAssessment: () => {},
  });
  if (denied) throw new Error(denied.content);
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
    authorityConfigPath?: string;
    runtimeResources?: WorkflowRuntimeResources;
    bus: EventBus;
    pbus: ProjectScopedEventBus;
    store: WorkflowRunStore;
    deadLetterQueue?: DeadLetterQueueStore;
    approvalQueue?: ApprovalQueue;
    eventJournal?: EventJournal;
    runTool?: WorkflowRunToolRunner;
    resolveScopePolicy?: () => ResolvedScopePolicy;
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
        deps.authorityConfigPath ?? getGlobalConfigPath(),
      );
      const scopePolicy = deps.resolveScopePolicy?.();
      if (scopePolicy !== undefined) {
        if (deps.approvalQueue === undefined) {
          throw new Error("Scope policy enforcement requires a workflow approval queue");
        }
        await enforceWorkflowToolScopePolicy({
          name,
          input,
          context,
          policy: scopePolicy,
          approvalQueue: deps.approvalQueue,
        });
      }
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
