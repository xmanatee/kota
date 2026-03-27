import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "../config.js";
import type { BusEnvelope } from "../event-bus.js";
import { AgentBackoffManager } from "./agent-backoff.js";
import { BudgetGuard } from "./budget-guard.js";
import { enqueueMatchingWorkflows, workflowUsesAgent } from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunExecutionResult, WorkflowRuntimeState } from "./run-types.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import {
  emitIdleEvent,
  loadDefinitions,
  maybeStartNext,
  runWorkflow,
  type WorkflowRuntimeDispatchState,
} from "./runtime-dispatch.js";
import {
  ABORT_SIGNAL_FILE,
  PAUSE_SIGNAL_FILE,
  RELOAD_SIGNAL_FILE,
} from "./runtime-signals.js";
import { ScheduleTriggerManager } from "./schedule-triggers.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowRunTrigger,
} from "./types.js";
import { WorkflowDefinitionError } from "./validation.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

export type { WorkflowRuntimeConfig };
export { ABORT_SIGNAL_FILE, PAUSE_SIGNAL_FILE, RELOAD_SIGNAL_FILE };

export class WorkflowRuntime {
  private readonly projectDir: string;
  private readonly store: WorkflowRunStore;
  private readonly idleIntervalMs: number;
  private readonly maxConcurrentRuns: number;
  private readonly model?: string;
  private readonly config?: KotaConfig;
  private readonly verbose: boolean;
  private readonly onLog?: (message: string) => void;
  private readonly workflowInputs?: readonly RegisteredWorkflowDefinitionInput[];
  private readonly backoff: AgentBackoffManager;
  private readonly scheduleTriggers: ScheduleTriggerManager;
  private readonly budgetGuard = new BudgetGuard();

  private definitions: WorkflowDefinition[] = [];
  private readonly wfQueue: WorkflowQueueManager;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private stopBus: (() => void) | null = null;
  /**
   * Active runs keyed by workflow name.
   * Same-workflow serialisation is enforced by never dispatching a workflow
   * that already has an entry here.
   */
  private activeRuns: Map<
    string,
    { promise: Promise<WorkflowRunExecutionResult>; abortController: AbortController }
  > = new Map();
  private dispatchPaused = false;
  private stopping = false;

  constructor(private readonly runtimeConfig: WorkflowRuntimeConfig) {
    this.projectDir = runtimeConfig.projectDir ?? process.cwd();
    this.store = new WorkflowRunStore(this.projectDir);
    this.idleIntervalMs = runtimeConfig.idleIntervalMs ?? 30_000;
    this.maxConcurrentRuns = runtimeConfig.maxConcurrentRuns ?? 1;
    this.model = runtimeConfig.model;
    this.config = runtimeConfig.config;
    this.verbose = runtimeConfig.verbose ?? false;
    this.onLog = runtimeConfig.onLog;
    this.workflowInputs = runtimeConfig.workflows;
    this.backoff = new AgentBackoffManager(
      this.store,
      () => this.wfQueue.getRuns(),
      (q) => { this.wfQueue.setRuns(q); },
      () => this.wfQueue.persist(),
      () => this.definitions,
      (def) => workflowUsesAgent(def),
      (msg) => this.log(msg),
    );
    this.wfQueue = new WorkflowQueueManager({
      store: this.store,
      getActiveBackoff: () => this.backoff.getActive(),
      getWorkflowBudgetPauseUntil: (name) => this.store.getWorkflowBudgetPauseUntil(name),
      shouldSuppressBackoff: (def) => this.backoff.shouldSuppress(def),
      workflowUsesAgent,
      isActiveRun: (name) => this.activeRuns.has(name),
      getDefinitions: () => this.definitions,
      log: (msg) => this.log(msg),
    });
    this.scheduleTriggers = new ScheduleTriggerManager(
      this.store,
      () => this.stopping,
      (def, trigger, run) => this.wfQueue.enqueue(def, trigger, run),
      () => this.maybeStartNext(),
    );
  }

  start(): void {
    if (this.stopBus || this.idleTimer) return;
    this.stopping = false;
    this.dispatchPaused = false;

    try {
      this.store.pruneRuns();
    } catch {
      // pruning errors must not prevent startup
    }

    const interrupted = this.store.recoverInterruptedRuns();
    for (const run of interrupted) {
      this.log(
        `Recovered interrupted workflow run ${run.id} for "${run.workflow}"`,
      );
    }

    this.definitions = this.loadDefinitions();
    this.wfQueue.restorePending();
    const activeAgentBackoff = this.backoff.getActive();
    if (activeAgentBackoff) {
      this.log(
        `Agent dispatch backoff active until ${new Date(activeAgentBackoff.until).toLocaleString()} (${activeAgentBackoff.kind})`,
      );
    }

    this.stopBus = this.runtimeConfig.bus.on("*", (envelope) => {
      this.handleEvent(envelope);
    });

    this.scheduleTriggers.setup(this.definitions);
    this.maybeStartNext();

    this.idleTimer = setInterval(() => {
      this.emitIdleEvent();
    }, this.idleIntervalMs);
    this.idleTimer.unref();

    this.emitIdleEvent();
  }

  async stop(timeoutMs = 30_000): Promise<void> {
    this.stopping = true;

    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.stopBus) {
      this.stopBus();
      this.stopBus = null;
    }
    this.scheduleTriggers.clearAll();

    if (this.activeRuns.size === 0) return;

    for (const { abortController } of this.activeRuns.values()) {
      abortController.abort();
    }

    const abortTimer = setTimeout(() => {
      for (const { abortController } of this.activeRuns.values()) {
        abortController.abort();
      }
    }, timeoutMs);
    abortTimer.unref();

    try {
      await Promise.all(
        [...this.activeRuns.values()].map((r) => r.promise),
      );
    } finally {
      clearTimeout(abortTimer);
    }
  }

  isBusy(): boolean {
    return this.activeRuns.size >= this.maxConcurrentRuns;
  }

  isDispatchPaused(): boolean {
    return this.dispatchPaused || existsSync(join(this.projectDir, ".kota", PAUSE_SIGNAL_FILE));
  }

  setDispatchPaused(paused: boolean): void {
    this.dispatchPaused = paused;
    if (!paused) this.maybeStartNext();
  }

  abortActiveRuns(): { aborted: number } {
    const count = this.activeRuns.size;
    for (const { abortController } of this.activeRuns.values()) {
      abortController.abort();
    }
    return { aborted: count };
  }

  reloadWorkflowDefinitions(): { count: number } {
    const defs = this.loadDefinitions();
    this.scheduleTriggers.reconcile(defs);
    this.definitions = defs;
    return { count: defs.length };
  }

  getDefinitionCount(): number {
    return this.definitions.length;
  }

  getState(): WorkflowRuntimeState & { queueLength: number } {
    const state = this.store.readState();
    return {
      ...state,
      queueLength: this.wfQueue.length,
    };
  }

  private loadDefinitions(): WorkflowDefinition[] {
    return loadDefinitions(this as unknown as WorkflowRuntimeDispatchState);
  }

  private emitIdleEvent(): void {
    emitIdleEvent(this as unknown as WorkflowRuntimeDispatchState);
  }

  private handleEvent(envelope: BusEnvelope): void {
    if (this.stopping) return;
    enqueueMatchingWorkflows(envelope, this.definitions, (def, trigger, run) =>
      this.wfQueue.enqueue(def, trigger, run));
    maybeStartNext(this as unknown as WorkflowRuntimeDispatchState);
  }

  private maybeStartNext(): void {
    maybeStartNext(this as unknown as WorkflowRuntimeDispatchState);
  }

  private async runWorkflow(
    definition: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
  ): Promise<void> {
    return runWorkflow(this as unknown as WorkflowRuntimeDispatchState, definition, trigger);
  }

  private log(message: string): void {
    if (!this.verbose && !this.onLog) return;
    this.onLog?.(message);
  }
}

export { WorkflowDefinitionError };
