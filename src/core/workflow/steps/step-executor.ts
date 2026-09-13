import {
  collectAgentVerificationTrajectory,
  type KotaAgentMessage,
} from "#core/agent-harness/index.js";
import type { EventBus } from "#core/events/event-bus.js";
import { AgentBackoffAdmissionError } from "../agent-backoff.js";
import { withWorkflowBlockingOperation } from "../blocking-operation-context.js";
import {
  continuationPacketNeedsJudgment,
  WorkflowContinuationCheckpointRequest,
  type WorkflowContinuationRecord,
} from "../continuation.js";
import type { RepairCheckResult, RepairIteration } from "../repair-loop.js";
import {
  buildRepairPrompt,
  evaluateAgentContinuation,
  prepareAgentContinuationPacket,
  RepairLoopError,
  runAgentRepairLoop,
  WorkflowContinuationSuspension,
} from "../repair-loop.js";
import { repairProgressSnapshot } from "../repair-loop-progress.js";
import type { WorkflowRunMetadata, WorkflowStepContext, WorkflowStepSkipReason } from "../run-types.js";
import type { WorkflowNotifyConfig } from "../step-input-base.js";
import {
  type WorkflowCodeStepContext,
  WorkflowStepOutputValidationError,
} from "../step-input-code.js";
import type { WorkflowApprovalStep, WorkflowAwaitEventStep, WorkflowCodeStep, WorkflowEmitStep, WorkflowRestartStep, WorkflowStep, WorkflowToolStep, WorkflowTriggerStep } from "../step-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";
import type { AgentStepConfig, AgentStepResult, WorkflowStepOutput } from "./step-executor-agent.js";
import {
  AgentStepRuntimeError,
  DEFAULT_AGENT_STEP_RETRY,
  executeAgentStep,
  withRetry,
} from "./step-executor-agent.js";
import { buildAgentPrompt } from "./step-executor-agent-prompt.js";
import type { ActiveAgentContinuationRuntime } from "./step-executor-agent-types.js";
import { executeApprovalStep } from "./step-executor-approval.js";
import { executeAwaitEventStep } from "./step-executor-await-event.js";
import { executeTriggerStep } from "./step-executor-trigger.js";

export type {
  AgentStepConfig,
  AgentStepResult,
  RepairCheckResult,
  RepairIteration,
  WorkflowStepOutput,
};
export {
  AgentStepRuntimeError,
  buildAgentPrompt,
  buildRepairPrompt,
  DEFAULT_AGENT_STEP_RETRY,
  executeAgentStep,
  withRetry,
};

export async function resolveValue<T>(
  value: T | ((context: WorkflowStepContext) => T | Promise<T>),
  context: WorkflowStepContext,
): Promise<T> {
  if (typeof value === "function") {
    return (value as (ctx: WorkflowStepContext) => T | Promise<T>)(context);
  }
  return value;
}

export async function shouldRunStep(
  step: WorkflowStep,
  context: WorkflowStepContext,
): Promise<boolean> {
  if (!step.when) return true;
  return Boolean(await step.when(context));
}

export type StepRunDecision =
  | { run: true }
  | { run: false; skipReason: WorkflowStepSkipReason };

/**
 * Evaluate whether a step should run, returning either `{ run: true }` or a
 * structured skip reason. Skip sites that need to persist a `skipReason` on
 * the resulting `WorkflowStepResult` use this instead of {@link shouldRunStep}
 * so the reason is constructed once, next to the predicate evaluation.
 */
export async function evaluateStepRunDecision(
  step: WorkflowStep,
  context: WorkflowStepContext,
): Promise<StepRunDecision> {
  if (!step.when) return { run: true };
  const ok = Boolean(await step.when(context));
  if (ok) return { run: true };
  const label = step.when.skipLabel;
  const skipReason: WorkflowStepSkipReason = {
    kind: "when-predicate",
    ...(label !== undefined ? { label } : {}),
  };
  return { run: false, skipReason };
}

export async function executeToolStep(
  step: WorkflowToolStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  const input = await resolveValue(step.input ?? {}, context);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Tool step "${step.id}" resolved to a non-object input`);
  }
  const run = async () => {
    const result = await context.runTool(step.tool, input, {
      stepId: step.id,
      effectId: step.id,
    });
    if (result.is_error) throw new Error(result.content);
    return result;
  };
  return step.retry ? withRetry(run, step.retry) : run();
}

export async function executeEmitStep(
  step: WorkflowEmitStep,
  context: WorkflowStepContext,
  _notifyConfig?: WorkflowNotifyConfig,
): Promise<WorkflowStepOutput> {
  const payload = await resolveValue(step.payload ?? {}, context);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Emit step "${step.id}" resolved to a non-object payload`);
  }
  context.emit(step.event, payload as Record<string, unknown>, {
    delivery: "on-run-success",
    stepId: step.id,
  });
  return { event: step.event, payload };
}

export async function executeRestartStep(
  step: WorkflowRestartStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  const missingRequirements = step.requires.filter((stepId) => {
    const result = context.stepResults[stepId];
    return !result || result.status !== "success";
  });
  if (missingRequirements.length > 0) {
    throw new Error(
      `Restart step "${step.id}" requires successful verification steps: ${missingRequirements.join(", ")}`,
    );
  }

  const reason = await resolveValue(
    step.reason ?? `${context.workflow.name} requested restart`,
    context,
  );
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error(`Restart step "${step.id}" resolved to an empty reason`);
  }
  context.requestRestart(reason);
  return {
    event: "runtime.restart_requested",
    payload: {
      reason,
      workflow: context.workflow.name,
      runId: context.workflow.runId,
      requires: step.requires,
    },
  };
}

export async function executeCodeStep(
  step: WorkflowCodeStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  const codeContext: WorkflowCodeStepContext =
    withWorkflowBlockingOperation(context);
  const rawOutput = await step.run(codeContext);
  if (step.validate === undefined) return rawOutput as WorkflowStepOutput;
  try {
    return step.validate(rawOutput) as WorkflowStepOutput;
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new WorkflowStepOutputValidationError(step.id, "run", cause);
  }
}

export async function executeStep(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  context: WorkflowStepContext,
  abortController: AbortController,
  appendMessage: (message: KotaAgentMessage) => void,
  writeInputs: (systemPromptAppend: string | undefined, prompt: string) => void,
  agentConfig: AgentStepConfig,
  bus: EventBus,
  recordContinuation: (record: WorkflowContinuationRecord) => void = (record) => {
    metadata.continuations = [...(metadata.continuations ?? []), record];
  },
): Promise<WorkflowStepOutput | AgentStepResult> {
  if (step.type === "tool") return executeToolStep(step, context);
  if (step.type === "agent") {
    const continuationPolicy = step.repairLoop?.continuation;
    let continuationRuntime: ActiveAgentContinuationRuntime | undefined;
    if (continuationPolicy !== undefined) {
      const initialProgress = await repairProgressSnapshot(
        context.workspaceRoot,
        [],
        context.runCommand,
      );
      const initialWorkspace = {
        attempt: 0,
        source: "active" as const,
        verificationResults: [],
        workspaceFingerprint: initialProgress.key,
        changedPaths: initialProgress.changedPaths,
      };
      const activeMessages: KotaAgentMessage[] = [];
      const activeTrajectory: ActiveAgentContinuationRuntime["trajectory"][number][] = [];
      let observedVerificationCount = 0;
      let lastWorkspaceFingerprint = initialWorkspace.workspaceFingerprint;
      let activeSessionId = agentConfig.resumeSessionIds?.[step.id];
      let observation: Promise<void> | undefined;
      const observeBoundary = (
        message?: KotaAgentMessage,
      ): Promise<void> => {
        if (message !== undefined) {
          activeMessages.push(message);
          if (message.sessionId !== undefined) activeSessionId = message.sessionId;
        }
        if (observation !== undefined) return observation;
        observation = (async () => {
          const continuationContext = await continuationPolicy.collectContext(
            context,
            step,
          );
          const progress = await repairProgressSnapshot(
            context.workspaceRoot,
            [],
            context.runCommand,
          );
          const verificationTrajectory = collectAgentVerificationTrajectory(
            activeMessages,
          );
          const newVerificationResults = verificationTrajectory.slice(
            observedVerificationCount,
          );
          const workspaceChanged = progress.key !== lastWorkspaceFingerprint;
          if (workspaceChanged || newVerificationResults.length > 0) {
            activeTrajectory.push({
              attempt: activeTrajectory.length + 1,
              source: "active",
              verificationResults: newVerificationResults,
              workspaceFingerprint: progress.key,
              changedPaths: progress.changedPaths,
            });
            lastWorkspaceFingerprint = progress.key;
            observedVerificationCount = verificationTrajectory.length;
          }
          const packet = await prepareAgentContinuationPacket({
            policy: continuationPolicy,
            step,
            context,
            continuationContext,
            initialWorkspace,
            trajectory: activeTrajectory,
            currentWorkspace: {
              fingerprint: progress.key,
              changedPaths: progress.changedPaths,
              diffStat: progress.diffStat,
              diff: progress.diff,
            },
            remainingFailures: [],
          });
          if (
            packet !== null &&
            continuationPacketNeedsJudgment(
              metadata.continuations ?? [],
              step.id,
              packet,
            )
          ) {
            throw new WorkflowContinuationCheckpointRequest(activeSessionId);
          }
        })().finally(() => {
          observation = undefined;
        });
        return observation;
      };
      continuationRuntime = {
        initialWorkspace,
        trajectory: activeTrajectory,
        onProgressMessage: (message) => observeBoundary(message),
        pollEvidence: () => observeBoundary(),
      };
    }
    let resumedSessionId = agentConfig.resumeSessionIds?.[step.id];
    let result: AgentStepResult;
    while (true) {
      const attemptConfig = resumedSessionId === undefined
        ? agentConfig
        : {
            ...agentConfig,
            resumeSessionIds: {
              ...agentConfig.resumeSessionIds,
              [step.id]: resumedSessionId,
            },
          };
      try {
        result = await executeAgentStep(
          definition,
          step,
          metadata,
          trigger,
          abortController,
          appendMessage,
          writeInputs,
          attemptConfig,
          context.stepOutputs,
          context.foreach,
          continuationRuntime,
        );
        break;
      } catch (error) {
        if (
          continuationPolicy === undefined ||
          continuationRuntime === undefined ||
          !(error instanceof WorkflowContinuationCheckpointRequest)
        ) {
          throw error;
        }
        resumedSessionId = error.sessionId ?? resumedSessionId;
        const progress = await repairProgressSnapshot(
          context.workspaceRoot,
          [],
          context.runCommand,
        );
        const record = await evaluateAgentContinuation({
          policy: continuationPolicy,
          step,
          context,
          metadata,
          initialWorkspace: continuationRuntime.initialWorkspace,
          trajectory: continuationRuntime.trajectory,
          currentWorkspace: {
            fingerprint: progress.key,
            changedPaths: progress.changedPaths,
            diffStat: progress.diffStat,
            diff: progress.diff,
          },
          remainingFailures: [],
        }).catch((failure: unknown) => {
          if (failure instanceof AgentBackoffAdmissionError) {
            throw new RepairLoopError(
              undefined, step.id, [],
              { content: "", turns: 0, sessionId: resumedSessionId,
                repairIterations: [], repairWarnings: [] },
              failure.message, failure,
            );
          }
          if (failure instanceof AgentStepRuntimeError) {
            // Recovery resumes the stopped writer, never the nested judge.
            throw new AgentStepRuntimeError(
              failure.message, failure.kind, false, failure.retryAt,
              resumedSessionId,
            );
          }
          throw failure;
        });
        if (record === null) continue;
        try {
          recordContinuation(record);
        } catch (persistenceError) {
          const suspension = new WorkflowContinuationSuspension(
            record,
            step.id,
            [],
            {
              content: "",
              turns: 0,
              ...(resumedSessionId === undefined
                ? {}
                : { sessionId: resumedSessionId }),
              repairIterations: [],
              repairWarnings: [],
              continuationDecisions: metadata.continuations ?? [record],
            },
          );
          suspension.recordCheckpointFailure(
            "continuation decision persistence failed",
            persistenceError,
          );
          throw suspension;
        }
        if (record.decision.decision === "continue") continue;
        throw new WorkflowContinuationSuspension(
          record,
          step.id,
          [],
          {
            content: "",
            turns: 0,
            ...(resumedSessionId === undefined
              ? {}
              : { sessionId: resumedSessionId }),
            repairIterations: [],
            repairWarnings: [],
            continuationDecisions: metadata.continuations ?? [record],
          },
        );
      }
    }
    if (!step.repairLoop) return result;
    try {
      return await runAgentRepairLoop(
        step,
        result,
        context,
        metadata,
        abortController,
        appendMessage,
        agentConfig,
        recordContinuation,
      );
    } catch (error) {
      if (error instanceof RepairLoopError && error.agentBackoff !== undefined) {
        throw error.asAgentStepRuntimeError();
      }
      throw error;
    }
  }
  if (step.type === "emit") return executeEmitStep(step, context, definition.notify);
  if (step.type === "restart") return executeRestartStep(step, context);
  if (step.type === "trigger") {
    return executeTriggerStep(step as WorkflowTriggerStep, context, abortController.signal);
  }
  if (step.type === "parallel") {
    throw new Error(
      `Parallel group "${step.id}" must be handled by the run executor, not executeStep`,
    );
  }
  if (step.type === "branch") {
    throw new Error(
      `Branch step "${step.id}" must be handled by the run executor, not executeStep`,
    );
  }
  if (step.type === "foreach") {
    throw new Error(
      `Foreach step "${step.id}" must be handled by the run executor, not executeStep`,
    );
  }
  if (step.type === "approval") {
    return executeApprovalStep(step as WorkflowApprovalStep, context, abortController.signal);
  }
  if (step.type === "await-event") {
    return executeAwaitEventStep(
      step as WorkflowAwaitEventStep,
      context,
      bus,
      abortController.signal,
    );
  }
  return executeCodeStep(step, context);
}
