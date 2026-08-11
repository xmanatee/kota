import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type KotaAgentMessage,
  resolveAgentHarness,
  type TrajectoryDiagnosticsMetadata,
} from "#core/agent-harness/index.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import {
  activeTimingMetadata,
  createActiveTimeout,
  createWorkflowStepActiveTimeoutError,
  rejectWhenActiveTimeoutExpires,
} from "./active-timeout.js";
import { buildStepCompletedPayload, resolveStepAutonomyMode } from "./event-payloads.js";
import { RepairLoopError } from "./repair-loop.js";
import type { ToolCallSummaryEntry, WorkflowRunMetadata, WorkflowRunWarning, WorkflowStepContext, WorkflowStepResult, WorkflowStepSkipReason } from "./run-types.js";
import {
  AgentStepIdleTimeoutError,
  createStepIdleTimeoutMonitor,
  WorkflowStepIdleTimeoutError,
} from "./step-idle-timeout.js";
import type { WorkflowStep } from "./step-types.js";
import {
  type AgentStepConfig,
  type AgentStepResult,
  AgentStepRuntimeError,
  executeStep,
} from "./steps/step-executor.js";
import {
  readAgentTrajectoryDiagnosticsCapabilityArtifact,
  writeAgentTrajectoryDiagnosticsArtifactFromCapability,
} from "./steps/step-executor-agent-trajectory-diagnostics.js";
import { workflowAgentBackoffSignalFromError } from "./steps/step-executor-retry.js";
import type { WorkflowAgentBackoffSignal, WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

/** Default step timeout when no timeoutMs is specified on the step definition. */
export const DEFAULT_STEP_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export const DEFAULT_MAX_STEP_OUTPUT_BYTES = 256 * 1024; // 256 KB
export const HARD_MAX_STEP_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB

export type TruncationNotice = {
  truncated: true;
  originalBytes: number;
  message: string;
};

export function applyOutputSizeLimit(
  output: unknown,
  maxBytes: number | undefined,
): { output: unknown; warning?: WorkflowRunWarning } {
  if (output === undefined || output === null) return { output };
  const limit = Math.min(maxBytes ?? DEFAULT_MAX_STEP_OUTPUT_BYTES, HARD_MAX_STEP_OUTPUT_BYTES);
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch (error) {
    const message = `Step output could not be serialized: ${error instanceof Error ? error.message : String(error)}`;
    const notice: TruncationNotice = {
      truncated: true,
      originalBytes: 0,
      message,
    };
    return {
      output: notice,
      warning: { type: "step-output-truncated", message },
    };
  }
  const byteLength = Buffer.byteLength(serialized, "utf-8");
  if (byteLength <= limit) return { output };
  const notice: TruncationNotice = {
    truncated: true,
    originalBytes: byteLength,
    message: `Step output truncated: ${byteLength} bytes exceeds ${limit}-byte limit`,
  };
  return {
    output: notice,
    warning: { type: "step-output-truncated", message: notice.message },
  };
}

export type StepAccumulators = {
  stepOutputsById: Record<string, unknown>;
  stepResultsById: Record<string, WorkflowStepResult>;
  stepOutputs: unknown[];
  warnings: WorkflowRunWarning[];
};

/**
 * Step-executor deps. `pbus` is required because every step-level lifecycle
 * emit (`workflow.step.*`) flows through it; the run-executor builds it
 * once per run.
 */
type StepDeps = {
  bus: EventBus;
  pbus: ProjectScopedEventBus;
  log: (message: string) => void;
};

const PARENT_SKIPPED_REASON: WorkflowStepSkipReason = { kind: "parent-skipped" };

export function buildSkippedResult(
  step: WorkflowStep,
  stepStartedAt: number,
  acc: StepAccumulators,
  recordStep: (result: WorkflowStepResult) => void,
  pbus: ProjectScopedEventBus,
  runMetadata: WorkflowRunMetadata,
  defaultAutonomyMode: AutonomyMode | undefined,
  skipReason: WorkflowStepSkipReason,
): WorkflowStepResult {
  const skipped: WorkflowStepResult = {
    id: step.id,
    type: step.type,
    status: "skipped",
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
    skipReason,
  };
  recordStep(skipped);
  acc.stepOutputsById[step.id] = { skipped: true };
  acc.stepResultsById[step.id] = skipped;
  acc.stepOutputs.push({ skipped: true });
  if (step.type === "parallel") {
    const skippedAt = new Date(stepStartedAt).toISOString();
    for (const childStep of step.steps) {
      const childSkipped: WorkflowStepResult = {
        id: childStep.id,
        type: childStep.type,
        status: "skipped",
        startedAt: skippedAt,
        completedAt: skippedAt,
        durationMs: 0,
        skipReason: PARENT_SKIPPED_REASON,
      };
      acc.stepOutputsById[childStep.id] = { skipped: true };
      acc.stepResultsById[childStep.id] = childSkipped;
    }
  } else if (step.type === "branch") {
    const skippedAt = new Date(stepStartedAt).toISOString();
    const skipArmSteps = (armSteps: typeof step.ifTrue) => {
      for (const armStep of armSteps) {
        acc.stepOutputsById[armStep.id] = { skipped: true };
        acc.stepResultsById[armStep.id] = {
          id: armStep.id,
          type: armStep.type,
          status: "skipped",
          startedAt: skippedAt,
          completedAt: skippedAt,
          durationMs: 0,
          skipReason: PARENT_SKIPPED_REASON,
        };
        if (armStep.type === "branch") {
          skipArmSteps(armStep.ifTrue);
          skipArmSteps(armStep.ifFalse);
        }
      }
    };
    skipArmSteps(step.ifTrue);
    skipArmSteps(step.ifFalse);
  } else if (step.type === "foreach") {
    const skippedAt = new Date(stepStartedAt).toISOString();
    for (const innerStep of step.steps) {
      acc.stepOutputsById[innerStep.id] = { skipped: true };
      acc.stepResultsById[innerStep.id] = {
        id: innerStep.id,
        type: innerStep.type,
        status: "skipped",
        startedAt: skippedAt,
        completedAt: skippedAt,
        durationMs: 0,
        skipReason: PARENT_SKIPPED_REASON,
      };
    }
  }
  pbus.emit(
    "workflow.step.completed",
    buildStepCompletedPayload(
      runMetadata,
      skipped,
      resolveStepAutonomyMode(step, defaultAutonomyMode),
    ),
  );
  return skipped;
}

type TelemetryArtifact = {
  tools: Record<string, { calls: number; totalMs: number }>;
};

function readToolCallSummary(
  stepId: string,
  runDir: string,
  projectDir: string,
  log: (message: string) => void,
): ToolCallSummaryEntry[] | undefined {
  const path = join(resolve(projectDir, runDir), "steps", `${stepId}.tool-telemetry.json`);
  if (!existsSync(path)) return undefined;
  try {
    const artifact = JSON.parse(readFileSync(path, "utf-8")) as TelemetryArtifact;
    const entries = Object.entries(artifact.tools ?? {});
    if (entries.length === 0) return undefined;
    return entries
      .sort((a, b) => b[1].calls - a[1].calls)
      .map(([tool, s]) => ({ tool, count: s.calls, totalMs: s.totalMs }));
  } catch (error) {
    log(`Tool telemetry summary for step "${stepId}" could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function writeFailedAgentTrajectoryDiagnostics(args: {
  step: WorkflowStep;
  runDir: string;
  projectDir: string;
  messages: readonly KotaAgentMessage[];
  log: (message: string) => void;
}): TrajectoryDiagnosticsMetadata | undefined {
  const { step, runDir, projectDir, messages, log } = args;
  if (step.type !== "agent" || step.validate !== undefined) return undefined;
  const artifactPath = join(
    resolve(projectDir, runDir),
    "steps",
    `${step.id}.trajectory-diagnostics.json`,
  );
  if (existsSync(artifactPath)) return undefined;
  try {
    const capability =
      readAgentTrajectoryDiagnosticsCapabilityArtifact({ stepId: step.id, runDir, projectDir }) ??
      { emitsAgentMessageStream: resolveAgentHarness(step.harness).emitsAgentMessageStream };
    return writeAgentTrajectoryDiagnosticsArtifactFromCapability({
      stepId: step.id,
      runDir,
      projectDir,
      capability,
      messages,
      changedFiles: [],
    });
  } catch (error) {
    log(`Trajectory diagnostics for failed step "${step.id}" could not be written: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export type SingleStepResult = {
  completed: WorkflowStepResult;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
  truncationWarning?: WorkflowRunWarning;
};

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
      ? readToolCallSummary(step.id, run.metadata.runDir, agentConfig.projectDir, deps.log)
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
    // If the step-level controller was aborted by the deadline (not the run-level abort),
    // surface a plain Error so the run gets status "failed" rather than "interrupted".
    const abortReason = stepAbortController.signal.reason;
    const caughtError = error instanceof Error ? error : new Error(String(error));
    const repairFailure = caughtError instanceof RepairLoopError
      ? caughtError
      : undefined;
    const nestedRepairIdleTimeout =
      repairFailure?.agentBackoff instanceof AgentStepIdleTimeoutError
        ? repairFailure.agentBackoff
        : undefined;
    const idleTimeoutError =
      caughtError instanceof WorkflowStepIdleTimeoutError ||
      caughtError instanceof AgentStepIdleTimeoutError
        ? caughtError
        : abortReason instanceof WorkflowStepIdleTimeoutError ||
            abortReason instanceof AgentStepIdleTimeoutError
          ? abortReason
          : nestedRepairIdleTimeout;
    const isStepTimeout =
      stepAbortController.signal.aborted &&
      !runAbortController.signal.aborted &&
      idleTimeoutError === undefined;
    const err = repairFailure ?? idleTimeoutError ?? (isStepTimeout
      ? (() => {
          return new Error(abortReason instanceof Error ? abortReason.message : `Step "${step.id}" timed out`);
        })()
      : caughtError);

    const agentRuntimeFailure = err instanceof AgentStepRuntimeError
      ? err
      : repairFailure?.agentBackoff;
    let agentBackoff: WorkflowAgentBackoffSignal | undefined;
    if (
      agentRuntimeFailure !== undefined &&
      (!isStepTimeout || idleTimeoutError !== undefined)
    ) {
      agentBackoff = workflowAgentBackoffSignalFromError(agentRuntimeFailure);
    }
    const trajectoryDiagnostics = writeFailedAgentTrajectoryDiagnostics({
      step,
      runDir: run.metadata.runDir,
      projectDir: agentConfig.projectDir,
      messages: capturedAgentMessages,
      log: deps.log,
    });
    const repairFailureOutput = repairFailure
      ? applyOutputSizeLimit(
          repairFailure.output,
          agentConfig.config?.workflow?.maxStepOutputBytes,
        )
      : undefined;
    if (repairFailureOutput?.warning) {
      acc.warnings.push(repairFailureOutput.warning);
      deps.log(
        `Failed step "${step.id}" output truncated in workflow "${definition.name}": ${repairFailureOutput.warning.message}`,
      );
    }
    const failed: WorkflowStepResult = {
      id: step.id,
      type: step.type,
      status: "failed",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      ...activeTimingMetadata(timing),
      ...(repairFailure !== undefined
        ? {
            costUsd: repairFailure.output.totalCostUsd,
            inputTokens: repairFailure.output.inputTokens,
            outputTokens: repairFailure.output.outputTokens,
            output: repairFailureOutput?.output,
          }
        : {}),
      error: err.message,
      ...(idleTimeoutError !== undefined
        ? { errorKind: "idle-timeout" as const, idleTimeoutMs: idleTimeoutError.idleTimeoutMs }
        : isStepTimeout
          ? { errorKind: "step-timeout" as const }
          : repairFailure?.kind !== undefined
            ? { errorKind: repairFailure.kind }
        : {}),
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
      ...(trajectoryDiagnostics !== undefined ? { trajectoryDiagnostics } : {}),
    };
    run.recordStep(failed);
    acc.stepResultsById[step.id] = failed;
    deps.pbus.emit(
      "workflow.step.completed",
      buildStepCompletedPayload(
        run.metadata,
        failed,
        resolveStepAutonomyMode(step, definition.defaultAutonomyMode),
      ),
    );
    deps.log(
      `Failed step "${failed.id}" (${failed.type}) in workflow "${definition.name}": ${failed.error ?? "unknown error"}`,
    );
    return { completed: failed, agentBackoff, thrownError: err };
  } finally {
    activeTimeout?.dispose();
    idleMonitor?.dispose();
    runAbortController.signal.removeEventListener("abort", forwardRunAbort);
  }
}
