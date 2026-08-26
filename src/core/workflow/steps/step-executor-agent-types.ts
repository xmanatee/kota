import type {
  AgentCanUseTool,
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
import type { RepositoryAccess } from "../run-sandbox.js";
import type { WorkflowRuntimeResources } from "../run-types.js";

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
  tokenBudget?: AgentTokenBudgetLedger;
};

export type AgentStepConfig = {
  model?: string;
  config?: KotaConfig;
  projectDir: string;
  workspaceDir?: string;
  authorityConfigPath?: string;
  runtimeResources?: WorkflowRuntimeResources;
  /** Runtime transaction authority. Focused executor fixtures may omit it. */
  repository?: RepositoryAccess;
  log?: (message: string) => void;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  createCanUseTool?: (stepId: string) => AgentCanUseTool;
  delegateBudget?: DelegateBudget;
  runTokenBudget?: AgentTokenBudgetLedger;
  onUsage?: (usage: AgentUsage) => void;
  approvalQueue?: ApprovalQueue;
  idempotencyStore?: IdempotencyStore;
  onProcessSpawn?: ProcessSpawnObserver;
  scopeId?: string;
  projectId?: string;
  scopePolicyAuthority?: ScopePolicyAuthority;
  scopePolicySnapshot?: ScopePolicySnapshot;
  scopePolicy?: ResolvedScopePolicy;
};
