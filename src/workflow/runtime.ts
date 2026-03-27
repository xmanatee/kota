import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "../config.js";
import type { BusEnvelope, EventBus } from "../event-bus.js";
import { callTelegramApi } from "../telegram-client.js";
import { getNextCronTime } from "./cron.js";
import { getBuiltinWorkflowDefinitions } from "./registry.js";
import { executeWorkflowRun } from "./run-executor.js";
import { getEligibleAtMs, matchesFilter } from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowAgentBackoffSignal,
  WorkflowAgentBackoffState,
  WorkflowDefinition,
  WorkflowQueuedRun,
  WorkflowRunExecutionResult,
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
export const RELOAD_SIGNAL_FILE = "definitions-reload-request";

const DEFAULT_IDLE_INTERVAL_MS = 30_000;
const MAX_AGENT_BACKOFF_MS = 6 * 60 * 60 * 1000;
const AGENT_BACKOFF_FACTORS: Record<
  WorkflowAgentBackoffState["kind"],
  { initialDelayMs: number; backoffFactor: number }
> = {
  rate_limit: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
  auth: { initialDelayMs: 30 * 60 * 1000, backoffFactor: 2 },
  provider: { initialDelayMs: 5 * 60 * 1000, backoffFactor: 2 },
};

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

  private definitions: WorkflowDefinition[] = [];
  private queue: WorkflowQueuedRun[] = [];
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
  private scheduleTimers: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; nextFireMs: number }
  > = new Map();

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
    this.restorePendingQueue();
    const activeAgentBackoff = this.getActiveAgentBackoff();
    if (activeAgentBackoff) {
      this.log(
        `Agent dispatch backoff active until ${new Date(activeAgentBackoff.until).toLocaleString()} (${activeAgentBackoff.kind})`,
      );
    }

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
      queueLength: this.queue.length,
    };
  }

  private workflowUsesAgent(definition: WorkflowDefinition): boolean {
    return definition.steps.some((step) => step.type === "agent");
  }

  private getActiveAgentBackoff(): WorkflowAgentBackoffState | null {
    const state = this.store.readState();
    const backoff = state.agentBackoff;
    if (!backoff) return null;

    const untilMs = new Date(backoff.until).getTime();
    if (untilMs > Date.now()) return backoff;

    this.store.setAgentBackoff(null);
    this.log(`Agent dispatch backoff expired (${backoff.kind})`);
    return null;
  }

  private dropQueuedAgentWorkflows(): number {
    const nextQueue = this.queue.filter((item) => {
      const definition = this.definitions.find((candidate) => candidate.name === item.workflowName);
      return !definition || !this.workflowUsesAgent(definition);
    });
    const removed = this.queue.length - nextQueue.length;
    if (removed > 0) {
      this.queue = nextQueue;
      this.persistQueue();
    }
    return removed;
  }

  private applyAgentBackoff(signal: WorkflowAgentBackoffSignal): void {
    const current = this.getActiveAgentBackoff();
    const policy = AGENT_BACKOFF_FACTORS[signal.kind];
    const nextFailureCount =
      current && current.kind === signal.kind ? current.failureCount + 1 : 1;
    const delayMs = Math.min(
      MAX_AGENT_BACKOFF_MS,
      Math.round(policy.initialDelayMs * policy.backoffFactor ** (nextFailureCount - 1)),
    );
    const backoff: WorkflowAgentBackoffState = {
      kind: signal.kind,
      failureCount: nextFailureCount,
      until: new Date(Date.now() + delayMs).toISOString(),
      updatedAt: new Date().toISOString(),
      reason: signal.reason,
    };
    this.store.setAgentBackoff(backoff);
    const dropped = this.dropQueuedAgentWorkflows();
    this.log(
      `Agent dispatch backed off until ${new Date(backoff.until).toLocaleString()} (${backoff.kind}, attempt ${backoff.failureCount})`,
    );
    if (dropped > 0) {
      this.log(`Dropped ${dropped} queued agent workflow run(s) during backoff`);
    }
  }

  private clearAgentBackoff(): void {
    const backoff = this.getActiveAgentBackoff();
    if (!backoff) return;
    this.store.setAgentBackoff(null);
    this.log(`Cleared agent dispatch backoff after successful agent run (${backoff.kind})`);
  }

  private shouldSuppressAgentWorkflow(
    definition: WorkflowDefinition,
  ): WorkflowAgentBackoffState | null {
    if (!this.workflowUsesAgent(definition)) return null;
    return this.getActiveAgentBackoff();
  }

  private loadDefinitions(): WorkflowDefinition[] {
    const definitions = this.workflowInputs ?? getBuiltinWorkflowDefinitions();
    const validated = validateWorkflowDefinitions(definitions, this.projectDir);
    this.store.setDefinitionsLoadedAt(new Date().toISOString());
    return validated;
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
    this.checkReloadSignal();
    this.maybeStartNext(); // pick up queued items that were held by pause
    if (this.stopping || this.activeRuns.size > 0 || this.queue.length > 0) return;
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
      this.reconcileScheduleTriggers(newDefinitions);
      this.definitions = newDefinitions;
      this.log(`Workflow definitions reloaded (${newDefinitions.length} definition(s))`);
    } catch (err) {
      this.log(`Failed to reload workflow definitions: ${(err as Error).message}`);
    }
  }

  private reconcileScheduleTriggers(newDefinitions: WorkflowDefinition[]): void {
    // Build the set of keys the new definitions want
    const newKeys = new Set<string>();
    for (const definition of newDefinitions) {
      if (!definition.enabled) continue;
      for (let i = 0; i < definition.triggers.length; i++) {
        const trigger = definition.triggers[i];
        if (!trigger.schedule && trigger.intervalMs == null) continue;
        newKeys.add(`${definition.name}:${i}`);
      }
    }

    // Cancel timers that are no longer needed
    for (const [key, { timer }] of this.scheduleTimers) {
      if (!newKeys.has(key)) {
        clearTimeout(timer);
        this.scheduleTimers.delete(key);
      }
    }

    // Set up timers for new keys (existing ones keep firing on their current schedule)
    const state = this.store.readState();
    for (const definition of newDefinitions) {
      if (!definition.enabled) continue;
      for (let i = 0; i < definition.triggers.length; i++) {
        const trigger = definition.triggers[i];
        if (!trigger.schedule && trigger.intervalMs == null) continue;
        const key = `${definition.name}:${i}`;
        if (this.scheduleTimers.has(key)) continue;

        let nextFireMs: number;
        if (trigger.intervalMs != null) {
          const lastCompleted = state.workflows[definition.name]?.lastCompletedAt;
          if (lastCompleted) {
            const due = new Date(lastCompleted).getTime() + trigger.intervalMs;
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
        this.enqueueRun(definition, trigger, {
          event: envelope.type,
          payload: { ...envelope.payload },
        });
      }
    }

    this.maybeStartNext();
  }

  private restorePendingQueue(): void {
    const state = this.store.readState();
    const activeAgentBackoff = this.getActiveAgentBackoff();
    const validNames = new Set(
      this.definitions
        .filter((definition) => definition.enabled)
        .map((definition) => definition.name),
    );
    this.queue = state.pendingRuns.filter((item) => {
      if (!validNames.has(item.workflowName)) return false;
      if (!activeAgentBackoff) return true;
      const definition = this.definitions.find((candidate) => candidate.name === item.workflowName);
      return !definition || !this.workflowUsesAgent(definition);
    });
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
    const activeAgentBackoff = this.shouldSuppressAgentWorkflow(definition);
    if (activeAgentBackoff) {
      if (trigger.event !== "runtime.idle") {
        this.log(
          `Skipped workflow "${definition.name}" from event "${trigger.event}" during agent backoff (${activeAgentBackoff.kind} until ${new Date(activeAgentBackoff.until).toLocaleTimeString()})`,
        );
      }
      return;
    }

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
      `${this.activeRuns.has(definition.name) ? "Queued rerun for" : "Queued"} workflow "${definition.name}" from event "${trigger.event}"`,
    );
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
      const queued = this.pickQueuedRun();
      if (!queued) break;

      const definition = this.definitions.find((d) => d.name === queued.workflowName);
      if (!definition) continue;

      this.log(`Dispatching workflow "${queued.workflowName}"`);
      void this.runWorkflow(definition, queued.trigger);
    }
  }

  private pickQueuedRun(): WorkflowQueuedRun | null {
    const now = Date.now();
    const activeAgentBackoff = this.getActiveAgentBackoff();
    const eligible = this.queue
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) => {
          if (item.notBeforeMs > now || this.activeRuns.has(item.workflowName)) {
            return false;
          }
          if (!activeAgentBackoff) return true;
          const definition = this.definitions.find((candidate) => candidate.name === item.workflowName);
          return !definition || !this.workflowUsesAgent(definition);
        },
      )
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
        this.applyAgentBackoff(result.agentBackoff);
        return;
      }
      if (
        this.workflowUsesAgent(definition) &&
        (result.metadata.status === "success" ||
          result.metadata.status === "completed-with-warnings")
      ) {
        this.clearAgentBackoff();
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
