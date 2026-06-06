import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

export type WorkflowRuntimeConfig = {
  bus: EventBus;
  /**
   * Per-project view over {@link bus}. The runtime emits every project-scoped
   * lifecycle event through this wrapper so the resulting payload carries
   * the runtime's own `projectId` without callers having to thread it
   * through. Required when the runtime emits real events (the daemon path);
   * tests that build a standalone runtime without project scope may omit it.
   */
  pbus?: ProjectScopedEventBus;
  projectDir?: string;
  /**
   * Pre-built run store. Supplied by the per-project runtime bundle so the
   * daemon shares one instance across the workflow runtime and the
   * daemon-handle. Tests that build a standalone runtime may omit this and
   * let the runtime construct its own from `projectDir`.
   */
  runStore?: WorkflowRunStore;
  deadLetterQueue?: DeadLetterQueueStore;
  eventJournal?: EventJournal;
  idempotencyStore?: IdempotencyStore;
  model?: string;
  config?: KotaConfig;
  idleIntervalMs?: number;
  /**
   * Maximum number of agent-step workflows that may run simultaneously.
   * Defaults to 1 so the default experience is serialized agent runs.
   */
  agentConcurrency?: number;
  /**
   * Maximum number of code-only (no agent step) workflows that may run
   * simultaneously. Code-only workflows run independently of agent-step
   * workflows and each other up to this cap. Defaults to 4.
   */
  codeConcurrency?: number;
  onLog?: (message: string) => void;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
};
