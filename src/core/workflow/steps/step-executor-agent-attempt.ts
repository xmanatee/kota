import {
  type AgentHarness,
  type AgentHarnessResult,
  type AgentTokenBudgetLedger,
  createNativeAgentInvalidationLifecycle,
  type KotaAgentMessage,
} from "#core/agent-harness/index.js";
import { withHandoffAgentRuntime } from "#core/tools/handoff-agent-runtime.js";
import type { ToolTelemetry } from "#core/tools/tool-telemetry.js";
import { AgentBackoffAdmissionError } from "../agent-backoff.js";
import { WorkflowContinuationCheckpointRequest } from "../continuation.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import { AgentStepIdleTimeoutError } from "../step-idle-timeout.js";
import type { WorkflowAgentStepOutputValidationContext } from "../step-input-base.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { AgentStepConfig, WorkflowStepOutput } from "./step-executor-agent.js";
import {
  type AgentStepIdleMonitor,
  createAgentAttemptMessageCapture,
  createAgentStepIdleMonitor,
  waitForAgentHarnessWithIdleMonitor,
} from "./step-executor-agent-idle.js";
import {
  JsonOutputValidationError,
} from "./step-executor-agent-json.js";
import {
  jsonAgentOutputFeedback,
  parseJsonAgentStepOutput,
  validateAgentStepOutput,
  workflowOutputFromHarnessResult,
} from "./step-executor-agent-output.js";
import { buildAgentHarnessRunOptions } from "./step-executor-agent-run-options.js";
import { makeToolTelemetryTracker } from "./step-executor-agent-telemetry.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  classifyThrownAgentError,
} from "./step-executor-retry.js";
import { createWorkflowAgentHarnessRunner } from "./workflow-agent-harness-runner.js";

const CONTINUATION_EVIDENCE_POLL_INTERVAL_MS = 1_000;

function startContinuationEvidenceMonitor(input: {
  poll: (() => void | Promise<void>) | undefined;
  abortController: AbortController;
  log: ((message: string) => void) | undefined;
}): () => void {
  if (input.poll === undefined) return () => {};
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (disposed || input.abortController.signal.aborted) return;
    timer = setTimeout(() => {
      void poll();
    }, CONTINUATION_EVIDENCE_POLL_INTERVAL_MS);
    timer.unref?.();
  };
  const poll = async (): Promise<void> => {
    if (disposed || input.abortController.signal.aborted) return;
    try {
      await input.poll?.();
    } catch (error) {
      if (error instanceof WorkflowContinuationCheckpointRequest) {
        input.abortController.abort(error);
        return;
      }
      input.log?.(
        `Continuation evidence observation failed without interrupting the active agent: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    schedule();
  };
  schedule();
  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

export async function runAgentAttempt(input: {
  step: WorkflowAgentStep;
  metadata: WorkflowRunMetadata;
  agentConfig: AgentStepConfig;
  resolvedHarness: AgentHarness;
  resolvedModel: string;
  prompt: string;
  jsonOutputFeedback: string | undefined;
  systemPrompt: string | undefined;
  abortController: AbortController;
  appendMessage: (message: KotaAgentMessage) => void;
  bufferAgentMessages: boolean;
  stepTelemetry: ToolTelemetry;
  tokenBudget?: AgentTokenBudgetLedger;
  onSuccessfulAttemptMessages: (messages: KotaAgentMessage[]) => void;
  onJsonOutputFeedback: (feedback: string) => void;
  onSessionId: (sessionId: string) => void;
  outputValidationContext: WorkflowAgentStepOutputValidationContext;
  onProgressMessage?: (message: KotaAgentMessage) => void | Promise<void>;
  pollContinuationEvidence?: () => void | Promise<void>;
  persistContinuationSession?: boolean;
}): Promise<WorkflowStepOutput> {
  const {
    step,
    metadata,
    agentConfig,
    resolvedHarness,
    resolvedModel,
    systemPrompt,
    abortController,
    appendMessage,
    bufferAgentMessages,
    stepTelemetry,
    tokenBudget,
  } = input;
  const attemptMessages: KotaAgentMessage[] = [];
  const invalidation = createNativeAgentInvalidationLifecycle({
    executionLabel: `Agent step "${step.id}"`,
    parentSignal: abortController.signal,
    ...(resolvedHarness.toolControl === "native"
      ? {
          scopeId: agentConfig.scopeId,
          authority: agentConfig.scopePolicyAuthority,
          initialSnapshot: agentConfig.scopePolicySnapshot,
        }
      : {}),
  });
  const attemptAbortController = invalidation.abortController;
  let idleMonitor: AgentStepIdleMonitor | undefined;
  try {
    const captureMessage = createAgentAttemptMessageCapture({
      messages: attemptMessages,
      idleMonitor: () => idleMonitor,
      bufferAgentMessages,
      appendMessage,
      onProgressMessage: input.onProgressMessage === undefined
        ? undefined
        : async (message) => {
            try {
              await input.onProgressMessage?.(message);
            } catch (error) {
              if (
                error instanceof WorkflowContinuationCheckpointRequest &&
                resolvedHarness.toolControl === "native"
              ) {
                attemptAbortController.abort(error);
                return;
              }
              throw error;
            }
          },
    });
    const trackedMessage = resolvedHarness.emitsAgentMessageStream
      ? makeToolTelemetryTracker(stepTelemetry, captureMessage)
      : undefined;
    if (attemptAbortController.signal.aborted) {
      throw attemptAbortController.signal.reason instanceof Error
        ? attemptAbortController.signal.reason
        : new Error(`Agent step "${step.id}" aborted`);
    }
    const prompt = input.jsonOutputFeedback
      ? `${input.prompt}\n\n[${input.jsonOutputFeedback}]`
      : input.prompt;
    const harnessRunOptions = buildAgentHarnessRunOptions({
      step,
      metadata,
      agentConfig,
      resolvedHarness,
      resolvedModel,
      prompt,
      systemPrompt,
      abortController: attemptAbortController,
      ...(trackedMessage !== undefined ? { onMessage: trackedMessage } : {}),
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      ...(input.persistContinuationSession === true
        ? { persistContinuationSession: true }
        : {}),
    });
    const workflowHarnessRunner = createWorkflowAgentHarnessRunner(
      agentConfig.onProcessSpawn,
      agentConfig.agentBackoff,
      agentConfig.scopeId,
    );
    const runHarness = () => workflowHarnessRunner(
      resolvedHarness,
      harnessRunOptions.options,
      {
        signal: attemptAbortController.signal,
        writer: { write: () => true },
      },
    );
    const stopContinuationEvidenceMonitor = startContinuationEvidenceMonitor({
      poll: input.pollContinuationEvidence,
      abortController: attemptAbortController,
      log: agentConfig.log,
    });
    const harnessRun = agentConfig.delegateBudget
      ? withHandoffAgentRuntime(
          {
            scopeRoot: agentConfig.scopeRoot,
            cwd: agentConfig.workspaceRoot ?? agentConfig.scopeRoot,
            harness: resolvedHarness.name,
            resolveAgentDef: agentConfig.resolveAgentDef ?? (() => undefined),
            ...(agentConfig.runtimeResources !== undefined
              ? { env: agentConfig.runtimeResources.env }
              : {}),
            ...(agentConfig.resolveSkillsPrompt !== undefined
              ? { resolveSkillsPrompt: agentConfig.resolveSkillsPrompt }
              : {}),
            ...(agentConfig.config?.modelOutputTokenLimits !== undefined
              ? { modelOutputTokenLimits: agentConfig.config.modelOutputTokenLimits }
              : {}),
            ...(harnessRunOptions.modelProvider !== undefined
              ? { modelProvider: harnessRunOptions.modelProvider }
              : {}),
            delegateBudget: agentConfig.delegateBudget,
            autonomyMode: harnessRunOptions.options.autonomyMode ?? step.autonomyMode,
            canUseTool: harnessRunOptions.canUseTool,
            ...(harnessRunOptions.options.workflowContext !== undefined
              ? {
                  scopeId: harnessRunOptions.options.workflowContext.scopeId,
                }
              : {}),
            ...(harnessRunOptions.options.scopePolicy !== undefined
              ? { scopePolicy: harnessRunOptions.options.scopePolicy }
              : {}),
            ...(harnessRunOptions.options.scopePolicyAuthority !== undefined
              ? {
                  scopePolicyAuthority:
                    harnessRunOptions.options.scopePolicyAuthority,
                }
              : {}),
            ...(harnessRunOptions.options.getScopePolicySnapshot !== undefined
              ? {
                  getScopePolicySnapshot:
                    harnessRunOptions.options.getScopePolicySnapshot,
                }
              : {}),
            ...(harnessRunOptions.options.authorityConfigPath !== undefined
              ? {
                  authorityConfigPath:
                    harnessRunOptions.options.authorityConfigPath,
                }
              : {}),
            ...(harnessRunOptions.options.approvalQueue !== undefined
              ? { approvalQueue: harnessRunOptions.options.approvalQueue }
              : {}),
            ...(harnessRunOptions.options.guardrailsConfig !== undefined
              ? {
                  guardrailsConfig:
                    harnessRunOptions.options.guardrailsConfig,
                }
              : {}),
            ...(harnessRunOptions.options.idempotencyStore !== undefined
              ? {
                  idempotencyStore:
                    harnessRunOptions.options.idempotencyStore,
                }
              : {}),
            ...(harnessRunOptions.askOwner !== undefined
              ? { askOwner: harnessRunOptions.askOwner }
              : {}),
            ...(tokenBudget !== undefined ? { tokenBudget } : {}),
          },
          runHarness,
        )
      : runHarness();
    idleMonitor = createAgentStepIdleMonitor(step, attemptAbortController);
    let result: AgentHarnessResult;
    try {
      result = await waitForAgentHarnessWithIdleMonitor(harnessRun, idleMonitor);
    } finally {
      stopContinuationEvidenceMonitor();
    }
    if (result.sessionId !== undefined) input.onSessionId(result.sessionId);
    const reason = result.subtype ?? "error";
    const detail = result.text.trim() ||
      (result.isError
        ? "Agent step returned an error result"
        : "Agent step returned successful empty output");
    const classified = classifyAgentRuntimeFailure({
      message: detail,
      subtype: result.subtype,
    });
    if (
      result.isError ||
      (classified?.kind === "output_contract" &&
        input.jsonOutputFeedback !== undefined)
    ) {
      if (classified) {
        throw new AgentStepRuntimeError(
          `Agent step "${step.id}" failed (${reason}): ${detail}`,
          classified.kind,
          false,
          classified.retryAt,
          result.sessionId,
        );
      }
      throw new Error(`Agent step "${step.id}" failed (${reason}): ${detail}`);
    }
    if (step.outputFormat === "json") {
      try {
        const output = parseJsonAgentStepOutput(step, result.text);
        const validated = validateAgentStepOutput(
          step,
          output,
          input.outputValidationContext,
        );
        input.onSuccessfulAttemptMessages(attemptMessages);
        return validated;
      } catch (err) {
        const feedback = err instanceof Error ? jsonAgentOutputFeedback(err) : undefined;
        if (feedback !== undefined) input.onJsonOutputFeedback(feedback);
        throw err;
      }
    }
    const output = workflowOutputFromHarnessResult(result);
    const validated = validateAgentStepOutput(
      step,
      output,
      input.outputValidationContext,
    );
    input.onSuccessfulAttemptMessages(attemptMessages);
    return validated;
  } catch (error) {
    if (error instanceof AgentBackoffAdmissionError) throw error;
    if (
      attemptAbortController.signal.reason instanceof AgentBackoffAdmissionError
    ) {
      throw attemptAbortController.signal.reason;
    }
    if (error instanceof AgentStepIdleTimeoutError) throw error;
    if (attemptAbortController.signal.reason instanceof AgentStepIdleTimeoutError) {
      throw attemptAbortController.signal.reason;
    }
    if (abortController.signal.aborted) {
      throw abortController.signal.reason instanceof Error
        ? abortController.signal.reason
        : error;
    }
    if (
      attemptAbortController.signal.reason instanceof
        WorkflowContinuationCheckpointRequest
    ) {
      throw attemptAbortController.signal.reason;
    }
    if (
      error instanceof AgentStepRuntimeError ||
      error instanceof JsonOutputValidationError ||
      (error instanceof Error && error.name === "AbortError")
    ) throw error;
    const classified = classifyThrownAgentError(error);
    if (!classified) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentStepRuntimeError(
      `Agent step "${step.id}" failed: ${detail}`,
      classified.kind,
      classified.retryable,
      classified.retryAt,
    );
  } finally {
    idleMonitor?.dispose();
    invalidation.dispose();
  }
}
