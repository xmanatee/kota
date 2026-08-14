import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { getRepoWorktreeStatusAsync } from "#core/util/repo-worktree.js";
import type { AgentBackoffManager } from "./agent-backoff.js";
import { dismissSupersededWorkflowDeadLetters } from "./dead-letter-supersession.js";
import { isWithinDispatchWindow } from "./dispatch-window.js";
import { executeWorkflowRun } from "./run-executor.js";
import { runHasSuccessfulAgentExecution } from "./run-executor-utils.js";
import { formatRunId } from "./run-io.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunExecutionResult } from "./run-types.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import { canDispatchDefinition } from "./runtime-dispatch-concurrency.js";
import { recordFailedWorkflowDispatchDeadLetter } from "./runtime-dispatch-dead-letter.js";
import { loadDefinitions } from "./runtime-dispatch-definitions.js";
import { handleDirtyCompletion } from "./runtime-dispatch-dirty-recovery.js";
import { triggerWorkflowFromStep } from "./runtime-dispatch-trigger.js";
import { getIdleEventSignature } from "./runtime-idle-signature.js";
import { checkAbortSignal, checkReloadSignal, PAUSE_SIGNAL_FILE } from "./runtime-signals.js";
import { runTerminalFinalizer } from "./runtime-terminal-finalizer.js";
import type { ScheduleTriggerManager } from "./schedule-triggers.js";
import type { AgentRunLimiter } from "./steps/agent-run-limiter.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import type { WorkflowQueueManager } from "./workflow-queue.js";

export { loadDefinitions, resolveDefinitions } from "./runtime-dispatch-definitions.js";

export const IDLE_UNCHANGED_REEMIT_MS = 30 * 60 * 1000;

export type WorkflowActiveRunReservation = {
  runId: string;
  workflowName: string;
  promise: Promise<WorkflowRunExecutionResult>;
  abortController: AbortController;
};

export interface WorkflowRuntimeDispatchState {
  projectDir: string;
  workspaceDir?: string;
  stopping: boolean;
  dispatchPaused: boolean;
  config?: KotaConfig;
  store: WorkflowRunStore;
  deadLetterQueue?: DeadLetterQueueStore;
  eventJournal?: EventJournal;
  approvalQueue: ApprovalQueue;
  idempotencyStore: IdempotencyStore;
  wfQueue: WorkflowQueueManager;
  definitions: WorkflowDefinition[];
  scheduleTriggers: ScheduleTriggerManager;
  pbus: ProjectScopedEventBus;
  activeRuns: Map<string, WorkflowActiveRunReservation>;
  backoff: AgentBackoffManager;
  /** Max concurrent agent-step workflow runs. Default 1. */
  agentConcurrency: number;
  agentRunLimiter: AgentRunLimiter;
  /** Max concurrent code-only workflow runs. Default 4. */
  codeConcurrency: number;
  runtimeConfig: WorkflowRuntimeConfig;
  model?: string;
  idleIntervalMs: number;
  lastIdleEventSignature?: string;
  lastIdleEventEmittedAtMs?: number;
  idleSignatureCheck?: Promise<string>;
  workflowInputs?: readonly RegisteredWorkflowDefinitionInput[];
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  log(message: string): void;
}

function workspaceDirFor(state: WorkflowRuntimeDispatchState): string {
  return state.workspaceDir ?? state.runtimeConfig.workspaceDir ?? state.projectDir;
}

export async function emitIdleEvent(
  state: WorkflowRuntimeDispatchState,
): Promise<void> {
  checkAbortSignal(state.projectDir, state.activeRuns, (msg) => state.log(msg));
  checkReloadSignal(
    state.projectDir,
    () => loadDefinitions(state),
    (defs) => {
      state.scheduleTriggers.reconcile(defs);
      state.definitions = defs;
    },
    (msg) => state.log(msg),
  );
  maybeStartNext(state);
  const idleTriggerAlreadyQueued = state.wfQueue
    .getRuns()
    .some((run) => run.trigger.event === "runtime.idle");
  if (state.stopping || state.activeRuns.size > 0 || idleTriggerAlreadyQueued) return;
  const dispatchWindow = state.config?.scheduler?.dispatchWindow;
  if (dispatchWindow && !isWithinDispatchWindow(dispatchWindow)) return;
  if (state.idleSignatureCheck !== undefined) return;
  const initialEmission = state.lastIdleEventEmittedAtMs === undefined;
  if (initialEmission) {
    state.lastIdleEventEmittedAtMs = Date.now();
    state.pbus.emit("runtime.idle", {
      timestamp: new Date().toISOString(),
      idleIntervalMs: state.idleIntervalMs,
    });
  }
  const workspaceDir = workspaceDirFor(state);
  const idleSignatureCheck = getIdleEventSignature(state.projectDir, workspaceDir);
  state.idleSignatureCheck = idleSignatureCheck;
  let signature: string;
  try {
    signature = await idleSignatureCheck;
  } finally {
    state.idleSignatureCheck = undefined;
  }
  if (initialEmission) {
    state.lastIdleEventSignature = signature;
    return;
  }
  const triggerQueuedDuringInspection = state.wfQueue
    .getRuns()
    .some((run) => run.trigger.event === "runtime.idle");
  if (state.stopping || state.activeRuns.size > 0 || triggerQueuedDuringInspection) {
    return;
  }
  const now = Date.now();
  const recentlyEmittedUnchanged =
    state.lastIdleEventSignature === signature &&
    state.lastIdleEventEmittedAtMs !== undefined &&
    now - state.lastIdleEventEmittedAtMs < IDLE_UNCHANGED_REEMIT_MS;
  if (recentlyEmittedUnchanged) return;
  state.lastIdleEventSignature = signature;
  state.lastIdleEventEmittedAtMs = now;
  state.pbus.emit("runtime.idle", {
    timestamp: new Date().toISOString(),
    idleIntervalMs: state.idleIntervalMs,
  });
}

export function maybeStartNext(
  state: WorkflowRuntimeDispatchState,
  immediatePreRunFingerprint?: string,
): void {
  if (state.stopping || state.dispatchPaused) return;
  if (existsSync(join(state.projectDir, ".kota", PAUSE_SIGNAL_FILE))) return;

  let queued: ReturnType<typeof state.wfQueue.pick>;
  while ((queued = state.wfQueue.pick((def) => canDispatchDefinition(state, def)))) {
    const definition = state.definitions.find((d) => d.name === queued!.workflowName);
    if (!definition) continue;

    state.log(`Dispatching workflow "${queued!.workflowName}"`);
    void runWorkflow(
      state,
      definition,
      queued!.trigger,
      queued!.runId,
      immediatePreRunFingerprint,
    );
    immediatePreRunFingerprint = undefined;
  }
}

export async function runWorkflow(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
  runId?: string,
  immediatePreRunFingerprint?: string,
): Promise<void> {
  const workspaceDir = workspaceDirFor(state);
  const abortController = new AbortController();
  const reservedRunId = runId ?? formatRunId(definition.name);
  let resolveReservation!: (value: WorkflowRunExecutionResult) => void;
  let rejectReservation!: (reason?: Error) => void;
  const reservationPromise = new Promise<WorkflowRunExecutionResult>((resolve, reject) => {
    resolveReservation = resolve;
    rejectReservation = reject;
  });
  const reservation: WorkflowActiveRunReservation = {
    runId: reservedRunId,
    workflowName: definition.name,
    promise: reservationPromise,
    abortController,
  };
  state.activeRuns.set(reservedRunId, reservation);
  const preRunFingerprint =
    immediatePreRunFingerprint ??
    (await getRepoWorktreeStatusAsync(workspaceDir)).fingerprint;
  let nextPreRunFingerprint: string | undefined;
  const releaseReservation = () => {
    state.activeRuns.delete(reservedRunId);
  };
  const { promise } = executeWorkflowRun(
    definition,
    trigger,
    {
      projectDir: state.projectDir,
      workspaceDir,
      authorityConfigPath: state.runtimeConfig.authorityConfigPath,
      bus: state.runtimeConfig.bus,
      pbus: state.pbus,
      store: state.store,
      ...(state.deadLetterQueue !== undefined
        ? { deadLetterQueue: state.deadLetterQueue }
        : {}),
      eventJournal: state.eventJournal,
      approvalQueue: state.approvalQueue,
      idempotencyStore: state.idempotencyStore,
      model: state.model,
      config: state.config,
      log: (message) => state.log(message),
      triggerWorkflow: (workflowName, payload, waitFor, signal) =>
        triggerWorkflowFromStep(
          state,
          () => maybeStartNext(state),
          workflowName,
          payload,
          waitFor,
          signal,
        ),
      resolveAgentDef: state.resolveAgentDef,
      resolveSkillsPrompt: state.resolveSkillsPrompt,
      scopePolicyAuthority: state.runtimeConfig.scopePolicyAuthority,
      agentRunLimiter: state.agentRunLimiter,
      runId: reservedRunId,
    },
    abortController,
  );
  try {
    const result = await promise;
    if (result.agentBackoff) {
      state.backoff.apply(result.agentBackoff);
    }
    recordFailedWorkflowDispatchDeadLetter(
      state,
      definition,
      trigger,
      result.metadata,
      result.agentBackoff?.kind,
    );
    if (
      state.deadLetterQueue !== undefined &&
      (result.metadata.status === "success" ||
        result.metadata.status === "completed-with-warnings")
    ) {
      dismissSupersededWorkflowDeadLetters({
        deadLetterQueue: state.deadLetterQueue,
        runStore: state.store,
        successfulRun: result.metadata,
        log: state.log,
      });
    }
    const completedWorktree = await handleDirtyCompletion(
      state,
      definition,
      result.metadata,
      preRunFingerprint,
    );
    if (
      completedWorktree.available &&
      !completedWorktree.dirty &&
      state.activeRuns.size === 1 &&
      definition.terminalFinalizer === undefined
    ) {
      nextPreRunFingerprint = completedWorktree.fingerprint;
    }
    resolveReservation(result);
    releaseReservation();
    await runTerminalFinalizer(
      state,
      definition,
      trigger,
      result.metadata,
      workspaceDir,
      result.agentBackoff?.kind,
    );
    if (
      !result.agentBackoff &&
      runHasSuccessfulAgentExecution(result.metadata.steps)
    ) {
      state.backoff.clear();
    }
  } catch (error) {
    rejectReservation(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    releaseReservation();
    maybeStartNext(state, nextPreRunFingerprint);
  }
}
