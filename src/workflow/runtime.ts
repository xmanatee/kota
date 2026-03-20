import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "../config.js";
import type { BusEnvelope, EventBus } from "../event-bus.js";
import { callTelegramApi } from "../telegram-client.js";
import { getNextCronTime } from "./cron.js";
import { getBuiltinWorkflowDefinitions } from "./registry.js";
import {
  executeWorkflowRun,
  getEligibleAtMs,
  matchesFilter,
} from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowQueuedRun,
  WorkflowRunTrigger,
  WorkflowRuntimeState,
  WorkflowTrigger,
} from "./types.js";
import {
  validateWorkflowDefinitions,
  WorkflowDefinitionError,
} from "./validation.js";

export const ABORT_SIGNAL_FILE = "abort-request";
export const PAUSE_SIGNAL_FILE = "dispatch-paused";

const DEFAULT_IDLE_INTERVAL_MS = 30_000;

export type WorkflowRuntimeConfig = {
  bus: EventBus;
  projectDir?: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  idleIntervalMs?: number;
  onLog?: (message: string) => void;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
};

export class WorkflowRuntime {
  private readonly projectDir: string;
  private readonly store: WorkflowRunStore;
  private readonly idleIntervalMs: number;
  private readonly model?: string;
  private readonly config?: KotaConfig;
  private readonly verbose: boolean;
  private readonly onLog?: (message: string) => void;
  private readonly workflowInputs?: readonly RegisteredWorkflowDefinitionInput[];

  private definitions: WorkflowDefinition[] = [];
  private queue: WorkflowQueuedRun[] = [];
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private stopBus: (() => void) | null = null;
  private activeWorkflowName: string | null = null;
  private activeAbortController: AbortController | null = null;
  private activeRunPromise: Promise<void> | null = null;
  private dispatchPaused = false;
  private budgetPausedDate: string | null = null;
  private stopping = false;
  private scheduleTimers: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; nextFireMs: number }
  > = new Map();

  constructor(private readonly runtimeConfig: WorkflowRuntimeConfig) {
    this.projectDir = runtimeConfig.projectDir ?? process.cwd();
    this.store = new WorkflowRunStore(this.projectDir);
    this.idleIntervalMs =
      runtimeConfig.idleIntervalMs ?? DEFAULT_IDLE_INTERVAL_MS;
    this.model = runtimeConfig.model;
    this.config = runtimeConfig.config;
    this.verbose = runtimeConfig.verbose ?? false;
    this.onLog = runtimeConfig.onLog;
    this.workflowInputs = runtimeConfig.workflows;
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

    const interrupted = this.store.recoverInterruptedRun();
    if (interrupted) {
      this.log(
        `Recovered interrupted workflow run ${interrupted.id} for "${interrupted.workflow}"`,
      );
    }

    this.definitions = this.loadDefinitions();
    this.restorePendingQueue();

    this.stopBus = this.runtimeConfig.bus.on("*", (envelope) => {
      this.handleEvent(envelope);
    });

    this.setupScheduleTriggers();
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
    for (const { timer } of this.scheduleTimers.values()) {
      clearTimeout(timer);
    }
    this.scheduleTimers.clear();

    if (!this.activeRunPromise) return;

    this.activeAbortController?.abort();
    const abortTimer = setTimeout(() => {
      this.activeAbortController?.abort();
    }, timeoutMs);
    abortTimer.unref();

    try {
      await this.activeRunPromise;
    } finally {
      clearTimeout(abortTimer);
    }
  }

  isBusy(): boolean {
    return this.activeRunPromise !== null;
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
      queueLength: this.queue.length,
    };
  }

  private loadDefinitions(): WorkflowDefinition[] {
    const definitions = this.workflowInputs ?? getBuiltinWorkflowDefinitions();
    return validateWorkflowDefinitions(definitions, this.projectDir);
  }

  private setupScheduleTriggers(): void {
    const state = this.store.readState();
    for (const definition of this.definitions) {
      if (!definition.enabled) continue;
      for (let i = 0; i < definition.triggers.length; i++) {
        const trigger = definition.triggers[i];
        if (!trigger.schedule && trigger.intervalMs == null) continue;

        const key = `${definition.name}:${i}`;
        let nextFireMs: number;

        if (trigger.intervalMs != null) {
          const lastCompleted =
            state.workflows[definition.name]?.lastCompletedAt;
          if (lastCompleted) {
            const due =
              new Date(lastCompleted).getTime() + trigger.intervalMs;
            nextFireMs = due > Date.now() ? due : Date.now();
          } else {
            nextFireMs = Date.now();
          }
        } else {
          const next = getNextCronTime(trigger.schedule!, new Date());
          if (!next) continue;
          nextFireMs = next.getTime();
        }

        this.scheduleNextFire(key, definition, trigger, nextFireMs);
      }
    }
  }

  private scheduleNextFire(
    key: string,
    definition: WorkflowDefinition,
    trigger: WorkflowTrigger,
    nextFireMs: number,
  ): void {
    const delay = Math.max(0, nextFireMs - Date.now());
    const timer = setTimeout(() => {
      if (this.stopping) return;
      const now = Date.now();
      this.enqueueRun(definition, trigger, {
        event: "schedule",
        payload: { scheduledAt: new Date(now).toISOString() },
      });
      this.maybeStartNext();

      let nextMs: number;
      if (trigger.intervalMs != null) {
        nextMs = now + trigger.intervalMs;
      } else {
        const next = getNextCronTime(trigger.schedule!, new Date(now));
        if (!next) return;
        nextMs = next.getTime();
      }
      this.scheduleNextFire(key, definition, trigger, nextMs);
    }, delay);
    timer.unref();

    this.scheduleTimers.set(key, { timer, nextFireMs });
    this.store.setWorkflowNextScheduledAt(
      definition.name,
      new Date(nextFireMs).toISOString(),
    );
  }

  private emitIdleEvent(): void {
    this.checkAbortSignal();
    this.maybeStartNext(); // pick up queued items that were held by pause
    if (this.stopping || this.activeRunPromise || this.queue.length > 0) return;
    this.runtimeConfig.bus.emit("runtime.idle", {
      timestamp: new Date().toISOString(),
      idleIntervalMs: this.idleIntervalMs,
    });
  }

  private checkAbortSignal(): void {
    const signalPath = join(this.projectDir, ".kota", ABORT_SIGNAL_FILE);
    if (!existsSync(signalPath)) return;
    try {
      rmSync(signalPath);
    } catch {
      // ignore cleanup errors
    }
    if (this.activeAbortController) {
      this.log("Abort signal received — aborting active run");
      this.activeAbortController.abort();
    }
  }

  private handleEvent(envelope: BusEnvelope): void {
    if (this.stopping) return;

    for (const definition of this.definitions) {
      if (!definition.enabled) continue;
      for (const trigger of definition.triggers) {
        if (trigger.event !== envelope.type) continue;
        if (!matchesFilter(trigger.filter, envelope.payload)) continue;
        this.enqueueRun(definition, trigger, {
          event: envelope.type,
          payload: envelope.payload,
        });
      }
    }

    this.maybeStartNext();
  }

  private restorePendingQueue(): void {
    const state = this.store.readState();
    const validNames = new Set(
      this.definitions
        .filter((definition) => definition.enabled)
        .map((definition) => definition.name),
    );
    this.queue = state.pendingRuns.filter((item) => validNames.has(item.workflowName));
    this.persistQueue();
    if (this.queue.length > 0) {
      this.log(`Recovered ${this.queue.length} queued workflow run(s)`);
    }
  }

  private persistQueue(): void {
    this.store.setPendingRuns(this.queue);
  }

  private enqueueRun(
    definition: WorkflowDefinition,
    triggerConfig: WorkflowDefinition["triggers"][number],
    trigger: WorkflowRunTrigger,
  ): void {
    const existingIndex = this.queue.findIndex(
      (queued) => queued.workflowName === definition.name,
    );
    const state = this.store.readState();
    const queuedRun: WorkflowQueuedRun = {
      workflowName: definition.name,
      trigger,
      enqueuedAtMs:
        existingIndex >= 0
          ? this.queue[existingIndex].enqueuedAtMs
          : Date.now(),
      notBeforeMs: getEligibleAtMs(definition.name, triggerConfig.cooldownMs, state),
    };

    if (existingIndex >= 0) {
      this.queue[existingIndex] = {
        ...queuedRun,
        notBeforeMs: Math.max(
          this.queue[existingIndex].notBeforeMs,
          queuedRun.notBeforeMs,
        ),
      };
      this.log(
        `Updated queued workflow "${definition.name}" with event "${trigger.event}"`,
      );
      this.persistQueue();
      return;
    }

    this.queue.push(queuedRun);
    this.persistQueue();
    this.log(
      `${this.activeWorkflowName === definition.name ? "Queued rerun for" : "Queued"} workflow "${definition.name}" from event "${trigger.event}"`,
    );
  }

  private maybeStartNext(): void {
    if (this.stopping || this.activeRunPromise || this.dispatchPaused) return;
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

    const queued = this.pickQueuedRun();
    if (!queued) return;

    const definition = this.definitions.find((d) => d.name === queued.workflowName);
    if (!definition) return;

    this.log(`Dispatching workflow "${queued.workflowName}"`);
    void this.runWorkflow(definition, queued.trigger);
  }

  private pickQueuedRun(): WorkflowQueuedRun | null {
    const now = Date.now();
    const eligible = this.queue
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.notBeforeMs <= now)
      .sort((a, b) => a.item.enqueuedAtMs - b.item.enqueuedAtMs);

    if (eligible.length === 0) return null;
    const picked = eligible[0];
    this.queue.splice(picked.index, 1);
    this.persistQueue();
    return picked.item;
  }

  private async runWorkflow(
    definition: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
  ): Promise<void> {
    const { promise, abortController } = executeWorkflowRun(
      definition,
      trigger,
      {
        projectDir: this.projectDir,
        bus: this.runtimeConfig.bus,
        store: this.store,
        model: this.model,
        config: this.config,
        log: (message) => this.log(message),
      },
      () => {
        this.activeWorkflowName = null;
        this.activeAbortController = null;
        this.activeRunPromise = null;
        this.maybeStartNext();
      },
    );
    this.activeWorkflowName = definition.name;
    this.activeAbortController = abortController;
    this.activeRunPromise = promise;
    await promise;
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
