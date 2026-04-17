import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { ModelClient } from "#core/model/model-client.js";
import type { DelegateBackend, ModelTiers } from "#core/model/model-router.js";

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
  client?: ModelClient;
  cwd?: string;
  projectContext?: string;
  instructionContext?: string;
  costTracker?: CostTracker;
  transport?: Transport;
  mcpManager?: McpManager;
  /** Override backend selection: "thin" (default KOTA loop) or "agent-sdk" (Claude Code runtime). */
  backend?: DelegateBackend;
};

let delegateConfig: DelegateConfig = { model: "claude-opus-4-7" };

export function setDelegateConfig(config: DelegateConfig): void {
  delegateConfig = config;
}

export function getDelegateConfig(): DelegateConfig {
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
