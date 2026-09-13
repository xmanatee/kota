import type {
  AgentCanUseTool,
  AgentHarness,
  AgentHarnessRunOptions,
  AgentTokenBudgetLedger,
  KotaAgentMessage,
  TrajectoryDiagnosticsMetadata,
} from "#core/agent-harness/index.js";
import type { AgentUsage } from "#core/agent-harness/usage.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type {
  ResolvedScopePolicy,
  ScopePolicyAuthority,
  ScopePolicySnapshot,
} from "#core/daemon/scope-policy.js";
import type { ProcessSpawnObserver } from "#core/execution/process-supervisor.js";
import type { DelegateBudget } from "#core/tools/delegate-budget.js";
import type { ToolResult } from "#core/tools/index.js";
import type { AgentBackoffManager } from "../agent-backoff.js";

import type { WorkflowContinuationRepairEvidence } from "../continuation.js";
import type { RepositoryAccess } from "../run-sandbox.js";
import type {
  WorkflowAgentEvidenceSelection,
  WorkflowAgentHarnessRunner,
  WorkflowRuntimeResources,
} from "../run-types.js";

export type WorkflowStepOutput =
  | ToolResult
  | {
      content: string;
      sessionId?: string;
      turns?: number;
      subtype?: string;
    }
  | object
  | string
  | number
  | boolean
  | null
  | undefined;

export type AgentStepResult = {
  output: WorkflowStepOutput;
  harness: string;
  model: string;
  trajectoryDiagnostics: TrajectoryDiagnosticsMetadata;
  trajectoryMessages: readonly KotaAgentMessage[];
  preStepMutatedPaths: readonly string[];
  continuationInitialWorkspace?: WorkflowContinuationRepairEvidence;
  continuationTrajectory?: readonly WorkflowContinuationRepairEvidence[];
  tokenBudget?: AgentTokenBudgetLedger;
};

export type AgentStepConfig = {
  model?: string;
  config?: KotaConfig;
  scopeRoot: string;
  workspaceRoot?: string;
  authorityConfigPath?: string;
  runtimeResources?: WorkflowRuntimeResources;
  /** Runtime transaction authority. Focused executor fixtures may omit it. */
  repository?: RepositoryAccess;
  log?: (message: string) => void;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  resolveAgentHarness?: (name: string) => AgentHarness;
  createCanUseTool?: (stepId: string) => AgentCanUseTool;
  delegateBudget?: DelegateBudget;
  runTokenBudget?: AgentTokenBudgetLedger;
  onUsage?: (usage: AgentUsage) => void;
  approvalQueue?: ApprovalQueue;
  idempotencyStore?: IdempotencyStore;
  onProcessSpawn?: ProcessSpawnObserver;
  scopeId?: string;
  scopePolicyAuthority?: ScopePolicyAuthority;
  resolveRuntimeScope?: AgentHarnessRunOptions["resolveRuntimeScope"];
  scopePolicySnapshot?: ScopePolicySnapshot;
  scopePolicy?: ResolvedScopePolicy;
  /** Stable iteration identity supplied by the foreach executor. */
  foreachItemIndex?: number;
  /** Native provider sessions retained by step id across durable run attempts. */
  resumeSessionIds?: Readonly<Record<string, string>>;
  /** Runtime-owned gate; standalone executor fixtures intentionally omit it. */
  agentBackoff?: AgentBackoffManager;
  /** Run-level cancellation used to preserve the complete run on suppression. */
  agentBackoffAbortController?: AbortController;
  /** Resolved by the step executor from the workflow's semantic selection. */
  reviewEvidence?: WorkflowAgentEvidenceSelection;
  /** Current run context owns evidence retention and scope authorization. */
  reviewEvidenceRunner?: WorkflowAgentHarnessRunner;
};

export type ActiveAgentContinuationRuntime = Readonly<{
  initialWorkspace: WorkflowContinuationRepairEvidence;
  trajectory: readonly WorkflowContinuationRepairEvidence[];
  onProgressMessage: (message: KotaAgentMessage) => void | Promise<void>;
  pollEvidence: () => void | Promise<void>;
}>;
