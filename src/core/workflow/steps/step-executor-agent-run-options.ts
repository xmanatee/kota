import {
  type AgentAskOwnerOptions,
  type AgentCanUseTool,
  type AgentHarness,
  type AgentHarnessRunOptions,
  type AgentTokenBudgetLedger,
  composeCanUseTools,
  createWorkflowAgentGuards,
  type KotaAgentMessage,
  routeKotaToolControlOptions,
} from "#core/agent-harness/index.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ModelProviderSelection } from "#core/model/model-client.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { AgentStepConfig } from "./step-executor-agent.js";
import { resolveAgentToolScope } from "./step-executor-agent-tool-scope.js";

export type AgentHarnessRunOptionBundle = {
  options: AgentHarnessRunOptions;
  canUseTool: AgentCanUseTool;
  askOwner?: AgentAskOwnerOptions;
  modelProvider?: ModelProviderSelection;
};

function modelProviderSelection(
  config: AgentStepConfig["config"],
): ModelProviderSelection | undefined {
  if (config?.modelProvider === undefined) return undefined;
  return {
    provider: config.modelProvider.type,
    baseUrl: config.modelProvider.baseUrl,
    apiKey: config.modelProvider.apiKey,
  };
}

export function buildAgentHarnessRunOptions(input: {
  step: WorkflowAgentStep;
  metadata: WorkflowRunMetadata;
  agentConfig: AgentStepConfig;
  resolvedHarness: AgentHarness;
  resolvedModel: string;
  prompt: string;
  systemPrompt: string | undefined;
  abortController: AbortController;
  onMessage?: (message: KotaAgentMessage) => void;
  tokenBudget?: AgentTokenBudgetLedger;
}): AgentHarnessRunOptionBundle {
  const {
    step,
    metadata,
    agentConfig,
    resolvedHarness,
    resolvedModel,
    prompt,
    systemPrompt,
    abortController,
    onMessage,
    tokenBudget,
  } = input;
  const harnessOverrides = step.harnessOptions?.[resolvedHarness.name];
  const workspaceDir = agentConfig.workspaceDir ?? agentConfig.projectDir;
  const scopeId = agentConfig.scopeId ?? deriveDirectoryScopeId(agentConfig.projectDir);
  const projectId = agentConfig.projectId ?? scopeId;
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
  const askOwner = resolvedHarness.askOwnerToolName !== null
    ? { source: `workflow:${metadata.workflow}/${metadata.id}/${step.id}` }
    : undefined;
  const modelProvider = modelProviderSelection(agentConfig.config);

  return {
    options: {
      prompt,
      model: resolvedModel,
      cwd: workspaceDir,
      ...(agentConfig.runtimeResources !== undefined
        ? { env: agentConfig.runtimeResources.env }
        : {}),
      systemPrompt,
      modelOutputTokenLimits: agentConfig.config?.modelOutputTokenLimits,
      ...(modelProvider !== undefined ? { modelProvider } : {}),
      maxTurns: step.maxTurns,
      effort: step.effort,
      thinkingEnabled: step.thinkingEnabled,
      thinkingBudget: step.thinkingBudget,
      ...routeKotaToolControlOptions(resolvedHarness, {
        allowedTools: toolScope.allowedTools,
        disallowedTools: toolScope.disallowedTools,
        canUseTool,
      }),
      ...(agentConfig.config?.guardrails !== undefined
        ? { guardrailsConfig: agentConfig.config.guardrails }
        : {}),
		...(agentConfig.approvalQueue !== undefined
			? { approvalQueue: agentConfig.approvalQueue }
			: {}),
      ...(agentConfig.idempotencyStore !== undefined
        ? { idempotencyStore: agentConfig.idempotencyStore }
        : {}),
      askOwner,
      autonomyMode: step.autonomyMode,
      harnessOverrides,
      abortController,
      workflowContext: {
        workflowName: metadata.workflow,
        runId: metadata.id,
        stepId: step.id,
        spanId: `${metadata.id}:${step.id}`,
        scopeId,
        projectId,
      },
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      ...(onMessage !== undefined ? { onMessage } : {}),
    },
    canUseTool,
    askOwner,
    modelProvider,
  };
}
