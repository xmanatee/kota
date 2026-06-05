import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installAwaitResumers } from "./awaits-resume.js";
import { isWithinDispatchWindow, msUntilDispatchWindowOpens } from "./dispatch-window.js";
import type { WorkflowEventBatchManager } from "./event-batches.js";
import {
  emitIdleEvent,
  loadDefinitions as loadDefinitionsViaDispatch,
  maybeStartNext,
  type WorkflowRuntimeDispatchState,
} from "./runtime-dispatch.js";
import { handleRuntimeEvent } from "./runtime-events.js";
import { queueInterruptedRunRecovery, queueRecovery } from "./runtime-recovery.js";
import { PAUSE_SIGNAL_FILE } from "./runtime-signals.js";
import type { WatchTriggerManager } from "./watch-triggers.js";

export const WORKFLOW_STOP_ABORT_WAIT_MS = 15_000;
export type WorkflowDispatchPauseMode = "runtime" | "persistent";

export interface WorkflowRuntimeLifecycleState extends WorkflowRuntimeDispatchState {
  watchTriggers: WatchTriggerManager;
  eventBatches: WorkflowEventBatchManager;
  awaitResumeDisposers: Array<() => void>;
  // Mutable lifecycle slots. Owned by start/stop.
  idleTimer: ReturnType<typeof setInterval> | null;
  stopBus: (() => void) | null;
}

export function startRuntime(state: WorkflowRuntimeLifecycleState): void {
  if (state.stopBus || state.idleTimer) return;
  state.stopping = false;
  state.dispatchPaused = false;
  state.lastIdleEventSignature = undefined;
  state.lastIdleEventEmittedAtMs = undefined;

  try {
    state.store.pruneRuns();
  } catch (error) {
    state.log(
      `Workflow run pruning failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const interrupted = state.store.recoverInterruptedRuns();
  for (const run of interrupted) {
    state.log(`Recovered interrupted workflow run ${run.id} for "${run.workflow}"`);
  }
  if (interrupted.length > 0) {
    state.log(
      `${interrupted.length} run${interrupted.length === 1 ? "" : "s"} marked interrupted from previous session.`,
    );
    const reason = "Interrupted: daemon restarted while run was in progress.";
    for (const run of interrupted) {
      const text = `Workflow interrupted: *${run.workflow}*\nRun: \`${run.id}\`\nReason: ${reason}`;
      state.pbus.emit("workflow.interrupted.alert", {
        workflow: run.workflow,
        runId: run.id,
        durationMs: run.durationMs ?? 0,
        reason,
        text,
      });
    }
  }

  state.definitions = loadDefinitionsViaDispatch(state);
  state.wfQueue.restorePending();
  queueInterruptedRunRecovery(state, interrupted);
  queueRecovery(state);
  const activeAgentBackoff = state.backoff.getActive();
  if (activeAgentBackoff) {
    state.log(
      `Agent dispatch backoff active until ${new Date(activeAgentBackoff.until).toLocaleString()} (${activeAgentBackoff.kind})`,
    );
  }

  // Filtered wildcard so each per-project workflow runtime only handles its
  // own events (and daemon-wide events that have no `projectId`). Without
  // this filter, project A's `workflow.completed` would queue any
  // `workflow.completed`-triggered workflow in project B too.
  state.stopBus = state.pbus.onAny((envelope) => {
    handleRuntimeEvent(state, envelope);
  });

  state.scheduleTriggers.setup(state.definitions);
  state.eventBatches.setup(state.definitions);
  state.watchTriggers.setup(state.definitions, (handler) =>
    state.runtimeConfig.bus.on("file.changed", handler),
  );

  // After interrupted-run recovery and definition load, replay any
  // persisted await-event suspensions. The resumers either queue a resume
  // immediately (delivered.json present, or deadline passed during the
  // gap) or register a one-shot bus listener that queues a resume on
  // first match.
  installAwaitResumers({
    bus: state.runtimeConfig.bus,
    store: state.store,
    definitions: state.definitions,
    log: (msg) => state.log(msg),
    appendResumeRun: (queued) => state.wfQueue.appendResumeRun(queued),
    onScheduled: () => maybeStartNext(state),
    disposers: state.awaitResumeDisposers,
  });

  maybeStartNext(state);

  state.idleTimer = setInterval(() => {
    emitIdleEvent(state);
  }, state.idleIntervalMs);
  state.idleTimer.unref();

  emitIdleEvent(state);
}

export async function stopRuntime(
  state: WorkflowRuntimeLifecycleState,
  gracePeriodMs: number,
  abortWaitMs: number,
): Promise<void> {
  state.stopping = true;

  if (state.idleTimer) {
    clearInterval(state.idleTimer);
    state.idleTimer = null;
  }
  if (state.stopBus) {
    state.stopBus();
    state.stopBus = null;
  }
  for (const dispose of state.awaitResumeDisposers.splice(0)) {
    try {
      dispose();
    } catch (error) {
      state.log(
        `Workflow await resumer cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  state.scheduleTriggers.clearAll();
  state.eventBatches.clearAll();
  state.watchTriggers.clearAll();

  if (state.activeRuns.size === 0) return;

  const promises = [...state.activeRuns.values()].map((r) => r.promise);
  const waitForActiveRuns = Promise.all(promises).then(() => "completed" as const);

  if (gracePeriodMs === 0) {
    await waitForActiveRuns;
    return;
  }

  let abortWaitTimer: ReturnType<typeof setTimeout> | undefined;
  const abortWaitExpired = new Promise<"abort-timeout">((resolve) => {
    abortWaitTimer = setTimeout(() => resolve("abort-timeout"), gracePeriodMs + abortWaitMs);
    abortWaitTimer.unref();
  });

  const graceTimer = setTimeout(() => {
    for (const { abortController } of state.activeRuns.values()) {
      abortController.abort();
    }
  }, gracePeriodMs);
  graceTimer.unref();

  try {
    const result = await Promise.race([waitForActiveRuns, abortWaitExpired]);
    if (result === "abort-timeout") {
      state.log(
        `Workflow runtime stop gave up waiting for ${state.activeRuns.size} active run(s) after abort`,
      );
    }
  } finally {
    clearTimeout(graceTimer);
    if (abortWaitTimer) clearTimeout(abortWaitTimer);
  }
}

export function isBusy(state: WorkflowRuntimeLifecycleState): boolean {
  return state.activeRuns.size > 0;
}

export function isDispatchPaused(state: WorkflowRuntimeLifecycleState): boolean {
  return (
    state.dispatchPaused ||
    existsSync(join(state.projectDir, ".kota", PAUSE_SIGNAL_FILE))
  );
}

export function setDispatchPaused(
  state: WorkflowRuntimeLifecycleState,
  paused: boolean,
  mode: WorkflowDispatchPauseMode,
): void {
  if (mode === "persistent") {
    const stateDir = join(state.projectDir, ".kota");
    const pausePath = join(stateDir, PAUSE_SIGNAL_FILE);
    if (paused) {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(pausePath, "");
    } else {
      rmSync(pausePath, { force: true });
    }
  }
  state.dispatchPaused = paused;
  if (!paused) maybeStartNext(state);
}

export function getDispatchWindowStatus(
  state: WorkflowRuntimeLifecycleState,
): { blocked: boolean; opensAt?: string } {
  const window = state.config?.scheduler?.dispatchWindow;
  if (!window) return { blocked: false };
  if (isWithinDispatchWindow(window)) return { blocked: false };
  const msUntil = msUntilDispatchWindowOpens(window);
  const opensAt = new Date(Date.now() + msUntil).toISOString();
  return { blocked: true, opensAt };
}
