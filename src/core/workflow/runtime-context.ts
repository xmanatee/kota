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
import { workflowUsesAgent } from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import {
  maybeStartNext,
  type WorkflowActiveRunReservation,
} from "./runtime-dispatch.js";
import { concurrencyLimitForDefinition } from "./runtime-dispatch-concurrency.js";
import { ScheduleTriggerManager } from "./schedule-triggers.js";
import {
  type AgentRunLimiter,
  createAgentRunLimiter,
} from "./steps/agent-run-limiter.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import { WatchTriggerManager } from "./watch-triggers.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

/**
 * Single state container shared by every per-lifecycle-phase helper. Each
 * phase file (`runtime-lifecycle.ts`, `runtime-definitions.ts`,
 * `runtime-runs-control.ts`, `runtime-events.ts`, `runtime-recovery.ts`,
 * `runtime-dispatch.ts`) declares its own narrow input interface; the context
 * is a structural superset of every one of them, so a single object satisfies
 * each helper without per-call casts.
 */
export interface WorkflowRuntimeContext {
  readonly projectDir: string;
  readonly config?: KotaConfig;
  readonly store: WorkflowRunStore;
  readonly deadLetterQueue?: DeadLetterQueueStore;
  readonly eventJournal?: EventJournal;
  readonly approvalQueue: ApprovalQueue;
  readonly idempotencyStore: IdempotencyStore;
  readonly wfQueue: WorkflowQueueManager;
  readonly scheduleTriggers: ScheduleTriggerManager;
  readonly watchTriggers: WatchTriggerManager;
  readonly eventBatches: WorkflowEventBatchManager;
  readonly backoff: AgentBackoffManager;
  readonly agentConcurrency: number;
  readonly agentRunLimiter: AgentRunLimiter;
  readonly codeConcurrency: number;
  readonly runtimeConfig: WorkflowRuntimeConfig;
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
  /**
   * Active runs keyed by run id. The value carries the workflow name so
   * dispatch can count same-workflow and group concurrency independently.
   */
  readonly activeRuns: Map<string, WorkflowActiveRunReservation>;
  workspaceDir?: string;

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

  const backoff = new AgentBackoffManager(
    store,
    log,
    workflowAgentRuntimeId(runtimeConfig.config),
  );
  const wfQueue = new WorkflowQueueManager({
    store,
    projectDir,
    getConfig: () => ctx.config,
    idempotencyStore,
    deadLetterQueue: runtimeConfig.deadLetterQueue,
    getScopeId: () => ctx.pbus.getScopeId(),
    getActiveBackoff: () => backoff.getActive(),
    workflowUsesAgent,
    concurrencyLimit: (definition) =>
      concurrencyLimitForDefinition(ctx, definition),
    isActiveRun: (name) =>
      [...ctx.activeRuns.values()].some((run) => run.workflowName === name),
    activeRunCount: (name) =>
      [...ctx.activeRuns.values()].filter((run) => run.workflowName === name).length,
    getDefinitions: () => ctx.definitions,
    log,
  });
  const scheduleTriggers = new ScheduleTriggerManager(
    store,
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

  const agentConcurrency = runtimeConfig.agentConcurrency ?? 1;
  const eventBatches = new WorkflowEventBatchManager(
    store,
    () => ctx.stopping,
    (def, trigger, run) => wfQueue.enqueue(def, trigger, run),
    () => maybeStartNext(ctx),
    () => ctx.pbus,
    log,
  );

  ctx = {
    projectDir,
    config: runtimeConfig.config,
    store,
    deadLetterQueue: runtimeConfig.deadLetterQueue,
    eventJournal: runtimeConfig.eventJournal,
    approvalQueue,
    idempotencyStore,
    wfQueue,
    scheduleTriggers,
    watchTriggers,
    eventBatches,
    backoff,
    agentConcurrency,
    agentRunLimiter: createAgentRunLimiter(agentConcurrency)!,
    codeConcurrency: runtimeConfig.codeConcurrency ?? 4,
    runtimeConfig,
    pbus,
    model: runtimeConfig.model,
    idleIntervalMs: runtimeConfig.idleIntervalMs ?? 30_000,
    lastIdleEventSignature: undefined,
    lastIdleEventEmittedAtMs: undefined,
    resolveAgentDef: runtimeConfig.resolveAgentDef,
    resolveSkillsPrompt: runtimeConfig.resolveSkillsPrompt,
    definitionSourceEnabled: new Map(),
    awaitResumeDisposers: [],
    activeRuns: new Map(),
    workflowInputs: runtimeConfig.workflows,
    definitions: [],
    idleTimer: null,
    stopBus: null,
    dispatchPaused: false,
    stopping: false,
    log,
  };
  return ctx;
}
