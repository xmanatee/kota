import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AgentAskOwnerOptions,
  AgentCanUseTool,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { Transport } from "#core/loop/transport.js";
import type { ModelOutputTokenLimits } from "#core/model/output-token-limits.js";
import type { DelegateBudget } from "./delegate-budget.js";

export type HandoffAgentRuntime = {
  cwd: string;
  harness: string;
  resolveAgentDef: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  modelOutputTokenLimits?: ModelOutputTokenLimits;
  delegateBudget: DelegateBudget;
  canUseTool?: AgentCanUseTool;
  askOwner?: AgentAskOwnerOptions;
  transport?: Transport;
};

const runtimeStorage = new AsyncLocalStorage<HandoffAgentRuntime>();

export function getCurrentHandoffAgentRuntime(): HandoffAgentRuntime | undefined {
  return runtimeStorage.getStore();
}

export function withHandoffAgentRuntime<T>(
  runtime: HandoffAgentRuntime,
  run: () => T,
): T {
  return runtimeStorage.run(runtime, run);
}
