import type { AgentCanUseTool, AgentHarness } from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { ScopePolicyAuthority } from "#core/daemon/scope-policy.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import type { AgentBackoffManager } from "./agent-backoff.js";
import type { RunContext } from "./run-context.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunToolRunner, WorkflowRuntimeSummary } from "./run-types.js";
import type { TriggerWorkflowFromStepResult } from "./runtime-dispatch-trigger.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowCommandRunner } from "./workflow-command.js";

export type RunExecutorDeps = {
  runContext: RunContext;
  authorityConfigPath?: string;
  bus: EventBus;
  /**
   * Per-project view over the bus. Standalone runs derive one from workspaceRoot
   * when the daemon does not supply it.
   */
  pbus?: ScopedEventBus;
  store: WorkflowRunStore;
  readRuntimeState: () => WorkflowRuntimeSummary;
  deadLetterQueue?: DeadLetterQueueStore;
  eventJournal?: EventJournal;
  approvalQueue?: ApprovalQueue;
  idempotencyStore?: IdempotencyStore;
  model?: string;
  config?: KotaConfig;
  log: (message: string) => void;
  /** Queue or run another workflow from a trigger step. */
  triggerWorkflow?: (
    workflowName: string,
    payload: WorkflowRunTrigger["payload"],
    waitFor: "queued" | "completed",
    signal?: AbortSignal,
    triggerId?: string,
  ) => Promise<TriggerWorkflowFromStepResult>;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  scopePolicyAuthority?: ScopePolicyAuthority;
  runTool?: WorkflowRunToolRunner;
  /** Host-owned command execution port; defaults to the supervised runner. */
  runCommand?: WorkflowCommandRunner;
  /** Host-owned harness lookup; defaults to the process registry. */
  resolveAgentHarness?: (name: string) => AgentHarness;
  createAgentCanUseTool?: (stepId: string) => AgentCanUseTool;
  /** Daemon-owned admission gate shared by every agent call in the hosted fleet. */
  agentBackoff?: AgentBackoffManager;
};
