import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AgentAskOwnerOptions,
  AgentCanUseTool,
  AgentTokenBudgetLedger,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type {
  ResolvedScopePolicy,
  ScopePolicyAuthority,
  ScopePolicySnapshotAccessor,
} from "#core/daemon/scope-policy.js";
import type { Transport } from "#core/loop/transport.js";
import type { ModelProviderSelection } from "#core/model/model-client.js";
import type { ModelOutputTokenLimits } from "#core/model/output-token-limits.js";
import type { AutonomyMode } from "./autonomy-mode.js";
import type { DelegateBudget } from "./delegate-budget.js";
import type { GuardrailsConfig } from "./guardrails.js";

export type HandoffAgentRuntime = {
  cwd: string;
  scopeRoot?: string;
  harness: string;
  resolveAgentDef: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  modelProvider?: ModelProviderSelection;
  modelOutputTokenLimits?: ModelOutputTokenLimits;
  env?: Record<string, string>;
  delegateBudget: DelegateBudget;
  /** Effective posture already imposed on the parent harness run. */
  autonomyMode?: AutonomyMode;
  canUseTool?: AgentCanUseTool;
  scopeId?: string;
  scopePolicy?: ResolvedScopePolicy;
  scopePolicyAuthority?: ScopePolicyAuthority;
  getScopePolicySnapshot?: ScopePolicySnapshotAccessor;
  authorityConfigPath?: string;
  approvalQueue?: ApprovalQueue;
  guardrailsConfig?: GuardrailsConfig;
  idempotencyStore?: IdempotencyStore;
  askOwner?: AgentAskOwnerOptions;
  tokenBudget?: AgentTokenBudgetLedger;
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
