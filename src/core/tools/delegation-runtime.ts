import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AgentAskOwnerOptions,
  AgentCanUseTool,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type {
  ResolvedScopePolicy,
  ScopePolicyAuthority,
  ScopePolicySnapshotAccessor,
} from "#core/daemon/scope-policy.js";
import type { AutonomyMode } from "./autonomy-mode.js";
import { createDelegateBudget } from "./delegate-budget.js";
import type { ResolvedDelegateConfig } from "./delegate-config.js";
import type { GuardrailsConfig } from "./guardrails.js";

export type DelegationRuntime = ResolvedDelegateConfig & {
  scopeRoot?: string;
  env?: Record<string, string>;
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
};

const runtimeStorage = new AsyncLocalStorage<DelegationRuntime | undefined>();

export function getCurrentDelegationRuntime(): DelegationRuntime | undefined {
  return runtimeStorage.getStore();
}

export function withDelegationRuntime<T>(
  runtime: DelegationRuntime | undefined,
  run: () => T,
): T {
  return runtimeStorage.run(runtime, run);
}

/** Bind nested delegation to the effective harness invocation, including named children. */
export function withHarnessDelegationRuntime<T>(
  harness: string,
  options: AgentHarnessRunOptions,
  run: () => T,
): T {
  const parent = getCurrentDelegationRuntime();
  // A caller that lets an adapter choose its model cannot promise that model to a child.
  if (options.model === undefined) return withDelegationRuntime(undefined, run);
  return withDelegationRuntime({
    ...parent,
    model: options.model,
    effort: options.effort,
    modelTiers: undefined,
    client: undefined,
    mcpManager: undefined,
    mcpServers: options.mcpServers,
    mcpScopeConfigPolicy: options.mcpScopeConfigPolicy,
    backend: "agent-sdk",
    harness,
    cwd: options.cwd,
    scopeRoot: options.scopeRoot,
    modelProvider: options.modelProvider,
    modelOutputTokenLimits: options.modelOutputTokenLimits,
    instructionContext: options.systemPrompt,
    env: options.env,
    delegateBudget: parent?.delegateBudget ?? createDelegateBudget(),
    tokenBudget: options.tokenBudget,
    autonomyMode: options.autonomyMode,
    canUseTool: options.canUseTool,
    scopeId: options.sessionContext?.scopeId ?? options.workflowContext?.scopeId,
    scopePolicy: options.scopePolicy,
    scopePolicyAuthority: options.scopePolicyAuthority,
    getScopePolicySnapshot: options.getScopePolicySnapshot,
    authorityConfigPath: options.authorityConfigPath,
    approvalQueue: options.approvalQueue,
    guardrailsConfig: options.guardrailsConfig,
    idempotencyStore: options.idempotencyStore,
    askOwner: options.askOwner,
  }, run);
}
