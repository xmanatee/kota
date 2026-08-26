import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { EventJournal } from "#core/events/event-journal.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
  AgentBackoffManager,
  workflowAgentRuntimeId,
} from "./agent-backoff.js";
import { WorkflowEventBatchManager } from "./event-batches.js";
import { withWorkflowFailureAlert } from "./failure-alert.js";
import { ProjectRuntimeStateStore } from "./project-runtime-state.js";
import type { RunCoordinator } from "./run-coordinator.js";
import { workflowUsesAgent } from "./run-executor-utils.js";
import type { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import {
  maybeStartNext,
} from "./runtime-dispatch.js";
import { ScheduleTriggerManager } from "./schedule-triggers.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import { WatchTriggerManager } from "./watch-triggers.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

/**
 * Single state container shared by every per-lifecycle-phase helper. Each
 * phase file (`runtime-lifecycle.ts`, `runtime-definitions.ts`,
 * `runtime-runs-control.ts`, `runtime-events.ts`, and `runtime-dispatch.ts`)
 * declares its own narrow input interface; the context is a structural
 * superset of every one of them, so a single object satisfies each helper
 * without per-call casts.
 */
export interface WorkflowRuntimeContext {
  readonly projectDir: string;
  readonly projectId: string;
  readonly config?: KotaConfig;
  readonly store: WorkflowRunStore;
  readonly projectState: ProjectRuntimeStateStore;
  readonly deadLetterQueue?: DeadLetterQueueStore;
  readonly eventJournal?: EventJournal;
  readonly approvalQueue: ApprovalQueue;
  readonly idempotencyStore: IdempotencyStore;
  readonly wfQueue: WorkflowQueueManager;
  readonly scheduleTriggers: ScheduleTriggerManager;
  readonly watchTriggers: WatchTriggerManager;
  readonly eventBatches: WorkflowEventBatchManager;
  readonly backoff: AgentBackoffManager;
  readonly runState: RunStateDatabase;
  readonly runCoordinator: RunCoordinator;
  readonly daemonEpoch: number;
  readonly runtimeConfig: WorkflowRuntimeConfig;
  definitionsLoadedAt?: string;
  /**
   * Per-project view over the runtime's underlying bus. Every project-scoped
   * lifecycle event (`workflow.started`, `workflow.completed`, queue-shape,
   * runtime control) flows through this wrapper so subscribers can attribute
   * the emit without inferring scope from paths.
   */
  readonly pbus: ProjectScopedEventBus;
  readonly model?: string;
  readonly idleIntervalMs: number;
  lastIdleEventSignature?: string;
  lastIdleEventEmittedAtMs?: number;
  readonly resolveAgentDef?: (name: string) => AgentDef | undefined;
  readonly resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  readonly definitionSourceEnabled: Map<string, boolean>;
  readonly awaitResumeDisposers: Array<() => void>;

  // Mutable lifecycle / dispatch slots. Phase helpers reassign these as the
  // runtime moves through start, dispatch, recovery, and stop.
  workflowInputs?: readonly RegisteredWorkflowDefinitionInput[];
  definitions: WorkflowDefinition[];
  idleTimer: ReturnType<typeof setInterval> | null;
  stopBus: (() => void) | null;
  dispatchPaused: boolean;
  stopping: boolean;

  log(message: string): void;
}

export function createWorkflowRuntimeContext(
  runtimeConfig: WorkflowRuntimeConfig,
): WorkflowRuntimeContext {
  const projectDir = runtimeConfig.projectDir ?? process.cwd();
  const store = runtimeConfig.runStore ?? new WorkflowRunStore(projectDir);
  const scopeId = runtimeConfig.pbus?.getScopeId()
    ?? deriveDirectoryScopeId(projectDir);
  const pbus =
    runtimeConfig.pbus ??
    new ProjectScopedEventBus(runtimeConfig.bus, scopeId);
  const approvalQueue = runtimeConfig.approvalQueue
    ?? new ApprovalQueue(
      join(projectDir, ".kota", "approvals"),
      pbus,
      {
        scopeId,
        defaultTtlMs: runtimeConfig.config?.approvalTtlMs,
      },
    );
  const idempotencyStore =
    runtimeConfig.idempotencyStore ??
    new IdempotencyStore(join(store.rootDir, "idempotency"), scopeId);
  const onLog = runtimeConfig.onLog;
  const log = (message: string): void => {
    onLog?.(message);
  };

  // Trigger and queue managers need the assembled context, so their closures
  // read it after construction instead of recomputing runtime state.
  let ctx!: WorkflowRuntimeContext;
  const projectState = new ProjectRuntimeStateStore(
    runtimeConfig.runState,
    runtimeConfig.projectId,
  );

  const backoff = new AgentBackoffManager(
    projectState,
    log,
    workflowAgentRuntimeId(runtimeConfig.config),
  );
  const wfQueue = new WorkflowQueueManager({
    store,
    runState: runtimeConfig.runState,
    coordinator: runtimeConfig.runCoordinator,
    projectId: runtimeConfig.projectId,
    projectDir,
    deadLetterQueue: runtimeConfig.deadLetterQueue,
    getScopeId: () => ctx.pbus.getScopeId(),
    getActiveBackoff: () => backoff.getActive(),
    workflowUsesAgent,
    getDefinitions: () => ctx.definitions,
    log,
  });
  const scheduleTriggers = new ScheduleTriggerManager(
    () => runtimeConfig.runState.readWorkflowSummary(runtimeConfig.projectId),
    () => ctx.stopping,
    (def, trigger, run) => wfQueue.enqueue(def, trigger, run),
    () => maybeStartNext(ctx),
    () => runtimeConfig.config?.scheduler?.dispatchWindow,
    runtimeConfig.isDefaultScopeRuntime ?? (() => true),
  );
  const watchTriggers = new WatchTriggerManager(
    projectDir,
    () => ctx.stopping,
    (def, trigger, run) => wfQueue.enqueue(def, trigger, run),
    () => maybeStartNext(ctx),
    log,
  );

  const eventBatches = new WorkflowEventBatchManager(
    projectState,
    () => ctx.stopping,
    (def, trigger, run) => wfQueue.enqueue(def, trigger, run),
    () => maybeStartNext(ctx),
    () => ctx.pbus,
    log,
  );

  ctx = {
    projectDir,
    projectId: runtimeConfig.projectId,
    config: runtimeConfig.config,
    store,
    projectState,
    deadLetterQueue: runtimeConfig.deadLetterQueue,
    eventJournal: runtimeConfig.eventJournal,
    approvalQueue,
    idempotencyStore,
    wfQueue,
    scheduleTriggers,
    watchTriggers,
    eventBatches,
    backoff,
    runState: runtimeConfig.runState,
    runCoordinator: runtimeConfig.runCoordinator,
    daemonEpoch: runtimeConfig.daemonEpoch,
    runtimeConfig,
    definitionsLoadedAt: undefined,
    pbus,
    model: runtimeConfig.model,
    idleIntervalMs: runtimeConfig.idleIntervalMs ?? 30_000,
    lastIdleEventSignature: undefined,
    lastIdleEventEmittedAtMs: undefined,
    resolveAgentDef: runtimeConfig.resolveAgentDef,
    resolveSkillsPrompt: runtimeConfig.resolveSkillsPrompt,
    definitionSourceEnabled: new Map(),
    awaitResumeDisposers: [],
    workflowInputs: withWorkflowFailureAlert(
      runtimeConfig.workflows,
      runtimeConfig.config?.notifications?.alertCooldownMs,
    ),
    definitions: [],
    idleTimer: null,
    stopBus: null,
    dispatchPaused: false,
    stopping: false,
    log,
  };
  return ctx;
}
