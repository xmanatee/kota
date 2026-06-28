import {
  type AgentHarness,
  type AgentTokenBudgetLedger,
  type KotaAgentMessage,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import { withHandoffAgentRuntime } from "#core/tools/handoff-agent-runtime.js";
import type { ToolTelemetry } from "#core/tools/tool-telemetry.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import { AgentStepIdleTimeoutError } from "../step-idle-timeout.js";
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
  const attemptAbortController = new AbortController();
  const forwardAbort = () => attemptAbortController.abort(abortController.signal.reason);
  abortController.signal.addEventListener("abort", forwardAbort, { once: true });
  let idleMonitor: AgentStepIdleMonitor | undefined;
  const captureMessage = createAgentAttemptMessageCapture({
    messages: attemptMessages,
    idleMonitor: () => idleMonitor,
    bufferAgentMessages,
    appendMessage,
  });
  const trackedMessage = resolvedHarness.emitsAgentMessageStream
    ? makeToolTelemetryTracker(stepTelemetry, captureMessage)
    : undefined;

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
  });

  try {
    const runHarness = () =>
      runAgentHarness(resolvedHarness, harnessRunOptions.options, { write: () => true });
    const harnessRun = agentConfig.delegateBudget
      ? withHandoffAgentRuntime(
          {
            cwd: agentConfig.workspaceDir ?? agentConfig.projectDir,
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
            canUseTool: harnessRunOptions.canUseTool,
            ...(harnessRunOptions.askOwner !== undefined
              ? { askOwner: harnessRunOptions.askOwner }
              : {}),
            ...(tokenBudget !== undefined ? { tokenBudget } : {}),
          },
          runHarness,
        )
      : runHarness();
    idleMonitor = createAgentStepIdleMonitor(step, attemptAbortController);
    const result = await waitForAgentHarnessWithIdleMonitor(harnessRun, idleMonitor);
    if (result.isError) {
      const reason = result.subtype ?? "error";
      const detail = result.text.trim() || "Agent step returned an error result";
      const classified = classifyAgentRuntimeFailure({ message: detail, subtype: result.subtype });
      if (classified) {
        throw new AgentStepRuntimeError(
          `Agent step "${step.id}" failed (${reason}): ${detail}`,
          classified.kind,
          false,
        );
      }
      throw new Error(`Agent step "${step.id}" failed (${reason}): ${detail}`);
    }
    if (step.outputFormat === "json") {
      try {
        const output = parseJsonAgentStepOutput(step, result.text);
        const validated = validateAgentStepOutput(step, output);
        input.onSuccessfulAttemptMessages(attemptMessages);
        return validated;
      } catch (err) {
        const feedback = err instanceof Error ? jsonAgentOutputFeedback(err) : undefined;
        if (feedback !== undefined) input.onJsonOutputFeedback(feedback);
        throw err;
      }
    }
    const output = workflowOutputFromHarnessResult(result);
    const validated = validateAgentStepOutput(step, output);
    input.onSuccessfulAttemptMessages(attemptMessages);
    return validated;
  } catch (error) {
    if (error instanceof AgentStepIdleTimeoutError) throw error;
    if (attemptAbortController.signal.reason instanceof AgentStepIdleTimeoutError) {
      throw attemptAbortController.signal.reason;
    }
    if (
      error instanceof AgentStepRuntimeError ||
      error instanceof JsonOutputValidationError ||
      (error instanceof Error && error.name === "AbortError") ||
      abortController.signal.aborted
    ) throw error;
    const classified = classifyThrownAgentError(error);
    if (!classified) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentStepRuntimeError(
      `Agent step "${step.id}" failed: ${detail}`,
      classified.kind,
      classified.retryable,
    );
  } finally {
    idleMonitor?.dispose();
    abortController.signal.removeEventListener("abort", forwardAbort);
  }
}
