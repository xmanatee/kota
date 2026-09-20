import type { AgentTokenBudgetLedger } from "#core/agent-harness/token-budget.js";
import type { AgentEffort, AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { ModelClient, ModelProviderSelection } from "#core/model/model-client.js";
import type { DelegateBackend, ModelTiers } from "#core/model/model-router.js";
import type { ModelOutputTokenLimits } from "#core/model/output-token-limits.js";
import {
  createDelegateBudget,
  type DelegateBudget,
  type DelegateBudgetLimits,
} from "./delegate-budget.js";

export type DelegateMode = "explore" | "execute" | "research";

export const EXPLORE_MAX_TURNS = 30;
export const EXECUTE_MAX_TURNS = 50;
export const RESEARCH_MAX_TURNS = 80;
export const SUB_AGENT_RESULT_LIMIT = 30_000;
export const IDENTICAL_FAILURE_LIMIT = 3;
export const MAX_DELEGATE_IMAGES = 10;
export const STREAM_MAX_RETRIES = 2;

export function streamBackoff(attempt: number): Promise<void> {
  const delay = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
  return new Promise((r) => setTimeout(r, delay));
}

export type DelegateConfig = {
  model: string;
  effort: AgentEffort;
  modelTiers?: ModelTiers;
  modelProvider?: ModelProviderSelection;
  modelOutputTokenLimits?: ModelOutputTokenLimits;
  client?: ModelClient;
  cwd?: string;
  scopeContext?: string;
  instructionContext?: string;
  costTracker?: CostTracker;
  transport?: Transport;
  mcpManager?: McpManager;
  mcpServers?: AgentHarnessRunOptions["mcpServers"];
  mcpScopeConfigPolicy?: AgentHarnessRunOptions["mcpScopeConfigPolicy"];
  /** Override backend selection: "thin" (default KOTA loop) or "agent-sdk" (Claude Code runtime). */
  backend?: DelegateBackend;
  /**
   * Registered agent-harness name for the `"agent-sdk"` backend. Callers
   * populate this from `KotaConfig.defaultAgentHarness`; the delegate backend
   * throws if the field is missing when routed down the agent-harness path.
   */
  harness?: string;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  delegateBudgetLimits?: DelegateBudgetLimits;
  delegateBudget?: DelegateBudget;
  tokenBudget?: AgentTokenBudgetLedger;
};

export type ResolvedDelegateConfig = DelegateConfig & {
  delegateBudget: DelegateBudget;
};

export function resolveDelegateConfig(config: DelegateConfig): ResolvedDelegateConfig {
  if (config.delegateBudget && config.delegateBudgetLimits) {
    throw new Error("Delegate config accepts either delegateBudget or delegateBudgetLimits, not both.");
  }
  return {
    ...config,
    delegateBudget: config.delegateBudget ?? createDelegateBudget(config.delegateBudgetLimits),
  };
}

export type PromptResolverFn = (
  name: string,
  vars: Record<string, string>,
  cwd?: string,
) => { content?: string; error?: string };

let promptResolver: PromptResolverFn | undefined;

export function setPromptResolver(fn: PromptResolverFn): void {
  promptResolver = fn;
}

export function resolvePromptTemplate(
  name: string,
  vars: Record<string, string>,
  cwd?: string,
): { content?: string; error?: string } {
  if (!promptResolver) {
    return { error: "Error: prompt template resolution unavailable (prompt-templates module not loaded)." };
  }
  return promptResolver(name, vars, cwd);
}
