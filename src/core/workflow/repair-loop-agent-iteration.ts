import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createNativeAgentInvalidationLifecycle,
} from "#core/agent-harness/index.js";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { buildKotaSystemPrompt } from "#core/loop/system-prompt.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "./run-types.js";
import {
  AgentStepIdleTimeoutError,
  createStepIdleTimeoutMonitor,
  isAgentProgressMessage,
} from "./step-idle-timeout.js";
import type { WorkflowAgentStep } from "./step-types.js";
import type { AgentStepConfig, AgentStepResult } from "./steps/step-executor-agent.js";
import {
  resolveAgentModel,
  resolvePromptContextStartDir,
} from "./steps/step-executor-agent.js";
import { buildAgentHarnessRunOptions } from "./steps/step-executor-agent-run-options.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
} from "./steps/step-executor-retry.js";

export type RepairAgentIterationResult = {
  text: string;
  turns?: number;
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
};

export class RepairAgentIterationError extends Error {
  constructor(
    readonly result: RepairAgentIterationResult,
    readonly agentBackoff: AgentStepRuntimeError | undefined,
    message: string,
  ) {
    super(message);
    this.name = "RepairAgentIterationError";
  }
}

export async function executeRepairAgentIteration(
  step: WorkflowAgentStep,
  repairPrompt: string,
  context: WorkflowStepContext,
  metadata: WorkflowRunMetadata,
  abortController: AbortController,
  appendMessage: (message: KotaAgentMessage) => void,
  agentConfig: AgentStepConfig,
  tokenBudget: AgentStepResult["tokenBudget"],
  resumeSessionId?: string,
): Promise<RepairAgentIterationResult> {
  const promptBody = readFileSync(
    resolve(step.moduleRoot, step.promptPath),
    "utf-8",
  );
  const promptDir = dirname(resolve(step.moduleRoot, step.promptPath));
  const contextStartDir = resolvePromptContextStartDir(promptDir, agentConfig.scopeRoot);
  const systemPrompt = buildKotaSystemPrompt(
    agentConfig.config,
    promptBody,
    contextStartDir,
    agentConfig.scopeRoot,
  );
  const harness = agentConfig.resolveAgentHarness?.(step.harness);
  if (harness === undefined) {
    throw new Error(`Repair iteration has no harness resolver for "${step.harness}"`);
  }
  const repairSessionId = harness.unsupportedRunOptions?.some(
    (entry) => entry.runOption === "resumeSessionId",
  )
    ? undefined
    : resumeSessionId;
  const workspaceDir = agentConfig.workspaceRoot ?? agentConfig.scopeRoot;
  const scopedAgent = step.agentName && agentConfig.resolveAgentDef
    ? agentConfig.resolveAgentDef(step.agentName)
    : undefined;

  const runRepairHarness = async () => {
    const invalidation = createNativeAgentInvalidationLifecycle({
      executionLabel: `Agent step "${step.id}"`,
      parentSignal: abortController.signal,
      ...(harness.toolControl === "native"
        ? {
            scopeId: agentConfig.scopeId,
            authority: agentConfig.scopePolicyAuthority,
            initialSnapshot: agentConfig.scopePolicySnapshot,
          }
        : {}),
    });
    const attemptAbortController = invalidation.abortController;
    let idleMonitor: ReturnType<typeof createStepIdleTimeoutMonitor> | undefined;
    try {
      const messageCapture = harness.emitsAgentMessageStream
        ? (message: KotaAgentMessage) => {
            if (idleMonitor !== undefined && isAgentProgressMessage(message)) {
              idleMonitor.reportProgress({
                kind: "agent-message",
                messageType: message.type,
              });
            }
            appendMessage(message);
          }
        : undefined;
      const { options: baseOptions } = buildAgentHarnessRunOptions({
        step,
        metadata,
        agentConfig,
        resolvedHarness: harness,
        resolvedModel: resolveAgentModel(step, agentConfig),
        prompt: repairPrompt,
        systemPrompt,
        abortController: attemptAbortController,
        ...(messageCapture !== undefined ? { onMessage: messageCapture } : {}),
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      });
      const options = {
        ...baseOptions,
        ...(repairSessionId === undefined ? {} : { resumeSessionId: repairSessionId }),
      };
      if (attemptAbortController.signal.aborted) {
        throw attemptAbortController.signal.reason instanceof Error
          ? attemptAbortController.signal.reason
          : new Error(`Repair agent for step "${step.id}" aborted`);
      }
      const harnessRun = context.runAgentHarness(
        harness,
        options,
        {
          signal: attemptAbortController.signal,
          ...(scopedAgent ? { workspaceKey: workspaceDir } : {}),
          writer: { write: () => true },
        },
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
      return result;
    } catch (error) {
      if (error instanceof AgentStepIdleTimeoutError) throw error;
      if (attemptAbortController.signal.reason instanceof AgentStepIdleTimeoutError) {
        throw attemptAbortController.signal.reason;
      }
      throw error;
    } finally {
      idleMonitor?.dispose();
      invalidation.dispose();
    }
  };

  const result = await runRepairHarness();

  const iterationResult: RepairAgentIterationResult = {
    text: result.text,
    turns: result.turns,
    totalCostUsd: result.totalCostUsd,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    sessionId: result.sessionId,
  };

  if (result.isError) {
    const detail = result.text.trim() || "Repair agent returned an error";
    const classified = classifyAgentRuntimeFailure({
      message: detail,
      subtype: result.subtype,
    });
    const message = `Repair agent for step "${step.id}" failed: ${detail}`;
    const agentBackoff = classified
      ? new AgentStepRuntimeError(
        message,
        classified.kind,
        false,
        classified.retryAt,
      )
      : undefined;
    throw new RepairAgentIterationError(
      iterationResult,
      agentBackoff,
      message,
    );
  }
  return iterationResult;
}
