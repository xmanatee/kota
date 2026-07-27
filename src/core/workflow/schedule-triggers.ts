import { getNextCronTime } from "./cron.js";
import { type DispatchWindow, isWithinDispatchWindow, msUntilDispatchWindowOpens } from "./dispatch-window.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunTrigger, WorkflowTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export class ScheduleTriggerManager {
  private readonly timers: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; nextFireMs: number }
  > = new Map();

  constructor(
    private readonly store: WorkflowRunStore,
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

  setup(definitions: WorkflowDefinition[]): void {
    this.clearInactiveScheduleState(definitions);
    const state = this.store.readState();
    for (const definition of definitions) {
      if (!definition.enabled) continue;
      for (let i = 0; i < definition.triggers.length; i++) {
        const trigger = definition.triggers[i];
        if (!trigger.schedule && trigger.intervalMs == null) continue;
        if (!this.shouldRunInThisRuntime(trigger)) continue;

        const key = `${definition.name}:${i}`;
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

  scheduleNextFire(
    key: string,
    definition: WorkflowDefinition,
    trigger: WorkflowTrigger,
    nextFireMs: number,
  ): void {
    const delay = Math.max(0, nextFireMs - Date.now());
    const timer = setTimeout(() => {
      if (this.isStopping()) return;
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

      this.enqueueRun(definition, trigger, {
        event: trigger.event,
        schemaRef: null,
        payload: {
          ...trigger.payload,
          scheduledAt: new Date(now).toISOString(),
        },
      });
      this.maybeStartNext();

      let nextMs: number;
      if (trigger.intervalMs != null) {
        nextMs = now + trigger.intervalMs;
      } else {
        const next = getNextCronTime(
          trigger.schedule!,
          new Date(Math.max(now, nextFireMs)),
          trigger.timezone,
        );
        if (!next) return;
        nextMs = next.getTime();
      }
      this.scheduleNextFire(key, definition, trigger, nextMs);
    }, delay);
    timer.unref();

    this.timers.set(key, { timer, nextFireMs });
    this.store.setWorkflowNextScheduledAt(
      definition.name,
      new Date(nextFireMs).toISOString(),
    );
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
    this.clearInactiveScheduleState(newDefinitions);

    const state = this.store.readState();
    for (const definition of newDefinitions) {
      if (!definition.enabled) continue;
      for (let i = 0; i < definition.triggers.length; i++) {
        const trigger = definition.triggers[i];
        if (!trigger.schedule && trigger.intervalMs == null) continue;
        if (!this.shouldRunInThisRuntime(trigger)) continue;
        const key = `${definition.name}:${i}`;
        if (this.timers.has(key)) continue;

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

  private clearInactiveScheduleState(definitions: WorkflowDefinition[]): void {
    const state = this.store.readState();
    for (const definition of definitions) {
      const hasSchedule = definition.enabled && definition.triggers.some(
        (trigger) =>
          (trigger.schedule !== undefined || trigger.intervalMs !== undefined) &&
          this.shouldRunInThisRuntime(trigger),
      );
      if (
        !hasSchedule &&
        state.workflows[definition.name]?.nextScheduledAt !== undefined
      ) {
        this.store.setWorkflowNextScheduledAt(definition.name, undefined);
      }
    }
  }
}
