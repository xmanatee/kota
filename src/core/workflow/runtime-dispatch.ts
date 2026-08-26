import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { resolveEventSchemaReference } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { AgentBackoffManager } from "./agent-backoff.js";
import { dismissSupersededWorkflowDeadLetters } from "./dead-letter-supersession.js";
import { isWithinDispatchWindow } from "./dispatch-window.js";
import { buildWorkflowCompletedPayload } from "./event-payloads.js";
import { readRunCommitMessage } from "./run-commit-message.js";
import type { RunContext } from "./run-context.js";
import type { RunCoordinator } from "./run-coordinator.js";
import { recordEmittedEventEvidence } from "./run-event-evidence.js";
import { executeWorkflowRun } from "./run-executor.js";
import { runHasSuccessfulAgentExecution } from "./run-executor-utils.js";
import { validateWorkflowRunId } from "./run-io.js";
import type { WorkflowExecutionOutcome } from "./run-lifecycle.js";
import type { StoredRun } from "./run-state-database.js";
import type { PendingRunPublication, RunPublication } from "./run-state-types.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import { recordFailedWorkflowDispatchDeadLetter } from "./runtime-dispatch-dead-letter.js";
import { loadDefinitions } from "./runtime-dispatch-definitions.js";
import { triggerWorkflowFromStep } from "./runtime-dispatch-trigger.js";
import { getIdleEventSignature } from "./runtime-idle-signature.js";
import { checkAbortSignal, checkReloadSignal } from "./runtime-signals.js";
import type { WorkflowRunStatus } from "./runtime-state-types.js";
import type { ScheduleTriggerManager } from "./schedule-triggers.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import type { WorkflowQueueManager } from "./workflow-queue.js";

export { loadDefinitions, resolveDefinitions } from "./runtime-dispatch-definitions.js";

export const IDLE_UNCHANGED_REEMIT_MS = 30 * 60 * 1000;

export interface WorkflowRuntimeDispatchState {
  projectDir: string;
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
  backoff: AgentBackoffManager;
  runCoordinator: RunCoordinator;
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

export async function emitIdleEvent(
  state: WorkflowRuntimeDispatchState,
): Promise<void> {
  checkAbortSignal(
    state.projectDir,
    () => state.runCoordinator.cancelProject(state.runtimeConfig.projectId),
    (msg) => state.log(msg),
  );
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
  if (
    state.stopping ||
    state.runCoordinator.isProjectBusy(state.runtimeConfig.projectId) ||
    idleTriggerAlreadyQueued
  ) return;
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
  const idleSignatureCheck = getIdleEventSignature(state.projectDir);
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
  if (
    state.stopping ||
    state.runCoordinator.isProjectBusy(state.runtimeConfig.projectId) ||
    triggerQueuedDuringInspection
  ) {
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
): void {
  if (state.stopping || state.dispatchPaused) return;
  state.runCoordinator.refill();
}

export async function executeAdmittedWorkflowRun(
  state: WorkflowRuntimeDispatchState,
  admitted: StoredRun,
  context: RunContext,
): Promise<WorkflowExecutionOutcome> {
  const definition = state.definitions.find((candidate) => candidate.name === admitted.workflow);
  if (!definition) {
    return {
      kind: "terminal",
      state: "failed",
      error: `Workflow definition "${admitted.workflow}" is not loaded`,
    };
  }
  const abortController = new AbortController();
  const forwardAbort = () => abortController.abort(context.signal.reason);
  if (context.signal.aborted) forwardAbort();
  else context.signal.addEventListener("abort", forwardAbort, { once: true });
  const { promise } = executeWorkflowRun(
    definition,
    admitted.trigger,
    {
      runContext: context,
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
      triggerWorkflow: (workflowName, payload, waitFor, signal, triggerId) =>
        triggerWorkflowFromStep(
          state,
          admitted.id,
          workflowName,
          payload,
          waitFor,
          signal,
          triggerId,
        ),
      resolveAgentDef: state.resolveAgentDef,
      resolveSkillsPrompt: state.resolveSkillsPrompt,
      scopePolicyAuthority: state.runtimeConfig.scopePolicyAuthority,
    },
    abortController,
  );
  try {
    const result = await promise;
    const appliedBackoff = result.agentBackoff
      ? state.backoff.apply(result.agentBackoff)
      : undefined;
    recordFailedWorkflowDispatchDeadLetter(
      state,
      definition,
      admitted.trigger,
      result.metadata,
      result.agentBackoff?.kind,
    );
    if (
      definition.repository !== "write" &&
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
    if (
      !result.agentBackoff &&
      runHasSuccessfulAgentExecution(result.metadata.steps)
    ) {
      state.backoff.clear();
    }
    const successful =
      result.metadata.status === "success" ||
      result.metadata.status === "completed-with-warnings";
    if (!successful && appliedBackoff !== undefined) {
      return {
        kind: "suspended",
        state: "waiting",
        wait: {
          reason: "agent-backoff",
          kind: appliedBackoff.kind,
        },
        error: appliedBackoff.reason,
        resumeAt: appliedBackoff.until,
      };
    }
    const commitMessage = successful && definition.repository === "write"
      ? readRunCommitMessage([
          context.resources.agentDir,
          join(
            state.store.runsDir,
            validateWorkflowRunId(admitted.id, "Admitted workflow run"),
          ),
        ])
      : undefined;
    return successful
      ? {
          kind: "completed",
          ...(commitMessage === undefined ? {} : { commitMessage }),
        }
      : {
          kind: "terminal",
          state: context.signal.aborted ? "cancelled" : "failed",
          ...([...result.metadata.steps].reverse().find((step) => step.error)?.error
            ? {
                error: [...result.metadata.steps]
                  .reverse()
                  .find((step) => step.error)!.error,
              }
            : {}),
        };
  } catch (error) {
    return {
      kind: "terminal",
      state: context.signal.aborted ? "cancelled" : "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    context.signal.removeEventListener("abort", forwardAbort);
  }
}

export function createIntegratedWorkflowPublication(
  state: WorkflowRuntimeDispatchState,
  run: StoredRun,
  status: WorkflowRunStatus,
): Omit<RunPublication, "createdAt" | "deliveredAt"> {
  const definition = state.definitions.find((candidate) => candidate.name === run.workflow);
  const metadata = state.store.getRun(run.id);
  if (!definition || !metadata) {
    throw new Error(`Cannot publish integrated completion for run "${run.id}"`);
  }
  if (metadata.status === "running") {
    throw new Error(`Cannot publish completion for running workflow "${run.id}"`);
  }
  const publicationId = `workflow:${run.id}:completed`;
  return {
    id: publicationId,
    runId: run.id,
    projectId: run.projectId,
    event: "workflow.completed",
    payload: buildWorkflowCompletedPayload(
      metadata,
      status,
      definition.tags,
      undefined,
      definition.defaultAutonomyMode,
      publicationId,
    ),
  };
}

export function deliverIntegratedWorkflowPublication(
  state: WorkflowRuntimeDispatchState,
  publication: PendingRunPublication,
): void {
  state.pbus.deliverOutbox(publication.event, publication.payload, publication.id);
  recordEmittedEventEvidence(join(state.store.runsDir, publication.runId), {
    publicationId: publication.id,
    event: publication.event,
    schemaRef: resolveEventSchemaReference(publication.event),
    payload: publication.payload,
    emittedAt: new Date().toISOString(),
  });
  if (publication.event !== "workflow.completed") return;
  const metadata = state.store.getRun(publication.runId);
  if (!metadata) {
    throw new Error(`Cannot reconcile publication for missing run "${publication.runId}"`);
  }
  if (state.deadLetterQueue !== undefined) {
    dismissSupersededWorkflowDeadLetters({
      deadLetterQueue: state.deadLetterQueue,
      runStore: state.store,
      successfulRun: metadata,
      log: state.log,
    });
  }
}
