import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { AgentBackoffManager } from "./agent-backoff.js";
import { WorkflowEventBatchManager } from "./event-batches.js";
import { workflowUsesAgent } from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunExecutionResult, WorkflowRuntimeState } from "./run-types.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import {
  disableWorkflow,
  enableWorkflow,
  getDefinitionCount,
  getDefinitionSourceEnabled,
  getDefinitions,
  getRuntimeState,
  reloadWorkflowDefinitions,
  setWorkflowInputs,
  validateDefinitions,
} from "./runtime-definitions.js";
import { maybeStartNext } from "./runtime-dispatch.js";
import {
  getDispatchWindowStatus,
  isBusy,
  isDispatchPaused,
  setDispatchPaused,
  startRuntime,
  stopRuntime,
  WORKFLOW_STOP_ABORT_WAIT_MS,
  type WorkflowDispatchPauseMode,
} from "./runtime-lifecycle.js";
import {
  abortActiveRun,
  abortActiveRuns,
  cancelQueuedRun,
  enqueuePendingRun,
  enqueueWebhookRun,
} from "./runtime-runs-control.js";
import {
  ABORT_SIGNAL_FILE,
  PAUSE_SIGNAL_FILE,
  RELOAD_SIGNAL_FILE,
} from "./runtime-signals.js";
import { ScheduleTriggerManager } from "./schedule-triggers.js";
import { type AgentRunLimiter, createAgentRunLimiter } from "./steps/agent-run-limiter.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import { WorkflowDefinitionError } from "./validation.js";
import { WatchTriggerManager } from "./watch-triggers.js";
import type { WebhookRunPayload } from "./workflow-dispatcher-provider.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

export type { WorkflowRuntimeConfig };
export { ABORT_SIGNAL_FILE, PAUSE_SIGNAL_FILE, RELOAD_SIGNAL_FILE, WORKFLOW_STOP_ABORT_WAIT_MS };

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
   * Active runs keyed by workflow name. Same-workflow serialisation is
   * enforced by never dispatching a workflow that already has an entry here.
   */
  readonly activeRuns: Map<
    string,
    { promise: Promise<WorkflowRunExecutionResult>; abortController: AbortController }
  >;

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

/**
 * Thin orchestrator over the per-lifecycle-phase sibling helpers. The class
 * owns the {@link WorkflowRuntimeContext} container; each public method
 * forwards to one phase's helper, which mutates the shared context as the
 * runtime advances.
 */
export class WorkflowRuntime {
  private readonly ctx: WorkflowRuntimeContext;

  constructor(runtimeConfig: WorkflowRuntimeConfig) {
    const projectDir = runtimeConfig.projectDir ?? process.cwd();
    const store = runtimeConfig.runStore ?? new WorkflowRunStore(projectDir);
    const scopeId = deriveDirectoryScopeId(projectDir);
    const idempotencyStore =
      runtimeConfig.idempotencyStore ??
      new IdempotencyStore(join(store.rootDir, "idempotency"), scopeId);
    const onLog = runtimeConfig.onLog;
    const log = (message: string): void => {
      onLog?.(message);
    };

    // Closures captured by the trigger managers and backoff manager need to
    // see the assembled context, so build the object first and refer to its
    // fields through the closure rather than recomputing them.
    let ctx!: WorkflowRuntimeContext;

    const backoff = new AgentBackoffManager(
      store,
      () => ctx.wfQueue.getRuns(),
      (q) => { ctx.wfQueue.setRuns(q); },
      () => ctx.wfQueue.persist(),
      () => ctx.definitions,
      (def) => workflowUsesAgent(def),
      log,
    );
    const wfQueue = new WorkflowQueueManager({
      store,
      idempotencyStore,
      getActiveBackoff: () => backoff.getActive(),
      shouldSuppressBackoff: (def) => backoff.shouldSuppress(def),
      workflowUsesAgent,
      isActiveRun: (name) => ctx.activeRuns.has(name),
      getDefinitions: () => ctx.definitions,
      log,
    });
    const scheduleTriggers = new ScheduleTriggerManager(
      store,
      () => ctx.stopping,
      (def, trigger, run) => wfQueue.enqueue(def, trigger, run),
      () => maybeStartNext(ctx),
      () => runtimeConfig.config?.scheduler?.dispatchWindow,
    );
    const watchTriggers = new WatchTriggerManager(
      projectDir,
      () => ctx.stopping,
      (def, trigger, run) => wfQueue.enqueue(def, trigger, run),
      () => maybeStartNext(ctx),
      log,
    );

    const pbus =
      runtimeConfig.pbus ??
      new ProjectScopedEventBus(runtimeConfig.bus, scopeId);

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
    this.ctx = ctx;
  }

  start(): void {
    startRuntime(this.ctx);
  }

  stop(
    gracePeriodMs = 60_000,
    abortWaitMs = WORKFLOW_STOP_ABORT_WAIT_MS,
  ): Promise<void> {
    return stopRuntime(this.ctx, gracePeriodMs, abortWaitMs);
  }

  isBusy(): boolean {
    return isBusy(this.ctx);
  }

  isDispatchPaused(): boolean {
    return isDispatchPaused(this.ctx);
  }

  setDispatchPaused(paused: boolean, mode: WorkflowDispatchPauseMode = "runtime"): void {
    setDispatchPaused(this.ctx, paused, mode);
  }

  getDispatchWindowStatus(): { blocked: boolean; opensAt?: string } {
    return getDispatchWindowStatus(this.ctx);
  }

  abortActiveRuns(): { aborted: number } {
    return abortActiveRuns(this.ctx);
  }

  abortActiveRun(runId: string): { ok: boolean; notFound?: boolean; queued?: boolean } {
    return abortActiveRun(this.ctx, runId);
  }

  setWorkflowInputs(inputs: readonly RegisteredWorkflowDefinitionInput[]): void {
    setWorkflowInputs(this.ctx, inputs);
  }

  reloadWorkflowDefinitions(): { count: number } {
    return reloadWorkflowDefinitions(this.ctx);
  }

  validateDefinitions(): { count: number } {
    return validateDefinitions(this.ctx);
  }

  enqueuePendingRun(
    name: string,
    tags?: string[],
    extraPayload?: Record<string, unknown>,
  ): {
    ok: boolean;
    queued?: string;
    runId?: string;
    alreadyQueued?: boolean;
    error?: string;
  } {
    return enqueuePendingRun(this.ctx, name, tags, extraPayload);
  }

  enqueueWebhookRun(
    name: string,
    webhookPayload: WebhookRunPayload,
  ): { ok: boolean; runId?: string; alreadyRunning?: boolean; error?: string } {
    return enqueueWebhookRun(this.ctx, name, webhookPayload);
  }

  cancelQueuedRun(runId: string): { ok: boolean; notFound?: boolean; active?: boolean } {
    return cancelQueuedRun(this.ctx, runId);
  }

  getDefinitionCount(): number {
    return getDefinitionCount(this.ctx);
  }

  getDefinitions(): WorkflowDefinition[] {
    return getDefinitions(this.ctx);
  }

  /** Returns the source `enabled` value for a definition that has been runtime-overridden, or undefined if no override is active. */
  getDefinitionSourceEnabled(name: string): boolean | undefined {
    return getDefinitionSourceEnabled(this.ctx, name);
  }

  disableWorkflow(name: string): { ok: boolean; notFound?: boolean } {
    return disableWorkflow(this.ctx, name);
  }

  enableWorkflow(name: string): { ok: boolean; notFound?: boolean } {
    return enableWorkflow(this.ctx, name);
  }

  getState(): WorkflowRuntimeState & {
    queueLength: number;
    agentConcurrency: number;
    codeConcurrency: number;
  } {
    return getRuntimeState(this.ctx);
  }
}

export { WorkflowDefinitionError };
