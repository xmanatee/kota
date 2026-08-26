/**
 * Agent harness delegate backend — routes delegate tasks through a registered
 * agent harness. The harness name must be supplied by the caller (normally
 * pulled from `config.defaultAgentHarness` when wiring the delegate config);
 * there is no silent fallback that re-pins subagents to claude-agent-sdk.
 */

import {
  type AgentTokenBudgetLedger,
  createNativeAgentInvalidationLifecycle,
  type NativeAgentInvalidationLifecycle,
  resolveAgentHarness,
  routeKotaToolControlOptions,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentHarnessWorkflowContext } from "#core/agent-harness/types.js";
import {
  buildSubAgentPrompt,
  EXECUTE_PROMPT,
  EXPLORE_PROMPT,
  type PromptConfig,
} from "#core/agents/delegate-prompts.js";
import {
  capScopeAutonomyMode,
  type ScopePolicySnapshot,
} from "#core/daemon/scope-policy.js";
import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";
import type { ModelProviderSelection } from "#core/model/model-client.js";
import type { ModelOutputTokenLimits } from "#core/model/output-token-limits.js";
import {
  assembleDelegateResult,
  type CompletionReason,
  type DelegateMetadata,
} from "./delegate-format.js";
import type { ToolResult } from "./index.js";
import { getCurrentToolCallExecutionOptions } from "./tool-runner-runtime.js";
import type { ToolCallExecutionOptions } from "./tool-runner-types.js";

const EXPLORE_HARNESS_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Bash",
];

const EXECUTE_HARNESS_TOOLS = [
  ...EXPLORE_HARNESS_TOOLS,
  "Edit",
  "Write",
];

export type DelegateHarnessConfig = {
  cwd?: string;
  scopeRoot?: string;
  scopeContext?: string;
  instructionContext?: string;
  costTracker?: CostTracker;
  transport?: Transport;
  model?: string;
  modelProvider?: ModelProviderSelection;
  modelOutputTokenLimits?: ModelOutputTokenLimits;
  /**
   * Registered agent-harness name to run this delegate on. Required — the
   * caller must plumb it through from `config.defaultAgentHarness` (see
   * `setDelegateConfig` callers in the loop modules). If unset, the delegate
   * fails loudly rather than silently re-pinning subagents to claude.
   */
  harness: string;
  tokenBudget?: AgentTokenBudgetLedger;
  workflowContext?: AgentHarnessWorkflowContext;
};

function createNativeDelegateInvalidation(
  harnessName: string,
  inherited: ToolCallExecutionOptions | undefined,
  initialSnapshot: ScopePolicySnapshot | undefined,
): NativeAgentInvalidationLifecycle {
  const parentSignal = inherited?.signal;
  const scopeId = inherited?.scopeId;
  const authority = inherited?.scopePolicyAuthority;
  const missing = [
    ...(parentSignal === undefined ? ["parent AbortSignal"] : []),
    ...(scopeId === undefined ? ["scope id"] : []),
    ...(authority === undefined ? ["scope-policy authority"] : []),
    ...(initialSnapshot === undefined ? ["current scope-policy snapshot"] : []),
  ];
  if (missing.length > 0) {
    throw new Error(
      `Native delegate harness "${harnessName}" requires live invalidation context ` +
        `(${missing.join(", ")} missing); refusing to launch.`,
    );
  }

  return createNativeAgentInvalidationLifecycle({
    executionLabel: `Native delegate harness "${harnessName}"`,
    parentSignal,
    scopeId,
    authority,
    initialSnapshot,
  });
}

export async function runDelegateHarness(
  task: string,
  mode: "explore" | "execute" | "research",
  config: DelegateHarnessConfig,
): Promise<ToolResult> {
  const isExecute = mode === "execute";
  const basePrompt = isExecute ? EXECUTE_PROMPT : EXPLORE_PROMPT;
  const promptConfig: PromptConfig = {
    cwd: config.cwd,
    scopeContext: config.scopeContext,
    instructionContext: config.instructionContext,
  };
  const allowedTools = isExecute ? EXECUTE_HARNESS_TOOLS : EXPLORE_HARNESS_TOOLS;
  const systemPrompt = buildSubAgentPrompt(basePrompt, {
    ...promptConfig,
    toolNames: allowedTools,
  });
  const transport = config.transport;
  const taskChars = [...task];
  const taskPreview =
    taskChars.length > 60 ? `${taskChars.slice(0, 57).join("")}...` : task;

  if (!config.harness) {
    throw new Error(
      "delegate(agent-sdk backend) requires a harness name. Set config.defaultAgentHarness so it flows through DelegateConfig.harness. No implicit default.",
    );
  }
  const harnessName = config.harness;
  const harness = resolveAgentHarness(harnessName);
  const inheritedToolExecution = getCurrentToolCallExecutionOptions();
  const scopePolicySnapshot = inheritedToolExecution?.getScopePolicySnapshot?.();
  const scopePolicy = scopePolicySnapshot?.policy
    ?? inheritedToolExecution?.scopePolicy;
  const inheritedAutonomyMode = inheritedToolExecution?.autonomyMode ?? "autonomous";
  const autonomyMode = scopePolicy
    ? capScopeAutonomyMode(inheritedAutonomyMode, scopePolicy)
    : inheritedAutonomyMode;
  const invalidation = harness.toolControl === "native"
    ? createNativeDelegateInvalidation(
        harnessName,
        inheritedToolExecution,
        scopePolicySnapshot,
      )
    : undefined;

  let result: Awaited<ReturnType<typeof runAgentHarness>>;
  try {
    if (transport) {
      transport.emit({
        type: "status",
        message: `[kota] delegate(${mode}:${harnessName}) starting: ${taskPreview}`,
      });
    }
    result = await runAgentHarness(
      harness,
      {
        prompt: task,
        model: config.model,
        ...(config.modelProvider !== undefined ? { modelProvider: config.modelProvider } : {}),
        modelOutputTokenLimits: config.modelOutputTokenLimits,
        systemPrompt,
        ...routeKotaToolControlOptions(harness, {
          allowedTools,
          canUseTool: inheritedToolExecution?.canUseTool,
          scopePolicy,
          scopePolicyAuthority: inheritedToolExecution?.scopePolicyAuthority,
          getScopePolicySnapshot: inheritedToolExecution?.getScopePolicySnapshot,
        }),
        ...(inheritedToolExecution?.guardrailsConfig !== undefined
          ? { guardrailsConfig: inheritedToolExecution.guardrailsConfig }
          : {}),
        ...(inheritedToolExecution?.clientApprovalResolver !== undefined
          ? { clientApprovalResolver: inheritedToolExecution.clientApprovalResolver }
          : {}),
        ...(inheritedToolExecution?.approvalQueue !== undefined
          ? { approvalQueue: inheritedToolExecution.approvalQueue }
          : {}),
        ...(inheritedToolExecution?.idempotencyStore !== undefined
          ? { idempotencyStore: inheritedToolExecution.idempotencyStore }
          : {}),
        ...(inheritedToolExecution?.authorityConfigPath !== undefined
          ? { authorityConfigPath: inheritedToolExecution.authorityConfigPath }
          : {}),
        ...(invalidation !== undefined
          ? { abortController: invalidation.abortController }
          : {}),
        autonomyMode,
        scopeRoot: config.scopeRoot ?? config.cwd ?? process.cwd(),
        cwd: config.cwd ?? process.cwd(),
        effort: "xhigh",
        tokenBudget: config.tokenBudget,
        ...(config.workflowContext !== undefined
          ? { workflowContext: config.workflowContext }
          : {}),
      },
      transport
        ? {
            write(text: string) {
              transport.emit({
                type: "progress",
                content: text,
                source: `delegate(${mode}:${harnessName})`,
              });
              return true;
            },
          }
        : undefined,
    );
  } finally {
    invalidation?.dispose();
  }

  let completionReason: CompletionReason = "done";
  if (result.subtype === "error_max_turns") completionReason = "turn_limit";
  else if (result.subtype === "error_during_execution") {
    completionReason = "circuit_break";
  }

  if (config.costTracker && result.usage.cost.state === "complete") {
    config.costTracker.addRawCost(result.usage.cost.usd);
  }

  if (transport) {
    transport.emit({
      type: "status",
      message: `[kota] delegate(${mode}:${harnessName}) done — ${result.turns} turn(s)${result.sessionId ? ` [${result.sessionId.slice(0, 8)}]` : ""}`,
    });
  }

  const meta: DelegateMetadata = {
    mode: `${mode}:${harnessName}`,
    turnsUsed: result.turns,
    turnsMax: undefined,
    toolsUsed: [harnessName],
    completionReason,
    urlsFetched: [],
    searchQueries: [],
  };

  return assembleDelegateResult(result.text, meta, new Set(), []);
}
