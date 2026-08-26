import { readFileSync } from "node:fs";
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
import { executeTool, getToolEffect, type ToolResult } from "#core/tools/index.js";
import { validateToolCallInput } from "#core/tools/tool-input-validation.js";
import type { ToolCallExecutionOptions } from "#core/tools/tool-runner.js";
import { withToolCallExecutionOptions } from "#core/tools/tool-runner-runtime.js";
import { enforceToolScopePolicy } from "#core/tools/tool-runner-scope-policy.js";
import {
  type DurableEffectValue,
  fingerprintToolEffectRequest,
  type RunContext,
  type TransactionalRunState,
} from "../run-context.js";
import { recordEmittedEventEvidence } from "../run-event-evidence.js";
import type { WorkflowRunStore } from "../run-store.js";
import type {
  WorkflowAgentHarnessRunner,
  WorkflowRunMetadata,
  WorkflowRunToolRunner,
  WorkflowRuntimeResources,
  WorkflowRuntimeSummary,
  WorkflowStepContext,
  WorkflowStepResult,
} from "../run-types.js";
import { isRunLocalEffect } from "../transaction-effect-policy.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import { createWorkflowCommandRunner } from "../workflow-command.js";
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

function durableToolResult(result: ToolResult): DurableEffectValue {
  const serialized = JSON.stringify(result);
  if (serialized === undefined) {
    throw new Error("Declarative tool result is not durable JSON");
  }
  return JSON.parse(serialized) as DurableEffectValue;
}

function restoredToolResult(value: DurableEffectValue): ToolResult {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    typeof (value as Record<string, DurableEffectValue>).content !== "string"
  ) {
    throw new Error("Persisted declarative tool result is malformed");
  }
  return value as unknown as ToolResult;
}

const unsupportedTransactionalState: TransactionalRunState = Object.freeze({
  read(): never {
    throw new Error("Transactional state requires a durable run context");
  },
  compareAndSet(): never {
    throw new Error("Transactional state requires a durable run context");
  },
});

function recordEmittedEvent(
  runDirPath: string,
  event: string,
  schemaRef: EventSchemaReference | null,
  payload: Record<string, unknown>,
): void {
  recordEmittedEventEvidence(runDirPath, {
    event,
    schemaRef,
    payload,
    emittedAt: new Date().toISOString(),
  });
}

export function createStepContext(
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  previousOutput: unknown,
  stepOutputsById: Record<string, unknown>,
  stepResultsById: Record<string, WorkflowStepResult>,
  stepOutputList: unknown[],
  deps: {
    /** Isolated repository checkout used by the running step. */
    projectDir: string;
    /** Canonical project and runtime-state root for this scope. */
    scopeDir: string;
    config?: KotaConfig;
    authorityConfigPath?: string;
    runtimeResources?: WorkflowRuntimeResources;
    bus: EventBus;
    pbus: ProjectScopedEventBus;
    store: WorkflowRunStore;
    readRuntimeState: () => WorkflowRuntimeSummary;
    deadLetterQueue?: DeadLetterQueueStore;
    approvalQueue?: ApprovalQueue;
    eventJournal?: EventJournal;
    runTool?: WorkflowRunToolRunner;
    runContext?: Pick<
      RunContext,
      "effects" | "processes" | "publications" | "repositoryAccess" | "signal" | "state"
    > & { sandbox: Pick<RunContext["sandbox"], "repository"> };
    scopePolicyAuthority?: ScopePolicyAuthority;
    runAgentHarness: WorkflowAgentHarnessRunner;
    currentStepId?: string;
    triggerWorkflow?: (
      workflowName: string,
      payload: Record<string, unknown>,
      waitFor: "queued" | "completed",
      signal?: AbortSignal,
      triggerId?: string,
    ) => Promise<{ runId: string; status: "queued" | "completed" | "failed" }>;
  },
): WorkflowStepContext {
  const runDirPath = join(deps.store.runsDir, metadata.id);
  const stateDir = deps.eventJournal
    ? dirname(dirname(deps.eventJournal.getPath()))
    : deps.store.rootDir;
  const scopePolicySnapshot = deps.scopePolicyAuthority?.getSnapshot(
    deps.pbus.getScopeId(),
  );
  const runCommand = createWorkflowCommandRunner({
    cwd: deps.projectDir,
    ...(deps.runtimeResources !== undefined
      ? { env: deps.runtimeResources.env }
      : {}),
    ...(deps.runContext !== undefined
      ? {
          signal: deps.runContext.signal,
          onProcessSpawn: deps.runContext.processes.register,
        }
      : {}),
  });
  const runAgentHarness: WorkflowAgentHarnessRunner = (
    harness,
    options,
    execution,
  ) => {
    const context = buildWorkflowToolContext(
      metadata,
      deps.pbus,
      deps.currentStepId ?? "unknown",
      deps.scopeDir,
      options.cwd ?? deps.projectDir,
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
  let transactionalEmitSequence = 0;
  let transactionalToolSequence = 0;
  return {
    ...(deps.approvalQueue !== undefined
      ? { approvalQueue: deps.approvalQueue }
      : {}),
    projectDir: deps.projectDir,
    ...(deps.runContext?.repositoryAccess !== undefined
      ? { repositoryAccess: deps.runContext.repositoryAccess }
      : {}),
    scopeDir: deps.scopeDir,
    agentRuntime: resolveAgentRuntime(deps.config),
    ...(deps.runtimeResources !== undefined
      ? { runtimeResources: deps.runtimeResources }
      : {}),
    stateDir,
    ...(deps.eventJournal !== undefined
      ? { eventJournal: deps.eventJournal }
      : {}),
    ...(scopePolicySnapshot !== undefined ? { scopePolicySnapshot } : {}),
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
    runCommand,
    state: deps.runContext?.state ?? unsupportedTransactionalState,
    runTool: async (name, input, toolContext) => {
      const stepId = toolContext?.stepId ?? deps.currentStepId ?? "unknown";
      const context = buildWorkflowToolContext(
        metadata,
        deps.pbus,
        stepId,
        deps.scopeDir,
        deps.projectDir,
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
      const executeResolvedTool = (): Promise<ToolResult> =>
        withToolCallExecutionOptions(executionOptions, () =>
          runTool ? runTool(name, input, context) : executeTool(name, input, context)
        );
      const effect = getToolEffect(name, input);
      const writerTransaction = deps.runContext?.sandbox.repository === "write";
      if (writerTransaction && !isRunLocalEffect(effect)) {
        const detail = effect === undefined
          ? "has no registered effect"
          : `has ${effect.kind} effect on ${effect.scope}`;
        throw new Error(
          `Repository writer tool call "${name}" ${detail}; shared effects must run ` +
            "from a repository:none workflow after integration",
        );
      }
      const effectId = toolContext?.effectId ??
        `${stepId}:tool:${transactionalToolSequence++}`;
      const requiresDurableExecution =
        effect !== undefined &&
        effect.kind !== "read" &&
        !effect.idempotent;
      let result: ToolResult;
      if (requiresDurableExecution) {
        if (deps.runContext === undefined) {
          throw new Error(
            `Declarative tool step "${stepId}" requires a durable run context`,
          );
        }
        const durableResult = await deps.runContext.effects.execute({
          key: `tool-step:${effectId}`,
          requestFingerprint: fingerprintToolEffectRequest(name, input),
          execute: async () => durableToolResult(await executeResolvedTool()),
        });
        result = restoredToolResult(durableResult);
      } else {
        result = await executeResolvedTool();
      }
      if (!runTool && result.is_error) throw new Error(result.content);
      return result;
    },
    runAgentHarness,
    emit: (event, payload, options) => {
      const writerTransaction = deps.runContext?.sandbox.repository === "write";
      if (options?.delivery === "on-run-success" || writerTransaction) {
        if (deps.runContext === undefined) {
          throw new Error(
            `Transactional emit step "${options?.stepId ?? deps.currentStepId ?? "unknown"}" requires a durable run context`,
          );
        }
        const preparedPayload = deps.pbus.prepareDynamic(event, payload);
        const stepId = options?.stepId ?? deps.currentStepId;
        if (stepId === undefined) {
          throw new Error("Writer code-step emits require a current step identity");
        }
        deps.runContext.publications.stageEmit(
          options === undefined
            ? `${stepId}:emit:${transactionalEmitSequence++}`
            : stepId,
          event,
          preparedPayload,
        );
        return;
      }
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
    readRuntimeState: deps.readRuntimeState,
    ...(deps.deadLetterQueue !== undefined
      ? { deadLetterQueue: deps.deadLetterQueue }
      : {}),
    reportProgress: () => {},
    triggerWorkflow: async (workflowName, payload, waitFor, signal, triggerId) => {
      if (!deps.triggerWorkflow) {
        throw new Error("triggerWorkflow is not supported in this execution context");
      }
      return deps.triggerWorkflow(workflowName, payload, waitFor, signal, triggerId);
    },
  };
}
