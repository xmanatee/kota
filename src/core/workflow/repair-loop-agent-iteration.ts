import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  composeCanUseTools,
  createWorkflowAgentGuards,
  resolveAgentHarness,
  routeKotaToolControlOptions,
} from "#core/agent-harness/index.js";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { capScopeAutonomyMode } from "#core/daemon/scope-policy.js";
import { buildKotaSystemPrompt } from "#core/loop/system-prompt.js";
import type { WorkflowStepContext } from "./run-types.js";
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
import { subscribeAgentScopePolicyRestrictions } from "./steps/step-executor-agent-scope-policy.js";
import { resolveAgentToolScope } from "./steps/step-executor-agent-tool-scope.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
} from "./steps/step-executor-retry.js";

export type RepairAgentIterationResult = {
  text: string;
  turns?: number;
  totalCostUsd?: number;
};

export async function executeRepairAgentIteration(
  step: WorkflowAgentStep,
  repairPrompt: string,
  context: WorkflowStepContext,
  abortController: AbortController,
  appendMessage: (message: KotaAgentMessage) => void,
  agentConfig: AgentStepConfig,
  tokenBudget: AgentStepResult["tokenBudget"],
): Promise<RepairAgentIterationResult> {
  const promptBody = readFileSync(
    resolve(step.moduleRoot, step.promptPath),
    "utf-8",
  );
  const promptDir = dirname(resolve(step.moduleRoot, step.promptPath));
  const contextStartDir = resolvePromptContextStartDir(promptDir, agentConfig.projectDir);
  const systemPrompt = buildKotaSystemPrompt(
    agentConfig.config,
    promptBody,
    contextStartDir,
    agentConfig.projectDir,
  );
  const harness = resolveAgentHarness(step.harness);
  const harnessOverrides = step.harnessOptions?.[harness.name];
  const autonomyMode = agentConfig.scopePolicy
    ? capScopeAutonomyMode(step.autonomyMode, agentConfig.scopePolicy)
    : step.autonomyMode;
  const toolScope = resolveAgentToolScope(
    autonomyMode,
    step.allowedTools,
    step.disallowedTools,
    harness.askOwnerToolName,
  );
  const trialCanUseTool = agentConfig.createCanUseTool?.(step.id);
  const workflowGuards = createWorkflowAgentGuards(agentConfig.authorityConfigPath);
  const canUseTool = trialCanUseTool
    ? composeCanUseTools(trialCanUseTool, workflowGuards)
    : workflowGuards;
  const modelProvider = agentConfig.config?.modelProvider === undefined
    ? undefined
    : {
        provider: agentConfig.config.modelProvider.type,
        baseUrl: agentConfig.config.modelProvider.baseUrl,
        apiKey: agentConfig.config.modelProvider.apiKey,
      };
  const workspaceDir = agentConfig.workspaceDir ?? agentConfig.projectDir;
  const scopedAgent = step.agentName && agentConfig.resolveAgentDef
    ? agentConfig.resolveAgentDef(step.agentName)
    : undefined;

  const runRepairHarness = async () => {
    const attemptAbortController = new AbortController();
    const forwardAbort = () => attemptAbortController.abort(abortController.signal.reason);
    if (abortController.signal.aborted) {
      attemptAbortController.abort(abortController.signal.reason);
    } else {
      abortController.signal.addEventListener("abort", forwardAbort, { once: true });
    }
    let idleMonitor: ReturnType<typeof createStepIdleTimeoutMonitor> | undefined;
    let unsubscribeScopePolicy = () => {};
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

    try {
      unsubscribeScopePolicy = subscribeAgentScopePolicyRestrictions({
        stepId: step.id,
        scopeId: agentConfig.scopeId,
        authority: agentConfig.scopePolicyAuthority,
        initialSnapshot: agentConfig.scopePolicySnapshot,
        abortController: attemptAbortController,
      });
      if (attemptAbortController.signal.aborted) {
        throw attemptAbortController.signal.reason instanceof Error
          ? attemptAbortController.signal.reason
          : new Error(`Repair agent for step "${step.id}" aborted`);
      }
      const harnessRun = context.runAgentHarness(
        harness,
        {
          prompt: repairPrompt,
          model: resolveAgentModel(step, agentConfig),
          cwd: agentConfig.workspaceDir ?? agentConfig.projectDir,
          systemPrompt,
          modelOutputTokenLimits: agentConfig.config?.modelOutputTokenLimits,
          ...(modelProvider !== undefined ? { modelProvider } : {}),
          maxTurns: step.maxTurns,
          effort: step.effort,
          thinkingEnabled: step.thinkingEnabled,
          thinkingBudget: step.thinkingBudget,
          ...(agentConfig.runtimeResources !== undefined
            ? { env: agentConfig.runtimeResources.env }
            : {}),
          ...routeKotaToolControlOptions(harness, {
            allowedTools: toolScope.allowedTools,
            disallowedTools: toolScope.disallowedTools,
            canUseTool,
            scopePolicy: agentConfig.scopePolicy,
          }),
          askOwner: harness.askOwnerToolName !== null
            ? { source: `workflow:${context.workflow.name}/${context.workflow.runId}/${step.id}` }
            : undefined,
          autonomyMode,
          harnessOverrides,
          ...(tokenBudget !== undefined ? { tokenBudget } : {}),
          ...(messageCapture !== undefined ? { onMessage: messageCapture } : {}),
        },
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
      unsubscribeScopePolicy();
      abortController.signal.removeEventListener("abort", forwardAbort);
    }
  };

  const result = await runRepairHarness();

  if (result.isError) {
    const detail = result.text.trim() || "Repair agent returned an error";
    const classified = classifyAgentRuntimeFailure({
      message: detail,
      subtype: result.subtype,
    });
    if (classified) {
      throw new AgentStepRuntimeError(
        `Repair agent for step "${step.id}" failed: ${detail}`,
        classified.kind,
        false,
      );
    }
    throw new Error(`Repair agent for step "${step.id}" failed: ${detail}`);
  }
  return { text: result.text, turns: result.turns, totalCostUsd: result.totalCostUsd };
}
