import { getNextCronTime } from "./cron.js";
import { type DispatchWindow, isWithinDispatchWindow, msUntilDispatchWindowOpens } from "./dispatch-window.js";
import type { WorkflowRuntimeSummary } from "./runtime-state-types.js";
import type { WorkflowRunTrigger, WorkflowTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export class ScheduleTriggerManager {
  private readonly timers: Map<
    string,
    {
      timer: ReturnType<typeof setTimeout>;
      nextFireMs: number;
      schedule?: string;
      timezone?: string;
      intervalMs?: number;
    }
  > = new Map();

  constructor(
    private readonly readSummary: () => WorkflowRuntimeSummary,
    private readonly isStopping: () => boolean,
    private readonly enqueueRun: (
      definition: WorkflowDefinition,
      trigger: WorkflowTrigger,
      runTrigger: WorkflowRunTrigger,
    ) => void,
    private readonly maybeStartNext: () => void,
    private readonly getDispatchWindow: () => DispatchWindow | undefined = () => undefined,
    private readonly isDefaultScopeRuntime: () => boolean = () => true,
  ) {}

  clearAll(): void {
    for (const { timer } of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  nextScheduledAt(): Map<string, string> {
    const projected = new Map<string, string>();
    for (const [key, timer] of this.timers) {
      const workflow = key.slice(0, key.lastIndexOf(":"));
      const value = new Date(timer.nextFireMs).toISOString();
      const current = projected.get(workflow);
      if (current === undefined || value < current) projected.set(workflow, value);
    }
    return projected;
  }

  setup(definitions: WorkflowDefinition[]): void {
    this.clearAll();
    this.reconcile(definitions);
  }

  scheduleNextFire(
    key: string,
    definition: WorkflowDefinition,
    trigger: WorkflowTrigger,
    nextFireMs: number,
  ): void {
    const previous = this.timers.get(key);
    if (previous) clearTimeout(previous.timer);
    // Node turns overflowing delays into 1 ms waits. Bound each wait while
    // retaining the deadline for projection and the early-wakeup guard below.
    const delay = Math.min(2_147_483_647, Math.max(0, nextFireMs - Date.now()));
    const timer = setTimeout(() => {
      if (this.isStopping() || this.timers.get(key)?.timer !== timer) return;
      const now = Date.now();
      if (now < nextFireMs) {
        this.scheduleNextFire(key, definition, trigger, nextFireMs);
        return;
      }

      // Interval triggers (not cron) respect the dispatch window.
      if (trigger.intervalMs != null) {
        const dispatchWindow = this.getDispatchWindow();
        if (dispatchWindow && !isWithinDispatchWindow(dispatchWindow)) {
          const waitMs = msUntilDispatchWindowOpens(dispatchWindow);
          this.scheduleNextFire(key, definition, trigger, now + waitMs);
          return;
        }
      }

      // Advance before admission: synchronous reloads must see the following
      // occurrence, and a retired callback must never re-arm after admission.
      const nextMs = trigger.intervalMs != null
        ? now + trigger.intervalMs
        : getNextCronTime(
          trigger.schedule!,
          new Date(Math.max(now, nextFireMs)),
          trigger.timezone,
        )?.getTime();
      if (nextMs === undefined) this.timers.delete(key);
      else this.scheduleNextFire(key, definition, trigger, nextMs);

      this.enqueueRun(definition, trigger, {
        event: trigger.event,
        schemaRef: null,
        payload: {
          ...trigger.payload,
          scheduledAt: new Date(now).toISOString(),
        },
      });
      this.maybeStartNext();
    }, delay);
    timer.unref();

    this.timers.set(key, {
      timer, nextFireMs,
      schedule: trigger.schedule,
      timezone: trigger.timezone,
      intervalMs: trigger.intervalMs,
    });
  }

  reconcile(newDefinitions: WorkflowDefinition[]): void {
    const newKeys = new Set<string>();
    for (const definition of newDefinitions) {
      if (!definition.enabled) continue;
      for (let i = 0; i < definition.triggers.length; i++) {
        const trigger = definition.triggers[i];
        if (!trigger.schedule && trigger.intervalMs == null) continue;
        if (!this.shouldRunInThisRuntime(trigger)) continue;
        newKeys.add(`${definition.name}:${i}`);
      }
    }

    for (const [key, { timer }] of this.timers) {
      if (!newKeys.has(key)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    }
    const state = this.readSummary();
    for (const definition of newDefinitions) {
      if (!definition.enabled) continue;
      for (let i = 0; i < definition.triggers.length; i++) {
        const trigger = definition.triggers[i];
        if (!trigger.schedule && trigger.intervalMs == null) continue;
        if (!this.shouldRunInThisRuntime(trigger)) continue;
        const key = `${definition.name}:${i}`;
        const previous = this.timers.get(key);
        // Retain timing progress while refreshing the definition and payload
        // captured by the callback, including edits outside the trigger itself.
        if (previous && previous.schedule === trigger.schedule
          && (previous.timezone ?? "UTC") === (trigger.timezone ?? "UTC")
          && previous.intervalMs === trigger.intervalMs) {
          this.scheduleNextFire(key, definition, trigger, previous.nextFireMs);
          continue;
        }
        if (previous) {
          clearTimeout(previous.timer);
          this.timers.delete(key);
        }

        let nextFireMs: number;
        if (trigger.intervalMs != null) {
          const lastCompleted = state.workflows[definition.name]?.lastCompletion?.completedAt;
          if (lastCompleted) {
            const due = new Date(lastCompleted).getTime() + trigger.intervalMs;
            nextFireMs = due > Date.now() ? due : Date.now();
          } else {
            nextFireMs = Date.now();
          }
        } else {
          const next = getNextCronTime(trigger.schedule!, new Date(), trigger.timezone);
          if (!next) continue;
          nextFireMs = next.getTime();
        }
        this.scheduleNextFire(key, definition, trigger, nextFireMs);
      }
    }
  }

  private shouldRunInThisRuntime(trigger: WorkflowTrigger): boolean {
    return trigger.runOn !== "default-scope" || this.isDefaultScopeRuntime();
  }

}
