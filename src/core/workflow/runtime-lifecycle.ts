import { installAwaitResumers } from "./awaits-resume.js";
import {
  type AwaitSuspension,
  scanSuspensions,
} from "./awaits-store.js";
import { dismissSupersededWorkflowDeadLetters } from "./dead-letter-supersession.js";
import { isWithinDispatchWindow, msUntilDispatchWindowOpens } from "./dispatch-window.js";
import type { WorkflowEventBatchManager } from "./event-batches.js";
import {
  WorkflowRunMetadataAuthorityError,
  WorkflowRunMetadataEnumerationError,
  workflowRunMetadataAuthorityCriticalIds,
  workflowRunMetadataOperationallyActiveIds,
  workflowRunMetadataTerminalIds,
} from "./run-metadata.js";
import type { RunStateDatabase } from "./run-state-database.js";
import {
  emitIdleEvent,
  loadDefinitions as loadDefinitionsViaDispatch,
  maybeStartNext,
  type WorkflowRuntimeDispatchState,
} from "./runtime-dispatch.js";
import { handleRuntimeEvent } from "./runtime-events.js";
import type { ScopeRuntimeStateStore } from "./scope-runtime-state.js";
import type { WatchTriggerManager } from "./watch-triggers.js";

export const WORKFLOW_STOP_ABORT_WAIT_MS = 15_000;
export type WorkflowDispatchPauseMode = "runtime" | "persistent";
export type WorkflowRuntimeInitialDispatch = "active" | "paused";

export interface WorkflowRuntimeLifecycleState extends WorkflowRuntimeDispatchState {
  scopeId: string;
  scopeState: ScopeRuntimeStateStore;
  runState: RunStateDatabase;
  watchTriggers: WatchTriggerManager;
  eventBatches: WorkflowEventBatchManager;
  awaitResumeDisposers: Array<() => void>;
  // Mutable lifecycle slots. Owned by start/stop.
  idleTimer: ReturnType<typeof setInterval> | null;
  stopBus: (() => void) | null;
}

export function startRuntime(
  state: WorkflowRuntimeLifecycleState,
  initialDispatch: WorkflowRuntimeInitialDispatch,
): void {
  if (state.stopBus || state.idleTimer) return;
  state.stopping = false;
  state.dispatchPaused =
    initialDispatch === "paused" || state.scopeState.getDispatchPaused();
  // Keep this scope closed until definitions, triggers, and durable resumers
  // are ready. Other scopes may continue filling shared capacity.
  state.runCoordinator.pauseScopeAdmission(state.scopeId);
  state.lastIdleEventSignature = undefined;
  state.lastIdleEventEmittedAtMs = undefined;

  try {
    const durableRuns = state.runState.listRuns(state.scopeId);
    const pendingPublications = state.runState.listPendingPublicationHeads()
      .filter((publication) => publication.scopeId === state.scopeId);
    const authorityCriticalRunIds = workflowRunMetadataAuthorityCriticalIds(
      durableRuns,
      pendingPublications,
    );
    const operationallyActiveRunIds =
      workflowRunMetadataOperationallyActiveIds(durableRuns);
    const terminalRunIds = workflowRunMetadataTerminalIds(durableRuns);
    state.store.pruneRuns({
      protectedRunIds: new Set([
        ...durableRuns
          .filter((run) =>
            run.state === "queued" ||
            operationallyActiveRunIds.has(run.id)
          )
          .map((run) => run.id),
        ...authorityCriticalRunIds,
      ]),
      authorityCriticalRunIds,
      operationallyActiveRunIds,
      terminalRunIds,
    });
  } catch (error) {
    if (
      error instanceof WorkflowRunMetadataAuthorityError ||
      error instanceof WorkflowRunMetadataEnumerationError
    ) {
      throw error;
    }
    state.log(
      `Workflow run pruning failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  state.definitions = loadDefinitionsViaDispatch(state);
  const supersededBackoff = state.backoff.getSupersededRuntime();
  if (supersededBackoff !== null) {
    state.wfQueue.releaseAgentRunsDeferredUntil(supersededBackoff.until);
    state.backoff.clear(
      `after runtime changed from ${supersededBackoff.runtimeId}`,
    );
  }
  if (state.deadLetterQueue !== undefined) {
    dismissSupersededWorkflowDeadLetters({
      deadLetterQueue: state.deadLetterQueue,
      runStore: state.store,
      log: state.log,
    });
  }
  state.wfQueue.restorePending();
  const activeAgentBackoff = state.backoff.getActive();
  if (activeAgentBackoff) {
    state.log(
      `Agent dispatch backoff active until ${new Date(activeAgentBackoff.until).toLocaleString()} (${activeAgentBackoff.kind})`,
    );
  }

  // Filtered wildcard so each per-scope workflow runtime only handles its
  // own events (and daemon-wide events that have no `scopeId`). Without
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

  if (!state.dispatchPaused) {
    state.runCoordinator.resumeScopeAdmission(state.scopeId);
  }
  maybeStartNext(state);

  state.idleTimer = setInterval(() => {
    void emitIdleEvent(state);
  }, state.idleIntervalMs);
  state.idleTimer.unref();

  void emitIdleEvent(state);
}

/** Persisted await-event work remains drain-relevant while its resumer is idle. */
export function listAwaitEventSuspensions(
  state: Pick<WorkflowRuntimeLifecycleState, "store">,
): AwaitSuspension[] {
  return scanSuspensions(state.store.runsDir).map(({ suspension }) => suspension);
}

export async function stopRuntime(
  state: WorkflowRuntimeLifecycleState,
  gracePeriodMs: number,
  abortWaitMs: number,
): Promise<void> {
  state.stopping = true;
  state.dispatchPaused = true;
  state.runCoordinator.pauseScopeAdmission(state.scopeId);

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

  if (state.idleSignatureCheck !== undefined) {
    await state.idleSignatureCheck;
  }

  if (!state.runCoordinator.isScopeBusy(state.scopeId)) return;

  const waitForActiveRuns = state.runCoordinator
    .whenScopeIdle(state.scopeId)
    .then(() => "completed" as const);

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
    state.runCoordinator.cancelScope(state.scopeId);
  }, gracePeriodMs);
  graceTimer.unref();

  try {
    const result = await Promise.race([waitForActiveRuns, abortWaitExpired]);
    if (result === "abort-timeout") {
      state.log(
        `Workflow runtime stop gave up waiting for ${state.runCoordinator.activeRunIdsForScope(state.scopeId).length} active run(s) after abort`,
      );
    }
  } finally {
    clearTimeout(graceTimer);
    if (abortWaitTimer) clearTimeout(abortWaitTimer);
  }
}

export function isBusy(state: WorkflowRuntimeLifecycleState): boolean {
  return state.runCoordinator.isScopeBusy(state.scopeId);
}

export function isDispatchPaused(state: WorkflowRuntimeLifecycleState): boolean {
  return (
    state.dispatchPaused ||
    state.runCoordinator.isGlobalAdmissionPaused() ||
    state.runCoordinator.isScopeAdmissionPaused(state.scopeId)
  );
}

export function setDispatchPaused(
  state: WorkflowRuntimeLifecycleState,
  paused: boolean,
  mode: WorkflowDispatchPauseMode,
): void {
  if (mode === "persistent") {
    state.scopeState.setDispatchPaused(paused);
  }
  state.dispatchPaused = paused;
  if (paused) state.runCoordinator.pauseScopeAdmission(state.scopeId);
  else state.runCoordinator.resumeScopeAdmission(state.scopeId);
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
