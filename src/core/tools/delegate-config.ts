import type { McpManager } from "#core/mcp/manager.js";
import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";
import type { ModelClient } from "#core/model/model-client.js";
import type { DelegateBackend, ModelTiers } from "#core/model/model-router.js";
import { PromptStore } from "./prompt-template.js";

export type DelegateMode = "explore" | "execute" | "research";

export const EXPLORE_MAX_TURNS = 10;
export const EXECUTE_MAX_TURNS = 15;
export const RESEARCH_MAX_TURNS = 25;
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
  client?: ModelClient;
  cwd?: string;
  projectContext?: string;
  instructionContext?: string;
  costTracker?: CostTracker;
  transport?: Transport;
  mcpManager?: McpManager;
  /** Override backend selection: "thin" (default KOTA loop) or "agent-sdk" (Claude Code runtime). */
  backend?: DelegateBackend;
  /** Budget cap in USD for Agent SDK delegations. */
  agentSdkBudgetUsd?: number;
};

let delegateConfig: DelegateConfig = { model: "claude-sonnet-4-6" };

export function setDelegateConfig(config: DelegateConfig): void {
  delegateConfig = config;
}

export function getDelegateConfig(): DelegateConfig {
  return delegateConfig;
}

export function resolvePromptTemplate(
  name: string,
  vars: Record<string, string>,
  cwd?: string,
): { content?: string; error?: string } {
  const store = new PromptStore(cwd || process.cwd());
  store.discover();
  const tpl = store.get(name);
  if (!tpl) {
    const available = store.list();
    const hint = available.length > 0
      ? ` Available: ${available.map((t) => t.name).join(", ")}`
      : " No templates found in .kota/prompts/.";
    return { error: `Error: prompt template "${name}" not found.${hint}` };
  }
  const result = store.render(name, vars);
  if (!result) return { error: `Error: failed to render template "${name}".` };
  const warn = result.missing.length > 0
    ? `\n\nNote: unresolved template variables: ${result.missing.join(", ")}`
    : "";
  return { content: result.content + warn };
}
