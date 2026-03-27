import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "../config.js";
import type { BusEnvelope } from "../event-bus.js";
import { AgentBackoffManager } from "./agent-backoff.js";
import { BudgetGuard } from "./budget-guard.js";
import { getBuiltinWorkflowDefinitions } from "./registry.js";
import { executeWorkflowRun } from "./run-executor.js";
import {
  enqueueMatchingWorkflows,
  workflowUsesAgent,
} from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunExecutionResult, WorkflowRuntimeState } from "./run-types.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import {
  ABORT_SIGNAL_FILE,
  checkAbortSignal,
  checkReloadSignal,
  PAUSE_SIGNAL_FILE,
  RELOAD_SIGNAL_FILE,
} from "./runtime-signals.js";
import { ScheduleTriggerManager } from "./schedule-triggers.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowRunTrigger,
} from "./types.js";
import {
  validateWorkflowDefinitions,
  WorkflowDefinitionError,
} from "./validation.js";
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
    const definitions = this.workflowInputs ?? getBuiltinWorkflowDefinitions();
    const validated = validateWorkflowDefinitions(definitions, this.projectDir);
    this.store.setDefinitionsLoadedAt(new Date().toISOString());
    return validated;
  }

  private emitIdleEvent(): void {
    checkAbortSignal(this.projectDir, this.activeRuns, (msg) => this.log(msg));
    checkReloadSignal(
      this.projectDir,
      () => this.loadDefinitions(),
      (defs) => {
        this.scheduleTriggers.reconcile(defs);
        this.definitions = defs;
      },
      (msg) => this.log(msg),
    );
    this.maybeStartNext(); // pick up queued items that were held by pause
    if (this.stopping || this.activeRuns.size > 0 || this.wfQueue.length > 0) return;
    this.runtimeConfig.bus.emit("runtime.idle", {
      timestamp: new Date().toISOString(),
      idleIntervalMs: this.idleIntervalMs,
    });
  }

  private handleEvent(envelope: BusEnvelope): void {
    if (this.stopping) return;
    enqueueMatchingWorkflows(envelope, this.definitions, (def, trigger, run) =>
      this.wfQueue.enqueue(def, trigger, run));
    this.maybeStartNext();
  }

  private maybeStartNext(): void {
    if (this.stopping || this.dispatchPaused) return;
    if (existsSync(join(this.projectDir, ".kota", PAUSE_SIGNAL_FILE))) return;

    const budget = this.config?.dailyBudgetUsd;
    if (budget != null && this.budgetGuard.check(this.store, budget, (msg) => this.log(msg))) return;

    while (this.activeRuns.size < this.maxConcurrentRuns) {
      const queued = this.wfQueue.pick();
      if (!queued) break;

      const definition = this.definitions.find((d) => d.name === queued.workflowName);
      if (!definition) continue;

      this.log(`Dispatching workflow "${queued.workflowName}"`);
      void this.runWorkflow(definition, queued.trigger);
    }
  }

  private async runWorkflow(
    definition: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
  ): Promise<void> {
    const { promise, abortController } = executeWorkflowRun(definition, trigger, {
      projectDir: this.projectDir,
      bus: this.runtimeConfig.bus,
      store: this.store,
      model: this.model,
      config: this.config,
      log: (message) => this.log(message),
    });
    this.activeRuns.set(definition.name, { promise, abortController });

    try {
      const result = await promise;
      if (result.agentBackoff) {
        this.backoff.apply(result.agentBackoff);
        return;
      }
      if (
        workflowUsesAgent(definition) &&
        (result.metadata.status === "success" ||
          result.metadata.status === "completed-with-warnings")
      ) {
        this.backoff.clear();
      }
    } finally {
      this.activeRuns.delete(definition.name);
      this.maybeStartNext();
    }
  }

  private log(message: string): void {
    if (!this.verbose && !this.onLog) return;
    this.onLog?.(message);
  }
}

export { WorkflowDefinitionError };
