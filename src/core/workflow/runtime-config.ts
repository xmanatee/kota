import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { ScopePolicyAuthority } from "#core/daemon/scope-policy.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import type { RunCoordinator } from "./run-coordinator.js";
import type { RunStateDatabase } from "./run-state-database.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

export type WorkflowRuntimeConfig = {
  bus: EventBus;
  /**
   * Per-scope view over {@link bus}. The runtime emits every scope-bound
   * lifecycle event through this wrapper so the resulting payload carries
   * the runtime's own `scopeId` without callers having to thread it
   * through. Required when the runtime emits real events (the daemon path);
   * tests that build a standalone runtime without an event scope may omit it.
   */
  pbus?: ScopedEventBus;
  scopeRoot?: string;
  scopeId: string;
  runState: RunStateDatabase;
  runCoordinator: RunCoordinator;
  daemonEpoch: number;
  /** Machine-owned authority document excluded from agent execution. */
  authorityConfigPath?: string;
  /**
   * Pre-built run store. Supplied by the per-scope runtime bundle so the
   * daemon shares one instance across the workflow runtime and the
   * daemon-handle. Tests that build a standalone runtime may omit this and
   * let the runtime construct its own from `scopeRoot`.
   */
  runStore?: WorkflowRunStore;
  deadLetterQueue?: DeadLetterQueueStore;
  eventJournal?: EventJournal;
	approvalQueue?: ApprovalQueue;
  idempotencyStore?: IdempotencyStore;
  model?: string;
  config?: KotaConfig;
  idleIntervalMs?: number;
  /**
   * True for the daemon's default directory-scope runtime. Standalone tests and
   * single-scope callers omit this and behave as the default runtime.
   */
  isDefaultScopeRuntime?: () => boolean;
  onLog?: (message: string) => void;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  scopePolicyAuthority?: ScopePolicyAuthority;
};
