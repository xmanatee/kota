import type {
  AgentCanUseTool,
  AgentTokenBudgetLedger,
  KotaAgentMessage,
  TrajectoryDiagnosticsMetadata,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type {
  ResolvedScopePolicy,
  ScopePolicyAuthority,
  ScopePolicySnapshot,
} from "#core/daemon/scope-policy.js";
import type { DelegateBudget } from "#core/tools/delegate-budget.js";
import type { ToolResult } from "#core/tools/index.js";
import type { WorkflowRuntimeResources } from "../run-types.js";
import type { AgentRunLimiter } from "./agent-run-limiter.js";

export type WorkflowStepOutput =
  | ToolResult
  | {
      content: string;
      sessionId?: string;
      turns?: number;
      totalCostUsd?: number;
      inputTokens?: number;
      outputTokens?: number;
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
  log?: (message: string) => void;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  createCanUseTool?: (stepId: string) => AgentCanUseTool;
  agentRunLimiter?: AgentRunLimiter;
  delegateBudget?: DelegateBudget;
  runTokenBudget?: AgentTokenBudgetLedger;
  approvalQueue?: ApprovalQueue;
  idempotencyStore?: IdempotencyStore;
  scopeId?: string;
  projectId?: string;
  scopePolicyAuthority?: ScopePolicyAuthority;
  scopePolicySnapshot?: ScopePolicySnapshot;
  scopePolicy?: ResolvedScopePolicy;
};
