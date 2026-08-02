import type { AgentCanUseTool } from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { WorkflowRunStore } from "./run-store.js";
import type {
  WorkflowRunToolRunner,
  WorkflowRuntimeResources,
} from "./run-types.js";
import type { TriggerWorkflowFromStepResult } from "./runtime-dispatch-trigger.js";
import type { AgentRunLimiter } from "./steps/agent-run-limiter.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

export type RunExecutorDeps = {
  projectDir: string;
  workspaceDir?: string;
  authorityConfigPath?: string;
  runtimeResources?: WorkflowRuntimeResources;
  bus: EventBus;
  /**
   * Per-project view over the bus. Standalone runs derive one from projectDir
   * when the daemon does not supply it.
   */
  pbus?: ProjectScopedEventBus;
  store: WorkflowRunStore;
  deadLetterQueue?: DeadLetterQueueStore;
  eventJournal?: EventJournal;
  approvalQueue?: ApprovalQueue;
  idempotencyStore?: IdempotencyStore;
  model?: string;
  config?: KotaConfig;
  runId?: string;
  log: (message: string) => void;
  /** Queue or run another workflow from a trigger step. */
  triggerWorkflow?: (
    workflowName: string,
    payload: WorkflowRunTrigger["payload"],
    waitFor: "queued" | "completed",
    signal?: AbortSignal,
  ) => Promise<TriggerWorkflowFromStepResult>;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  resolveScopePolicy?: () => ResolvedScopePolicy;
  runTool?: WorkflowRunToolRunner;
  createAgentCanUseTool?: (stepId: string) => AgentCanUseTool;
  /** Shared gate for active agent harness runs. */
  agentRunLimiter?: AgentRunLimiter;
  agentConcurrency?: number;
};
