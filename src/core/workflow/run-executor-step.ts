import { randomUUID } from "node:crypto";
import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import {
  registerSessionEnvironment,
  unregisterSessionEnvironment,
} from "#core/tools/session-environment.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import {
  activeTimingMetadata,
  createActiveTimeout,
  createWorkflowStepActiveTimeoutError,
  rejectWhenActiveTimeoutExpires,
} from "./active-timeout.js";
import { buildStepCompletedPayload, resolveStepAutonomyMode } from "./event-payloads.js";
import { readToolCallSummary } from "./run-executor-step-artifacts.js";
import { recordWorkflowStepFailure } from "./run-executor-step-failure.js";
import {
  applyOutputSizeLimit,
  type SingleStepResult,
  type StepAccumulators,
  type StepDeps,
} from "./run-executor-step-shared.js";
import type { WorkflowStepContext, WorkflowStepResult } from "./run-types.js";
import {
  createStepIdleTimeoutMonitor,
  WorkflowStepIdleTimeoutError,
} from "./step-idle-timeout.js";
import type { WorkflowStep } from "./step-types.js";
import {
  type AgentStepConfig,
  type AgentStepResult,
  executeStep,
} from "./steps/step-executor.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export type {
  SingleStepResult,
  StepAccumulators,
  TruncationNotice,
} from "./run-executor-step-shared.js";
export {
  applyOutputSizeLimit,
  buildSkippedResult,
  DEFAULT_MAX_STEP_OUTPUT_BYTES,
  HARD_MAX_STEP_OUTPUT_BYTES,
} from "./run-executor-step-shared.js";

/** Default step timeout when no timeoutMs is specified on the step definition. */
export const DEFAULT_STEP_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/** Boundary value shared by the executor's focused result helpers. */
export type RunExecutorBoundaryValue = unknown;

export async function executeWorkflowStep(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  run: Pick<ActiveWorkflowRunHandle, "metadata" | "recordStep" | "appendAgentMessage" | "writeAgentInputs">,
  trigger: WorkflowRunTrigger,
  context: WorkflowStepContext,
  runAbortController: AbortController,
  agentConfig: AgentStepConfig,
  acc: StepAccumulators,
  deps: StepDeps,
  stepStartedAt: number,
): Promise<SingleStepResult> {
  // Per-step abort controller: forwards run-level aborts and enforces the step deadline.
  // Agent steps respond to the abort signal; code/tool steps use Promise.race as a fallback.
  const stepAbortController = new AbortController();
  const forwardRunAbort = () => stepAbortController.abort(runAbortController.signal.reason);
  runAbortController.signal.addEventListener("abort", forwardRunAbort, { once: true });

  // Await-event steps use their protocol deadline. A validated null timeout
  // delegates liveness to the step's trusted idle-progress monitor.
  const configuredTimeoutMs = "timeoutMs" in step ? step.timeoutMs : undefined;
  const skipActiveTimeout =
    configuredTimeoutMs === null ||
    (step.type === "await-event" && configuredTimeoutMs === undefined);
  const timeoutMs = skipActiveTimeout
    ? undefined
    : (configuredTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS);
  const activeTimeout =
    timeoutMs === undefined
      ? null
      : createActiveTimeout(
          timeoutMs,
          () => createWorkflowStepActiveTimeoutError(step.id, timeoutMs),
          (error) => stepAbortController.abort(error),
        );
  const idleTimeoutMs = "idleTimeoutMs" in step ? step.idleTimeoutMs : undefined;
  const idleMonitor =
    step.type !== "agent" &&
    step.type !== "await-event" &&
    idleTimeoutMs !== undefined
      ? createStepIdleTimeoutMonitor({
          stepId: step.id,
          idleTimeoutMs,
          abortController: stepAbortController,
          createError: (idleForMs) =>
            new WorkflowStepIdleTimeoutError(
              step.id,
              idleTimeoutMs,
              idleForMs,
            ),
        })
      : undefined;
  const progressContext: WorkflowStepContext = {
    ...context,
    signal: stepAbortController.signal,
    reportProgress: idleMonitor?.reportProgress ?? context.reportProgress ?? (() => {}),
  };
  const pendingCodeEmits: Array<{
    event: string;
    payload: Record<string, unknown>;
    options?: Readonly<{ delivery?: "on-run-success"; stepId: string }>;
  }> = [];
  if (step.type === "code") {
    progressContext.emit = (event, payload, options) => {
      pendingCodeEmits.push({
        event,
        payload: structuredClone(payload),
        ...(options === undefined ? {} : { options }),
      });
    };
  }
  progressContext.runCommand = (input) =>
    context.runCommand({
      ...input,
      signal: input.signal ?? stepAbortController.signal,
    });
  const toolSession = {
    sessionId: `workflow:${randomUUID()}`,
    scopeId: deps.pbus.getScopeId(),
  };
  registerSessionEnvironment(toolSession);
  progressContext.runTool = (name, input, toolContext) =>
    context.runTool(name, input, {
      ...toolContext,
      stepId: toolContext?.stepId ?? step.id,
      sessionId: toolSession.sessionId,
    });
  const capturedAgentMessages: KotaAgentMessage[] = [];

  try {
    const stepPromise = executeStep(
      definition,
      step,
      run.metadata,
      trigger,
      progressContext,
      stepAbortController,
      (message) => {
        if (step.type === "agent" && step.validate === undefined) {
          capturedAgentMessages.push(message);
        }
        run.appendAgentMessage(step.id, message);
      },
      (systemPromptAppend, prompt) => run.writeAgentInputs(step.id, systemPromptAppend, prompt),
      agentConfig,
      deps.bus,
    );
    const racePromises: Promise<unknown>[] = [stepPromise];
    if (activeTimeout !== null) {
      racePromises.push(rejectWhenActiveTimeoutExpires(activeTimeout));
    }
    if (idleMonitor !== undefined) racePromises.push(idleMonitor.timeout);
    const rawResult = await (racePromises.length === 1
      ? stepPromise
      : Promise.race(racePromises));
    for (const pending of pendingCodeEmits) {
      context.emit(pending.event, pending.payload, pending.options);
    }
    const timing = activeTimeout?.snapshot();
    activeTimeout?.dispose();
    idleMonitor?.dispose();
    // Agent steps return an AgentStepResult wrapper so the resolved harness
    // and model can be promoted to top-level fields on the step result; every
    // other step type returns its output directly.
    const isAgentResult = step.type === "agent";
    const agentResult = isAgentResult ? (rawResult as AgentStepResult) : undefined;
    const rawOutput = isAgentResult ? (rawResult as AgentStepResult).output : rawResult;
    const agentUsage =
      step.type === "agent" &&
      rawOutput != null &&
      typeof rawOutput === "object" &&
      !Array.isArray(rawOutput)
        ? (rawOutput as Record<string, unknown>)
        : undefined;
    const stepCostUsd =
      typeof agentUsage?.totalCostUsd === "number"
        ? agentUsage.totalCostUsd
        : undefined;
    const inputTokens =
      typeof agentUsage?.inputTokens === "number"
        ? agentUsage.inputTokens
        : undefined;
    const outputTokens =
      typeof agentUsage?.outputTokens === "number"
        ? agentUsage.outputTokens
        : undefined;

    const { output, warning: truncationWarning } = applyOutputSizeLimit(
      rawOutput,
      agentConfig.config?.workflow?.maxStepOutputBytes,
    );
    if (truncationWarning) {
      acc.warnings.push(truncationWarning);
      deps.log(`Step "${step.id}" output truncated in workflow "${definition.name}": ${truncationWarning.message}`);
    }

    const toolCalls = step.type === "agent"
      ? readToolCallSummary(step.id, run.metadata.runDir, agentConfig.scopeRoot, deps.log)
      : undefined;
    const completed: WorkflowStepResult = {
      id: step.id,
      type: step.type,
      status: "success",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      ...activeTimingMetadata(timing),
      ...(stepCostUsd != null ? { costUsd: stepCostUsd } : {}),
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      output,
      ...(toolCalls != null ? { toolCalls } : {}),
      ...(agentResult
        ? {
            harness: agentResult.harness,
            model: agentResult.model,
            trajectoryDiagnostics: agentResult.trajectoryDiagnostics,
          }
        : {}),
    };
    run.recordStep(completed);
    acc.stepOutputsById[step.id] = output;
    acc.stepResultsById[step.id] = completed;
    acc.stepOutputs.push(output);

    deps.pbus.emit(
      "workflow.step.completed",
      buildStepCompletedPayload(
        run.metadata,
        completed,
        resolveStepAutonomyMode(step, definition.defaultAutonomyMode),
      ),
    );
    const logDetails: string[] = [
      `${completed.activeDurationMs ?? completed.durationMs}ms`,
    ];
    if (completed.hostSuspendedMs !== undefined) {
      logDetails.push(`host suspended ${completed.hostSuspendedMs}ms`);
    }
    if (completed.type === "agent" && completed.output && typeof completed.output === "object") {
      const o = completed.output as { turns?: unknown; totalCostUsd?: unknown; subtype?: unknown };
      if (typeof o.turns === "number") logDetails.push(`${o.turns} turn(s)`);
      if (typeof o.totalCostUsd === "number") logDetails.push(`$${o.totalCostUsd.toFixed(2)}`);
      if (typeof o.subtype === "string" && o.subtype) logDetails.push(o.subtype);
    }
    deps.log(
      `Completed step "${completed.id}" (${completed.type}) in workflow "${definition.name}" [${logDetails.join(", ")}]`,
    );
    return { completed, ...(truncationWarning ? { truncationWarning } : {}) };
  } catch (error) {
    const timing = activeTimeout?.snapshot();
    activeTimeout?.dispose();
    idleMonitor?.dispose();
    return recordWorkflowStepFailure({
      error,
      definition,
      step,
      run,
      runAbortController,
      stepAbortController,
      agentConfig,
      acc,
      deps,
      stepStartedAt,
      timing,
      capturedAgentMessages,
    });
  } finally {
    unregisterSessionEnvironment(toolSession);
    activeTimeout?.dispose();
    idleMonitor?.dispose();
    runAbortController.signal.removeEventListener("abort", forwardRunAbort);
  }
}
