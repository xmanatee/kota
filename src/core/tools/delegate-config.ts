import type { AgentDef } from "#core/agents/agent-types.js";
import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { ModelClient } from "#core/model/model-client.js";
import type { DelegateBackend, ModelTiers } from "#core/model/model-router.js";
import type { ModelOutputTokenLimits } from "#core/model/output-token-limits.js";
import {
  PRESET_ENV_VAR,
  resolvePreset,
  resolveTierModel,
} from "#core/model/preset.js";
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
  modelTiers?: ModelTiers;
  modelOutputTokenLimits?: ModelOutputTokenLimits;
  client?: ModelClient;
  cwd?: string;
  projectContext?: string;
  instructionContext?: string;
  costTracker?: CostTracker;
  transport?: Transport;
  mcpManager?: McpManager;
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
};

export type ResolvedDelegateConfig = DelegateConfig & {
  delegateBudget: DelegateBudget;
};

/**
 * Default delegate config used before `setDelegateConfig` runs (e.g. when a
 * tool surface accesses the delegate without an active session). The model is
 * the active preset's `capable` tier, resolved via env + shipped default — no
 * literal model id baked in. The session-time `setDelegateConfig` call from
 * `loop-constructor` overwrites this with the operator's resolved
 * `editorModel`.
 */
function buildDefaultDelegateConfig(): ResolvedDelegateConfig {
  const { preset } = resolvePreset({ env: process.env[PRESET_ENV_VAR] });
  return {
    model: resolveTierModel(preset, "capable"),
    delegateBudget: createDelegateBudget(),
  };
}

let delegateConfig: ResolvedDelegateConfig | null = null;

export function setDelegateConfig(config: DelegateConfig): void {
  if (config.delegateBudget && config.delegateBudgetLimits) {
    throw new Error("Delegate config accepts either delegateBudget or delegateBudgetLimits, not both.");
  }
  delegateConfig = {
    ...config,
    delegateBudget: config.delegateBudget ?? createDelegateBudget(config.delegateBudgetLimits),
  };
}

export function getDelegateConfig(): ResolvedDelegateConfig {
  if (!delegateConfig) delegateConfig = buildDefaultDelegateConfig();
  return delegateConfig;
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
