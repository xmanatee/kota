import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  type AgentCanUseTool,
  composeCanUseTools,
  createWorkflowAgentGuards,
  type KotaAgentMessage,
  resolveAgentHarness,
  routeKotaToolControlOptions,
  runAgentHarness,
  type TrajectoryDiagnosticsMetadata,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import { buildKotaSystemPrompt } from "#core/loop/system-prompt.js";
import type { ToolResult } from "#core/tools/index.js";
import { ToolTelemetry } from "#core/tools/tool-telemetry.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import {
  AgentStepIdleTimeoutError,
  createStepIdleTimeoutMonitor,
  isAgentProgressMessage,
} from "../step-idle-timeout.js";
import { WorkflowStepOutputValidationError } from "../step-input-code.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";
import type { AgentRunLimiter } from "./agent-run-limiter.js";
import {
  AgentWriteScopeViolationError,
  diffMutatedPaths,
  findWriteScopeViolations,
  listWorkflowMutatedPaths,
  tryListWorkflowMutatedPaths,
  writeWriteScopeViolationArtifact,
} from "./agent-write-scope.js";
import { writeHarnessCapabilityArtifact } from "./step-executor-agent-capability.js";
import {
  extractJsonOutput,
  JsonOutputParseError,
  JsonOutputValidationError,
  JsonSchemaValidationError,
} from "./step-executor-agent-json.js";
import { buildAgentPrompt } from "./step-executor-agent-prompt.js";
import {
  makeToolTelemetryTracker,
  writeToolTelemetryArtifact,
} from "./step-executor-agent-telemetry.js";
import { resolveAgentToolScope } from "./step-executor-agent-tool-scope.js";
import { writeAgentTrajectoryDiagnosticsArtifact } from "./step-executor-agent-trajectory-diagnostics.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  classifyThrownAgentError,
  DEFAULT_AGENT_STEP_RETRY,
  withRetry,
} from "./step-executor-retry.js";

export type WorkflowStepOutput =
  | ToolResult
  | { content: string; sessionId?: string; turns?: number; totalCostUsd?: number; inputTokens?: number; outputTokens?: number; subtype?: string }
  | Record<string, unknown>
  | string | number | boolean | null | undefined;

export type AgentStepResult = {
  output: WorkflowStepOutput;
  harness: string;
  model: string;
  trajectoryDiagnostics: TrajectoryDiagnosticsMetadata;
  trajectoryMessages: readonly KotaAgentMessage[];
  preStepMutatedPaths: readonly string[];
};

export type AgentStepConfig = {
  model?: string;
  config?: KotaConfig;
  projectDir: string;
  log?: (message: string) => void;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  createCanUseTool?: (stepId: string) => AgentCanUseTool;
  agentRunLimiter?: AgentRunLimiter;
};

export {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  DEFAULT_AGENT_STEP_RETRY,
  withRetry,
};

export function resolveAgentModel(step: WorkflowAgentStep, agentConfig: AgentStepConfig): string {
  return (step.agentName ? agentConfig.config?.agentModels?.[step.agentName] : undefined) ?? step.model;
}

function validateAgentStepOutput(
  step: WorkflowAgentStep,
  output: WorkflowStepOutput,
): WorkflowStepOutput {
  if (step.validate === undefined) return output;
  try {
    return step.validate(output) as WorkflowStepOutput;
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new WorkflowStepOutputValidationError(step.id, "run", cause);
  }
}

// Walk closer-scoped `.kota.md`/`AGENTS.md`/`CLAUDE.md` from the prompt
// directory when it lives under the project; otherwise fall back to the
// project root so external module guidance does not leak into discovery.
export function resolvePromptContextStartDir(promptDir: string, projectDir: string): string {
  const rel = relative(projectDir, promptDir);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return promptDir;
  return projectDir;
}

export async function executeAgentStep(
  definition: WorkflowDefinition,
  step: WorkflowAgentStep,
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  abortController: AbortController,
  appendMessage: (message: KotaAgentMessage) => void,
  writeInputs: (systemPromptAppend: string | undefined, prompt: string) => void,
  agentConfig: AgentStepConfig,
  priorStepOutputs: Record<string, unknown> = {},
): Promise<AgentStepResult> {
  const resolvedHarness = resolveAgentHarness(step.harness);
  const resolvedModel = resolveAgentModel(step, agentConfig);
  writeHarnessCapabilityArtifact(step.id, metadata, agentConfig.projectDir, resolvedHarness);

  const agentPrompt = buildAgentPrompt(
    definition,
    step,
    metadata,
    trigger,
    agentConfig.projectDir,
    priorStepOutputs,
    resolvedHarness.askOwnerToolName,
  );
  const promptDir = dirname(resolve(step.moduleRoot, step.promptPath));
  const contextStartDir = resolvePromptContextStartDir(promptDir, agentConfig.projectDir);

  const agentDef = step.agentName && agentConfig.resolveAgentDef
    ? agentConfig.resolveAgentDef(step.agentName)
    : undefined;
  const scopedAgent = agentDef && step.agentName
    ? { agentName: step.agentName, writeScope: agentDef.writeScope }
    : undefined;
  const skillsPrompt = agentDef?.skills && agentConfig.resolveSkillsPrompt
    ? agentConfig.resolveSkillsPrompt(agentDef.skills, step.agentName)
    : undefined;

  const systemPrompt = buildKotaSystemPrompt(
    agentConfig.config,
    agentPrompt.systemPromptAppend,
    contextStartDir,
    agentConfig.projectDir,
    skillsPrompt,
  );
  writeInputs(systemPrompt, agentPrompt.prompt);

  // Telemetry tracking and caller message capture both ride `onMessage`,
  // which only stream-capable harnesses emit; non-stream harnesses reject it.
  const stepTelemetry = new ToolTelemetry();

  // Snapshot before run so post-step writeScope diff excludes paths another
  // step or pre-existing dirt mutated.
  const preStepMutatedPaths = scopedAgent
    ? listWorkflowMutatedPaths(agentConfig.projectDir)
    : (tryListWorkflowMutatedPaths(agentConfig.projectDir) ?? []);
  const bufferAgentMessages = step.validate !== undefined;
  let successfulAttemptMessages: KotaAgentMessage[] = [];
  let lastJsonOutputFeedback: string | undefined;

  const runAttempt = async (): Promise<WorkflowStepOutput> => {
    const attemptMessages: KotaAgentMessage[] = [];
    const attemptAbortController = new AbortController();
    const forwardAbort = () => attemptAbortController.abort(abortController.signal.reason);
    abortController.signal.addEventListener("abort", forwardAbort, { once: true });
    let idleMonitor: ReturnType<typeof createStepIdleTimeoutMonitor> | undefined;
    const captureMessage = (message: KotaAgentMessage) => {
      attemptMessages.push(message);
      if (idleMonitor !== undefined && isAgentProgressMessage(message)) {
        idleMonitor.reportProgress({
          kind: "agent-message",
          messageType: message.type,
        });
      }
      if (bufferAgentMessages) {
        return;
      }
      appendMessage(message);
    };
    const trackedMessage = resolvedHarness.emitsAgentMessageStream
      ? makeToolTelemetryTracker(stepTelemetry, captureMessage)
      : undefined;

    const prompt = lastJsonOutputFeedback
      ? `${agentPrompt.prompt}\n\n[${lastJsonOutputFeedback}]`
      : agentPrompt.prompt;
    const harnessOverrides = step.harnessOptions?.[resolvedHarness.name];
    const toolScope = resolveAgentToolScope(
      step.autonomyMode,
      step.allowedTools,
      step.disallowedTools,
      resolvedHarness.askOwnerToolName,
    );
    const trialCanUseTool = agentConfig.createCanUseTool?.(step.id);
    const canUseTool = trialCanUseTool
      ? composeCanUseTools(trialCanUseTool, createWorkflowAgentGuards())
      : createWorkflowAgentGuards();
    try {
      const harnessRun = runAgentHarness(
        resolvedHarness,
        {
          prompt, model: resolvedModel, cwd: agentConfig.projectDir, systemPrompt,
          modelOutputTokenLimits: agentConfig.config?.modelOutputTokenLimits,
          maxTurns: step.maxTurns, effort: step.effort,
          thinkingEnabled: step.thinkingEnabled, thinkingBudget: step.thinkingBudget,
          ...routeKotaToolControlOptions(resolvedHarness, {
            allowedTools: toolScope.allowedTools,
            disallowedTools: toolScope.disallowedTools,
            canUseTool,
          }),
          askOwner: resolvedHarness.askOwnerToolName !== null
            ? { source: `workflow:${metadata.workflow}/${metadata.id}/${step.id}` }
            : undefined,
          autonomyMode: step.autonomyMode, harnessOverrides, abortController: attemptAbortController,
          ...(trackedMessage !== undefined ? { onMessage: trackedMessage } : {}),
        },
        { write: () => true },
      );
      const idleTimeoutMs = step.idleTimeoutMs;
      idleMonitor = idleTimeoutMs === undefined
        ? undefined
        : createStepIdleTimeoutMonitor({
            stepId: step.id,
            idleTimeoutMs,
            abortController: attemptAbortController,
            createError: (idleForMs) =>
              new AgentStepIdleTimeoutError(
                step.id,
                idleTimeoutMs,
                idleForMs,
              ),
          });
      const result = await (idleMonitor === undefined
        ? harnessRun
        : Promise.race([harnessRun, idleMonitor.timeout]));
      idleMonitor?.reportProgress({ kind: "agent-result" });
      if (result.isError) {
        const reason = result.subtype ?? "error";
        const detail = result.text.trim() || "Agent step returned an error result";
        const classified = classifyAgentRuntimeFailure({ message: detail, subtype: result.subtype });
        // SDK has exhausted retries on isError; mark non-retryable so
        // AgentBackoffManager applies a provider-kind delay instead of re-spawning.
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
          const output = extractJsonOutput(step.id, result.text, step.outputSchema) as WorkflowStepOutput;
          const validated = validateAgentStepOutput(step, output);
          successfulAttemptMessages = attemptMessages;
          return validated;
        } catch (err) {
          if (err instanceof JsonSchemaValidationError) {
            lastJsonOutputFeedback = `Previous output failed schema validation: ${err.validationDetail}\nPlease include all required fields in your JSON block and try again.`;
          } else if (err instanceof JsonOutputParseError) {
            lastJsonOutputFeedback = `Previous JSON output was invalid: ${err.validationDetail}\nEnd with one fenced valid JSON block that matches the requested schema, then try again.`;
          }
          throw err;
        }
      }
      const output = {
        content: result.text, sessionId: result.sessionId, turns: result.turns,
        totalCostUsd: result.totalCostUsd, inputTokens: result.inputTokens,
        outputTokens: result.outputTokens, subtype: result.subtype,
      };
      const validated = validateAgentStepOutput(step, output);
      successfulAttemptMessages = attemptMessages;
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
  };

  const retry = step.retry ?? DEFAULT_AGENT_STEP_RETRY;
  const runWithRetry = () => withRetry(runAttempt, retry, {
    log: agentConfig.log,
    abortSignal: abortController.signal,
    // Only consume retry attempts for classified-transient failures. Max-turn,
    // logic, and malformed-tool errors fail hard on the first attempt.
    shouldRetry: (err) =>
      err instanceof JsonSchemaValidationError ||
      err instanceof JsonOutputParseError ||
      (err instanceof AgentStepRuntimeError && err.retryable),
  });
  const output = agentConfig.agentRunLimiter
    ? await agentConfig.agentRunLimiter.run(runWithRetry, abortController.signal)
    : await runWithRetry();

  if (bufferAgentMessages) {
    for (const message of successfulAttemptMessages) appendMessage(message);
  }

  if (resolvedHarness.emitsAgentMessageStream) {
    writeToolTelemetryArtifact(step.id, metadata, agentConfig.projectDir, stepTelemetry);
  }

  const postStepMutatedPaths = scopedAgent
    ? listWorkflowMutatedPaths(agentConfig.projectDir)
    : (tryListWorkflowMutatedPaths(agentConfig.projectDir) ?? []);
  const stepMutatedPaths = diffMutatedPaths(
    preStepMutatedPaths,
    postStepMutatedPaths,
  );
  const trajectoryDiagnostics = writeAgentTrajectoryDiagnosticsArtifact({
    stepId: step.id,
    runDir: metadata.runDir,
    projectDir: agentConfig.projectDir,
    harness: resolvedHarness,
    messages: successfulAttemptMessages,
    changedFiles: stepMutatedPaths,
  });

  // Whole-step writeScope contract: pre/post diff so concurrent or prior-step
  // writes do not contaminate attribution; out-of-scope writes fail the step.
  if (scopedAgent) {
    const violations = findWriteScopeViolations(
      stepMutatedPaths,
      scopedAgent.writeScope,
    );
    if (violations.length > 0) {
      const violationCtx = {
        stepId: step.id,
        agentName: scopedAgent.agentName,
        scope: scopedAgent.writeScope,
        violations,
      };
      writeWriteScopeViolationArtifact({ ...violationCtx, metadata, projectDir: agentConfig.projectDir });
      throw new AgentWriteScopeViolationError(violationCtx);
    }
  }

  return {
    output,
    harness: resolvedHarness.name,
    model: resolvedModel,
    trajectoryDiagnostics,
    trajectoryMessages: successfulAttemptMessages,
    preStepMutatedPaths,
  };
}
