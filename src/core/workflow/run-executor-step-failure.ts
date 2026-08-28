import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import type { AgentUsage } from "#core/agent-harness/usage.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import {
  type ActiveTimeoutSnapshot,
  activeTimingMetadata,
} from "./active-timeout.js";
import { buildStepCompletedPayload, resolveStepAutonomyMode } from "./event-payloads.js";
import {
  RepairAgentRuntimeError,
  RepairLoopError,
} from "./repair-loop.js";
import type { RunExecutorBoundaryValue } from "./run-executor-step.js";
import { writeFailedAgentTrajectoryDiagnostics } from "./run-executor-step-artifacts.js";
import {
  applyOutputSizeLimit,
  type SingleStepResult,
  type StepAccumulators,
  type StepDeps,
} from "./run-executor-step-shared.js";
import type { WorkflowStepResult } from "./run-types.js";
import {
  AgentStepIdleTimeoutError,
  WorkflowStepIdleTimeoutError,
} from "./step-idle-timeout.js";
import type { WorkflowStep } from "./step-types.js";
import type { AgentStepConfig } from "./steps/step-executor-agent.js";
import {
  AgentStepRuntimeError,
  workflowAgentBackoffSignalFromError,
} from "./steps/step-executor-retry.js";
import type { WorkflowAgentBackoffSignal } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export function recordWorkflowStepFailure(args: {
  error: RunExecutorBoundaryValue;
  definition: WorkflowDefinition;
  step: WorkflowStep;
  run: Pick<ActiveWorkflowRunHandle, "metadata" | "recordStep">;
  runAbortController: AbortController;
  stepAbortController: AbortController;
  agentConfig: AgentStepConfig;
  acc: StepAccumulators;
  deps: StepDeps;
  stepStartedAt: number;
  timing: ActiveTimeoutSnapshot | undefined;
  capturedAgentMessages: readonly KotaAgentMessage[];
  usage?: AgentUsage;
}): SingleStepResult {
  const {
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
    usage,
  } = args;
  // A step deadline is a failed run, while a run-level abort remains an
  // interruption owned by the surrounding executor.
  const abortReason = stepAbortController.signal.reason;
  const caughtError =
    args.error instanceof Error ? args.error : new Error(String(args.error));
  const repairFailure =
    caughtError instanceof RepairLoopError ||
    caughtError instanceof RepairAgentRuntimeError
      ? caughtError
      : undefined;
  const nestedRepairIdleTimeout =
    repairFailure instanceof RepairLoopError &&
    repairFailure.agentBackoff instanceof AgentStepIdleTimeoutError
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
  const err =
    repairFailure ??
    idleTimeoutError ??
    (isStepTimeout
      ? new Error(
          abortReason instanceof Error
            ? abortReason.message
            : `Step "${step.id}" timed out`,
        )
      : caughtError);

  const agentRuntimeFailure =
    err instanceof AgentStepRuntimeError
      ? err
      : repairFailure instanceof RepairLoopError
        ? repairFailure.agentBackoff
        : undefined;
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
    scopeRoot: agentConfig.scopeRoot,
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
  const failedBase = {
    id: step.id,
    status: "failed",
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
    ...activeTimingMetadata(timing),
    ...(repairFailure !== undefined
      ? {
          output: repairFailureOutput?.output,
        }
      : agentRuntimeFailure?.sessionId !== undefined
        ? { output: { sessionId: agentRuntimeFailure.sessionId } }
      : {}),
    error: err.message,
    ...(idleTimeoutError !== undefined
      ? {
          errorKind: "idle-timeout" as const,
          idleTimeoutMs: idleTimeoutError.idleTimeoutMs,
        }
      : isStepTimeout
        ? { errorKind: "step-timeout" as const }
        : repairFailure instanceof RepairLoopError &&
            repairFailure.kind !== undefined
          ? { errorKind: repairFailure.kind }
          : {}),
    ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
  } as const;
  if (step.type === "agent" && usage === undefined) {
    throw new Error(`Agent step "${step.id}" failed without usage telemetry`);
  }
  const failed: WorkflowStepResult = step.type === "agent"
    ? {
        ...failedBase,
        type: "agent",
        usage: usage!,
        ...(trajectoryDiagnostics !== undefined ? { trajectoryDiagnostics } : {}),
      }
    : { ...failedBase, type: step.type };
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
}
