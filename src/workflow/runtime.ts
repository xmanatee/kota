import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "../config.js";
import type { BusEnvelope, EventBus } from "../event-bus.js";
import { callTelegramApi } from "../telegram-client.js";
import { AgentBackoffManager } from "./agent-backoff.js";
import { getBuiltinWorkflowDefinitions } from "./registry.js";
import { executeWorkflowRun } from "./run-executor.js";
import { matchesFilter } from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import { ScheduleTriggerManager } from "./schedule-triggers.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowRunExecutionResult,
  WorkflowRunTrigger,
  WorkflowRuntimeState,
} from "./types.js";
import {
  validateWorkflowDefinitions,
  WorkflowDefinitionError,
} from "./validation.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

export const ABORT_SIGNAL_FILE = "abort-request";
export const PAUSE_SIGNAL_FILE = "dispatch-paused";
export const RELOAD_SIGNAL_FILE = "definitions-reload-request";

const DEFAULT_IDLE_INTERVAL_MS = 30_000;

export type WorkflowRuntimeConfig = {
  bus: EventBus;
  projectDir?: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  idleIntervalMs?: number;
  /**
   * Maximum number of workflows that may run simultaneously.
   * Different workflows can overlap up to this limit; the same workflow is
   * always serialised (at most one active instance per workflow name).
   * Defaults to 1 (no concurrency) so existing deployments are unaffected.
   */
  maxConcurrentRuns?: number;
  onLog?: (message: string) => void;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
};

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
  private budgetPausedDate: string | null = null;
  private stopping = false;

  constructor(private readonly runtimeConfig: WorkflowRuntimeConfig) {
    this.projectDir = runtimeConfig.projectDir ?? process.cwd();
    this.store = new WorkflowRunStore(this.projectDir);
    this.idleIntervalMs =
      runtimeConfig.idleIntervalMs ?? DEFAULT_IDLE_INTERVAL_MS;
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
      (def) => this.workflowUsesAgent(def),
      (msg) => this.log(msg),
    );
    this.wfQueue = new WorkflowQueueManager({
      store: this.store,
      getActiveBackoff: () => this.backoff.getActive(),
      shouldSuppressBackoff: (def) => this.backoff.shouldSuppress(def),
      workflowUsesAgent: (def) => this.workflowUsesAgent(def),
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

  private workflowUsesAgent(definition: WorkflowDefinition): boolean {
    return definition.steps.some((step) => step.type === "agent");
  }

  private loadDefinitions(): WorkflowDefinition[] {
    const definitions = this.workflowInputs ?? getBuiltinWorkflowDefinitions();
    const validated = validateWorkflowDefinitions(definitions, this.projectDir);
    this.store.setDefinitionsLoadedAt(new Date().toISOString());
    return validated;
  }

  private emitIdleEvent(): void {
    this.checkAbortSignal();
    this.checkReloadSignal();
    this.maybeStartNext(); // pick up queued items that were held by pause
    if (this.stopping || this.activeRuns.size > 0 || this.wfQueue.length > 0) return;
    this.runtimeConfig.bus.emit("runtime.idle", {
      timestamp: new Date().toISOString(),
      idleIntervalMs: this.idleIntervalMs,
    });
  }

  private checkReloadSignal(): void {
    const signalPath = join(this.projectDir, ".kota", RELOAD_SIGNAL_FILE);
    if (!existsSync(signalPath)) return;
    try {
      rmSync(signalPath);
    } catch {
      // ignore cleanup errors
    }
    try {
      const newDefinitions = this.loadDefinitions();
      this.scheduleTriggers.reconcile(newDefinitions);
      this.definitions = newDefinitions;
      this.log(`Workflow definitions reloaded (${newDefinitions.length} definition(s))`);
    } catch (err) {
      this.log(`Failed to reload workflow definitions: ${(err as Error).message}`);
    }
  }

  private checkAbortSignal(): void {
    const signalPath = join(this.projectDir, ".kota", ABORT_SIGNAL_FILE);
    if (!existsSync(signalPath)) return;
    try {
      rmSync(signalPath);
    } catch {
      // ignore cleanup errors
    }
    if (this.activeRuns.size > 0) {
      this.log("Abort signal received — aborting active run(s)");
      for (const { abortController } of this.activeRuns.values()) {
        abortController.abort();
      }
    }
  }

  private handleEvent(envelope: BusEnvelope): void {
    if (this.stopping) return;

    for (const definition of this.definitions) {
      if (!definition.enabled) continue;
      for (const trigger of definition.triggers) {
        if (trigger.event !== envelope.type) continue;
        if (!matchesFilter(trigger.filter, envelope.payload)) continue;
        // Shallow-copy the payload so each queued run owns its own object
        // reference — safeJsonStringify treats shared references as circular.
        this.wfQueue.enqueue(definition, trigger, {
          event: envelope.type,
          payload: { ...envelope.payload },
        });
      }
    }

    this.maybeStartNext();
  }

  private maybeStartNext(): void {
    if (this.stopping || this.dispatchPaused) return;
    if (existsSync(join(this.projectDir, ".kota", PAUSE_SIGNAL_FILE))) return;

    const budget = this.config?.dailyBudgetUsd;
    if (budget != null) {
      const todayUtc = new Date().toISOString().slice(0, 10);
      if (this.budgetPausedDate) {
        if (this.budgetPausedDate === todayUtc) return;
        this.budgetPausedDate = null;
      }
      const dailySpend = this.store.getDailySpendUsd();
      if (dailySpend >= budget) {
        this.budgetPausedDate = todayUtc;
        this.sendBudgetAlert(dailySpend, budget);
        return;
      }
    }

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
        this.workflowUsesAgent(definition) &&
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

  private sendBudgetAlert(dailySpend: number, budget: number): void {
    this.log(`Daily budget of $${budget.toFixed(4)} reached ($${dailySpend.toFixed(4)} spent). Dispatch paused until tomorrow (UTC).`);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
    if (!token || !chatId) return;
    const text = [
      "Daily cost budget reached.",
      `Spent: $${dailySpend.toFixed(4)}`,
      `Budget: $${budget.toFixed(4)}`,
      "Workflow dispatch paused until tomorrow (UTC).",
    ].join("\n");
    void callTelegramApi(token, "sendMessage", { chat_id: chatId, text }).catch(
      (err: unknown) => {
        this.log(`Failed to send budget alert: ${(err as Error).message}`);
      },
    );
  }

  private log(message: string): void {
    if (!this.verbose && !this.onLog) return;
    this.onLog?.(message);
  }
}

export { WorkflowDefinitionError };
