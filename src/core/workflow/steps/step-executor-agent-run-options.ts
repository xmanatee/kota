import { mkdirSync } from "node:fs";
import {
  type AgentAskOwnerOptions,
  type AgentCanUseTool,
  type AgentHarness,
  type AgentHarnessRunOptions,
  type AgentTokenBudgetLedger,
  composeCanUseTools,
  createWorkflowAgentGuards,
  type KotaAgentMessage,
} from "#core/agent-harness/index.js";
import { capScopeAutonomyMode } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ModelProviderSelection } from "#core/model/model-client.js";
import { resolveAgentRunDir } from "../agent-run-dir.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { AgentStepConfig } from "./step-executor-agent.js";
import { resolveWorkflowAgentRunContract } from "./step-executor-agent-run-contract.js";

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
  const workspaceDir = agentConfig.workspaceDir ?? agentConfig.projectDir;
  const agentWriteScope = step.agentName === undefined
    ? undefined
    : agentConfig.resolveAgentDef?.(step.agentName)?.writeScope;
  const agentOutputDir = resolveAgentRunDir({
    metadata,
    projectDir: agentConfig.projectDir,
    ...(agentConfig.runtimeResources === undefined
      ? {}
      : { runtimeResources: agentConfig.runtimeResources }),
  });
  mkdirSync(agentOutputDir, { recursive: true });
  const scopeId = agentConfig.scopeId ?? deriveDirectoryScopeId(agentConfig.projectDir);
  const projectId = agentConfig.projectId ?? scopeId;
  const scopePolicyAuthority = agentConfig.scopePolicyAuthority;
  const getScopePolicySnapshot = scopePolicyAuthority === undefined
    ? undefined
    : () => scopePolicyAuthority.getSnapshot(scopeId);
  const trialCanUseTool = agentConfig.createCanUseTool?.(step.id);
  const workflowGuards = createWorkflowAgentGuards(agentConfig.authorityConfigPath);
  const canUseTool = trialCanUseTool
    ? composeCanUseTools(trialCanUseTool, workflowGuards)
    : workflowGuards;
  const contract = resolveWorkflowAgentRunContract({
    step,
    harness: resolvedHarness,
    model: resolvedModel,
    prompt,
    canUseTool,
    askOwnerSource: `workflow:${metadata.workflow}/${metadata.id}/${step.id}`,
    // Definitions already validated the static model id. Launch repeats the
    // run-option capability assertion without turning runtime readiness into a
    // second definition compiler.
    validateModel: false,
    autonomyMode: agentConfig.scopePolicy
      ? capScopeAutonomyMode(step.autonomyMode, agentConfig.scopePolicy)
      : step.autonomyMode,
    ...(onMessage !== undefined ? { onMessage } : {}),
    ...(agentConfig.scopePolicy !== undefined
      ? { scopePolicy: agentConfig.scopePolicy }
      : {}),
    ...(scopePolicyAuthority !== undefined ? { scopePolicyAuthority } : {}),
    ...(getScopePolicySnapshot !== undefined ? { getScopePolicySnapshot } : {}),
  });
  const askOwner = contract.askOwner;
  const modelProvider = modelProviderSelection(agentConfig.config);

  return {
    options: {
      ...contract.options,
      cwd: workspaceDir,
      ...(agentWriteScope !== undefined ? { agentWriteScope } : {}),
      agentOutputDir,
      ...(agentConfig.authorityConfigPath !== undefined
        ? { authorityConfigPath: agentConfig.authorityConfigPath }
        : {}),
      ...(agentConfig.runtimeResources !== undefined
        ? { env: agentConfig.runtimeResources.env }
        : {}),
      systemPrompt,
      modelOutputTokenLimits: agentConfig.config?.modelOutputTokenLimits,
      ...(modelProvider !== undefined ? { modelProvider } : {}),
      ...(agentConfig.config?.guardrails !== undefined
        ? { guardrailsConfig: agentConfig.config.guardrails }
        : {}),
		...(agentConfig.approvalQueue !== undefined
			? { approvalQueue: agentConfig.approvalQueue }
			: {}),
      ...(agentConfig.idempotencyStore !== undefined
        ? { idempotencyStore: agentConfig.idempotencyStore }
        : {}),
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
    },
    canUseTool,
    askOwner,
    modelProvider,
  };
}
