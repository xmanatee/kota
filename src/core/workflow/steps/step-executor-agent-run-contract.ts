import {
  type AgentAskOwnerOptions,
  type AgentCanUseTool,
  type AgentHarness,
  type AgentHarnessRunOptions,
  type KotaAgentMessage,
  routeKotaToolControlOptions,
} from "#core/agent-harness/index.js";
import { assertAdapterCanHostRequestedCapabilities } from "#core/agent-harness/run-option-routing.js";
import type { ResolvedScopePolicy, ScopePolicyAuthority } from "#core/daemon/scope-policy.js";
import type {
  WorkflowAgentRunContractSpec,
  WorkflowAgentStep,
} from "../step-types.js";
import { resolveAgentToolScope } from "./step-executor-agent-tool-scope.js";

export type WorkflowAgentRunContract = {
  options: AgentHarnessRunOptions;
  askOwner?: AgentAskOwnerOptions;
};

const STATIC_CAN_USE_TOOL: AgentCanUseTool = async (_toolName, input) => ({
  behavior: "allow",
  updatedInput: input,
});

const STATIC_ON_MESSAGE = (_message: KotaAgentMessage): void => undefined;

export function resolveWorkflowAgentModel(
  step: Pick<WorkflowAgentStep, "agentName" | "model">,
  agentModels: Readonly<Record<string, string>> | undefined,
): string {
  return (step.agentName ? agentModels?.[step.agentName] : undefined) ?? step.model;
}

/**
 * Resolve and assert the static portion of one workflow agent launch.
 *
 * Definition validation and execution both call this function. Runtime-only
 * state (credentials, provider reachability, runtime resources, and live scope
 * policy) is layered on by the executor and remains guarded by the identical
 * assertion in `runAgentHarness` immediately before adapter launch.
 */
export function resolveWorkflowAgentRunContract(input: {
  step: WorkflowAgentRunContractSpec;
  harness: AgentHarness;
  model: string;
  prompt: string;
  canUseTool: AgentCanUseTool;
  askOwnerSource: string;
  autonomyMode?: WorkflowAgentStep["autonomyMode"];
  onMessage?: (message: KotaAgentMessage) => void;
  scopePolicy?: ResolvedScopePolicy;
  scopePolicyAuthority?: ScopePolicyAuthority;
  getScopePolicySnapshot?: AgentHarnessRunOptions["getScopePolicySnapshot"];
  validateModel?: boolean;
}): WorkflowAgentRunContract {
  const {
    step,
    harness,
    model,
    prompt,
    canUseTool,
    askOwnerSource,
    onMessage,
    scopePolicy,
    scopePolicyAuthority,
    getScopePolicySnapshot,
  } = input;
  const autonomyMode = input.autonomyMode ?? step.autonomyMode;

  if (input.validateModel !== false) harness.validateModelId?.(model);

  if (harness.toolControl === "native") {
    const namedRestrictions = [
      ...(step.allowedTools !== undefined ? ["allowedTools"] : []),
      ...(step.disallowedTools !== undefined && step.disallowedTools.length > 0
        ? ["disallowedTools"]
        : []),
    ];
    if (namedRestrictions.length > 0) {
      throw new Error(
        `${namedRestrictions.join(", ")} selects native harness "${harness.name}", which cannot honor KOTA named tool restrictions.`,
      );
    }
  }

  const toolScope = resolveAgentToolScope(
    autonomyMode,
    step.allowedTools,
    step.disallowedTools,
    harness.askOwnerToolName,
  );
  const askOwner = step.ownerQuestionAccess !== "disabled" && harness.askOwnerToolName !== null
    ? { source: askOwnerSource }
    : undefined;
  const options: AgentHarnessRunOptions = {
    prompt,
    model,
    maxTurns: step.maxTurns,
    effort: step.effort,
    thinkingEnabled: step.thinkingEnabled,
    thinkingBudget: step.thinkingBudget,
    ...routeKotaToolControlOptions(harness, {
      allowedTools: toolScope.allowedTools,
      disallowedTools: toolScope.disallowedTools,
      canUseTool,
      scopePolicy,
      scopePolicyAuthority,
      getScopePolicySnapshot,
    }),
    askOwner,
    autonomyMode,
    harnessOverrides: step.harnessOptions?.[harness.name],
    persistSession: step.persistSession ?? false,
    enableFileCheckpointing: step.enableFileCheckpointing ?? false,
    ...(onMessage !== undefined ? { onMessage } : {}),
  };

  assertAdapterCanHostRequestedCapabilities(harness, options);
  return { options, askOwner };
}

/** Resolve the exact definition-known launch posture without probing readiness. */
export function resolveStaticWorkflowAgentRunContract(input: {
  step: WorkflowAgentRunContractSpec;
  harness: AgentHarness;
  source: string;
}): WorkflowAgentRunContract {
  return resolveWorkflowAgentRunContract({
    step: input.step,
    harness: input.harness,
    model: input.step.model,
    prompt: "[static workflow agent contract]",
    canUseTool: STATIC_CAN_USE_TOOL,
    askOwnerSource: input.source,
    ...(input.harness.emitsAgentMessageStream
      ? { onMessage: STATIC_ON_MESSAGE }
      : {}),
  });
}
