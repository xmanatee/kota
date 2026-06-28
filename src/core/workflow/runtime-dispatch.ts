import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import {
  createWorkflowDispatchDeadLetter,
  type DeadLetterQueueStore,
} from "#core/daemon/dead-letter-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { AgentBackoffManager } from "./agent-backoff.js";
import { isWithinDispatchWindow } from "./dispatch-window.js";
import { executeWorkflowRun } from "./run-executor.js";
import { workflowUsesAgent } from "./run-executor-utils.js";
import { formatRunId } from "./run-io.js";
import type { WorkflowRunStore } from "./run-store.js";
import type {
  WorkflowRunExecutionResult,
  WorkflowRunMetadata,
  WorkflowStepResult,
} from "./run-types.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import { canDispatchDefinition } from "./runtime-dispatch-concurrency.js";
import { loadDefinitions } from "./runtime-dispatch-definitions.js";
import { handleDirtyCompletion } from "./runtime-dispatch-dirty-recovery.js";
import { triggerWorkflowFromStep } from "./runtime-dispatch-trigger.js";
import { checkAbortSignal, checkReloadSignal, PAUSE_SIGNAL_FILE } from "./runtime-signals.js";
import type { ScheduleTriggerManager } from "./schedule-triggers.js";
import type { WorkflowStep } from "./step-types.js";
import type { AgentRunLimiter } from "./steps/agent-run-limiter.js";
import { DEFAULT_AGENT_STEP_RETRY } from "./steps/step-executor-retry.js";
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
  workflowInputs?: readonly RegisteredWorkflowDefinitionInput[];
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  log(message: string): void;
}

function getIdleEventSignature(projectDir: string, workspaceDir: string): string {
  const worktree = getRepoWorktreeStatus(projectDir);
  const workspaceWorktree =
    workspaceDir === projectDir ? worktree : getRepoWorktreeStatus(workspaceDir);
  return [
    "project",
    worktree.available ? "git" : "no-git",
    worktree.headSha,
    worktree.fingerprint,
    "workspace",
    workspaceWorktree.available ? "git" : "no-git",
    workspaceWorktree.headSha,
    workspaceWorktree.fingerprint,
  ].join("\0");
}

function workspaceDirFor(state: WorkflowRuntimeDispatchState): string {
  return state.workspaceDir ?? state.runtimeConfig.workspaceDir ?? state.projectDir;
}

export function emitIdleEvent(state: WorkflowRuntimeDispatchState): void {
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
  const workspaceDir = workspaceDirFor(state);
  const signature = getIdleEventSignature(state.projectDir, workspaceDir);
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

export function maybeStartNext(state: WorkflowRuntimeDispatchState): void {
  if (state.stopping || state.dispatchPaused) return;
  if (existsSync(join(state.projectDir, ".kota", PAUSE_SIGNAL_FILE))) return;

  let queued: ReturnType<typeof state.wfQueue.pick>;
  while ((queued = state.wfQueue.pick((def) => canDispatchDefinition(state, def)))) {
    const definition = state.definitions.find((d) => d.name === queued!.workflowName);
    if (!definition) continue;

    state.log(`Dispatching workflow "${queued!.workflowName}"`);
    void runWorkflow(state, definition, queued!.trigger, queued!.runId);
  }
}

export async function runWorkflow(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
  runId?: string,
): Promise<void> {
  const workspaceDir = workspaceDirFor(state);
  const preRunFingerprint = getRepoWorktreeStatus(workspaceDir).fingerprint;
  // Claim the concurrency slot synchronously BEFORE executeWorkflowRun runs.
  // executeWorkflowRun emits `workflow.started` on the bus synchronously; the
  // wildcard handler re-enters `maybeStartNext` on the same call stack. Until
  // this workflow is present in `activeRuns`, the cap check sees zero active
  // agent runs and a second agent workflow can dispatch past the cap.
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
  const { promise } = executeWorkflowRun(
    definition,
    trigger,
    {
      projectDir: state.projectDir,
      workspaceDir,
      bus: state.runtimeConfig.bus,
      pbus: state.pbus,
      store: state.store,
      ...(state.deadLetterQueue !== undefined
        ? { deadLetterQueue: state.deadLetterQueue }
        : {}),
      eventJournal: state.eventJournal,
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
      agentRunLimiter: state.agentRunLimiter,
      runId: reservedRunId,
    },
    abortController,
  );
  promise.then(resolveReservation, rejectReservation);

  try {
    const result = await promise;
    recordFailedWorkflowDispatchDeadLetter(state, definition, trigger, result.metadata);
    handleDirtyCompletion(state, definition, result.metadata, preRunFingerprint);
    if (result.agentBackoff) {
      state.backoff.apply(result.agentBackoff);
      return;
    }
    if (
      workflowUsesAgent(definition) &&
      (result.metadata.status === "success" ||
        result.metadata.status === "completed-with-warnings")
    ) {
      state.backoff.clear();
    }
  } finally {
    state.activeRuns.delete(reservedRunId);
    maybeStartNext(state);
  }
}

function recordFailedWorkflowDispatchDeadLetter(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
  metadata: WorkflowRunMetadata,
): void {
  if (metadata.status !== "failed") return;
  if (state.deadLetterQueue === undefined) return;
  const failedStep = terminalFailedStep(metadata.steps);
  createWorkflowDispatchDeadLetter({
    store: state.deadLetterQueue,
    scopeId: state.pbus.getScopeId(),
    workflowName: definition.name,
    trigger,
    reason: failedStep?.error ?? `Workflow "${definition.name}" failed`,
    errorClass: "execution",
    failedRun: metadata,
    retryCount: failedStep === undefined ? 1 : retryCountForStep(definition.steps, failedStep),
    owningModule: "workflow-runtime",
  });
}

function terminalFailedStep(
  steps: readonly WorkflowStepResult[],
): WorkflowStepResult | undefined {
  return steps.find((step) => step.status === "failed" && !step.continueOnFailure);
}

function retryCountForStep(
  steps: readonly WorkflowStep[],
  failedStep: WorkflowStepResult,
): number {
  const step = findWorkflowStep(steps, failedStep.id);
  if (step?.type === "agent") return (step.retry ?? DEFAULT_AGENT_STEP_RETRY).maxAttempts;
  if (step?.type === "tool") return step.retry?.maxAttempts ?? 1;
  return 1;
}

function findWorkflowStep(
  steps: readonly WorkflowStep[],
  id: string,
): WorkflowStep | undefined {
  for (const step of steps) {
    if (step.id === id) return step;
    if (step.type === "parallel" || step.type === "foreach") {
      const child = findWorkflowStep(step.steps, id);
      if (child !== undefined) return child;
    }
    if (step.type === "branch") {
      const trueChild = findWorkflowStep(step.ifTrue, id);
      if (trueChild !== undefined) return trueChild;
      const falseChild = findWorkflowStep(step.ifFalse, id);
      if (falseChild !== undefined) return falseChild;
    }
  }
  return undefined;
}
