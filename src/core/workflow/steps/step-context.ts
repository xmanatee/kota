import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getGlobalConfigPath, type KotaConfig } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type {
  ResolvedScopePolicy,
  ScopePolicyAuthority,
} from "#core/daemon/scope-policy.js";
import {
  type EventBus,
  type EventSchemaReference,
  resolveEventSchemaReference,
} from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { assess } from "#core/tools/guardrails.js";
import { executeTool } from "#core/tools/index.js";
import { validateToolCallInput } from "#core/tools/tool-input-validation.js";
import type { ToolCallExecutionOptions } from "#core/tools/tool-runner.js";
import { withToolCallExecutionOptions } from "#core/tools/tool-runner-runtime.js";
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
import { buildWorkflowToolContext } from "./step-tool-context.js";

async function enforceWorkflowToolScopePolicy(args: {
  name: string;
  input: Parameters<WorkflowRunToolRunner>[1];
  context: ReturnType<typeof buildWorkflowToolContext>;
  policy: ResolvedScopePolicy;
  options: ToolCallExecutionOptions;
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
    options: args.options,
    policy: args.policy,
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
    config?: KotaConfig;
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
    scopePolicyAuthority?: ScopePolicyAuthority;
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
  const runAgentHarness: WorkflowAgentHarnessRunner = (
    harness,
    options,
    execution,
  ) => {
    const context = buildWorkflowToolContext(
      metadata,
      deps.pbus,
      deps.currentStepId ?? "unknown",
      deps.projectDir,
      options.cwd ?? workspaceDir,
      options.sessionContext?.sessionId,
      deps.runtimeResources,
      deps.approvalQueue,
      deps.authorityConfigPath ?? getGlobalConfigPath(),
    );
    const authority = deps.scopePolicyAuthority;
    if (authority === undefined) {
      return deps.runAgentHarness(
        harness,
        {
          ...options,
          projectDir: context.projectDir,
          authorityConfigPath: context.authorityConfigPath,
          workflowContext: context.workflow,
        },
        execution,
      );
    }

    const getScopePolicySnapshot = () => authority.getSnapshot(context.scopeId);
    return deps.runAgentHarness(
      harness,
      {
        ...options,
        projectDir: context.projectDir,
        authorityConfigPath: context.authorityConfigPath,
        workflowContext: context.workflow,
        ...(harness.toolControl === "kota" && deps.approvalQueue !== undefined
          ? { approvalQueue: deps.approvalQueue }
          : {}),
        ...(harness.toolControl === "kota"
          ? { scopePolicyAuthority: authority }
          : {}),
        scopePolicy: getScopePolicySnapshot().policy,
        getScopePolicySnapshot,
      },
      execution,
    );
  };
  return {
    ...(deps.approvalQueue !== undefined
      ? { approvalQueue: deps.approvalQueue }
      : {}),
    projectDir: deps.projectDir,
    agentRuntime: resolveAgentRuntime(deps.config),
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
      const context = buildWorkflowToolContext(
        metadata,
        deps.pbus,
        stepId,
        deps.projectDir,
        workspaceDir,
        toolContext?.sessionId,
        deps.runtimeResources,
        deps.approvalQueue,
        deps.authorityConfigPath ?? getGlobalConfigPath(),
      );
      const authority = deps.scopePolicyAuthority;
      const getScopePolicySnapshot = authority === undefined
        ? undefined
        : () => authority.getSnapshot(context.scopeId);
      const scopePolicy = getScopePolicySnapshot?.().policy;
      const executionOptions: ToolCallExecutionOptions = {
        resultLimit: Number.MAX_SAFE_INTEGER,
        verbose: false,
        autonomyMode: "autonomous",
        ...(deps.approvalQueue !== undefined
          ? { approvalQueue: deps.approvalQueue }
          : {}),
        ...(scopePolicy !== undefined ? { scopePolicy } : {}),
        ...(authority !== undefined ? { scopePolicyAuthority: authority } : {}),
        ...(getScopePolicySnapshot !== undefined ? { getScopePolicySnapshot } : {}),
        ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
        projectDir: context.projectDir,
        cwd: context.cwd,
        ...(context.env !== undefined ? { env: context.env } : {}),
        authorityConfigPath: context.authorityConfigPath,
        workflowContext: context.workflow,
        scopeId: context.scopeId,
        projectId: context.projectId,
      };
      if (scopePolicy !== undefined) {
        if (deps.approvalQueue === undefined) {
          throw new Error("Scope policy enforcement requires a workflow approval queue");
        }
        await enforceWorkflowToolScopePolicy({
          name,
          input,
          context,
          policy: scopePolicy,
          options: executionOptions,
        });
      }
      const runTool = deps.runTool;
      if (runTool) {
        return withToolCallExecutionOptions(executionOptions, () =>
          runTool(name, input, context)
        );
      }
      const result = await withToolCallExecutionOptions(executionOptions, () =>
        executeTool(name, input, context)
      );
      if (result.is_error) {
        throw new Error(result.content);
      }
      return result;
    },
    runAgentHarness,
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
