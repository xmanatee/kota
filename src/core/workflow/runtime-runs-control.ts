import {
  buildDeadLetterEventEnvelope,
  buildDeadLetterWorkflowTrigger,
} from "./dead-letter-redrive.js";
import { buildOperatorQueuedRun, type WorkflowEnqueueOptions } from "./operator-trigger.js";
import { formatRunId } from "./run-io.js";
import { maybeStartNext, type WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WebhookRunPayload } from "./workflow-dispatcher-provider.js";

export type WorkflowRuntimeRunsControlState = WorkflowRuntimeDispatchState;

export type QueuedRunCancellation = {
  ok: boolean;
  notFound?: boolean;
  active?: boolean;
  preserved?: boolean;
  blockers?: string[];
};

export function abortActiveRuns(state: WorkflowRuntimeRunsControlState): { aborted: number } {
  return {
    aborted: state.runCoordinator.cancelScope(state.runtimeConfig.scopeId),
  };
}

export function abortActiveRun(
  state: WorkflowRuntimeRunsControlState,
  runId: string,
): { ok: boolean; notFound?: boolean; queued?: boolean } {
  if (
    state.runCoordinator
      .activeRunIdsForScope(state.runtimeConfig.scopeId)
      .includes(runId)
  ) {
    return state.runCoordinator.cancel(runId).cancelled
      ? { ok: true }
      : { ok: false, notFound: true };
  }
  const isQueued = state.wfQueue.getRuns().some((r) => r.runId === runId);
  if (isQueued) return { ok: false, queued: true };
  return { ok: false, notFound: true };
}

export function enqueuePendingRun(
  state: WorkflowRuntimeRunsControlState,
  name: string,
  options: WorkflowEnqueueOptions = {},
): {
  ok: boolean;
  queued?: string;
  runId?: string;
  alreadyQueued?: boolean;
  error?: string;
} {
  const definition = state.definitions.find((d) => d.name === name);
  if (!definition) return { ok: false, error: `Unknown workflow "${name}"` };
  if (!definition.enabled) return { ok: false, error: `Workflow "${name}" is disabled` };
  if (
    options.runId === undefined &&
    state.wfQueue.getRuns().some((r) => r.workflowName === name)
  ) {
    return { ok: false, alreadyQueued: true };
  }
  const queuedRun = buildOperatorQueuedRun(name, options);
  const disposition = state.wfQueue.appendRun(queuedRun);
  if (disposition === null) {
    return {
      ok: false,
      error: `Workflow "${name}" could not be admitted because its trigger, durable resources, or dispatch identity conflict`,
    };
  }
  maybeStartNext(state);
  return { ok: true, queued: name, runId: disposition.runId };
}

export function enqueueWebhookRun(
  state: WorkflowRuntimeRunsControlState,
  name: string,
  webhookPayload: WebhookRunPayload,
): { ok: boolean; runId?: string; alreadyRunning?: boolean; error?: string } {
  const definition = state.definitions.find((d) => d.name === name);
  if (!definition) return { ok: false, error: `Unknown workflow "${name}"` };
  if (!definition.enabled) return { ok: false, error: `Workflow "${name}" is disabled` };
  if (!definition.triggers.some((t) => t.webhook === true)) {
    return { ok: false, error: `Workflow "${name}" has no webhook trigger` };
  }
  const runId = formatRunId(name);
  const now = Date.now();
  const trigger: WorkflowRunTrigger = {
    event: "webhook",
    schemaRef: null,
    payload: { ...webhookPayload, _runId: runId },
  };
  const disposition = state.wfQueue.appendRun({
    runId,
    workflowName: name,
    trigger,
    enqueuedAtMs: now,
    notBeforeMs: now,
  });
  if (disposition === null) {
    return {
      ok: false,
      error: `Workflow "${name}" could not be admitted because its durable resources or dispatch identity conflict`,
    };
  }
  maybeStartNext(state);
  return { ok: true, runId: disposition.runId };
}

export function cancelQueuedRun(
  state: WorkflowRuntimeRunsControlState,
  runId: string,
): QueuedRunCancellation {
  const result = state.wfQueue.cancel(runId);
  const { cancelled } = result;
  if (cancelled) return { ok: true };
  if (result.reason === "sandbox-preserved") {
    return { ok: false, preserved: true, blockers: result.blockers };
  }
  const isActive = state.runCoordinator
    .activeRunIdsForScope(state.runtimeConfig.scopeId)
    .includes(runId);
  if (isActive) return { ok: false, active: true };
  return { ok: false, notFound: true };
}

export function redriveDeadLetter(
  state: WorkflowRuntimeRunsControlState,
  id: string,
  reason: string,
  target: "original" | "simulation",
): {
  ok: boolean;
  reason?: "not_found" | "not_redrivable" | "unknown_workflow" | "admission_rejected";
  runId?: string;
  workflowName?: string;
  event?: string;
} {
  const store = state.deadLetterQueue;
  if (store === undefined) return { ok: false, reason: "not_found" };
  const item = store.get(id);
  if (item === null) return { ok: false, reason: "not_found" };
  if (item.status !== "open") {
    store.recordRedriveAttempt(id, {
      target,
      reason,
      result: {
        status: "failed",
        message: `dead-letter item is ${item.status}`,
      },
    });
    return { ok: false, reason: "not_redrivable" };
  }
  if (target === "simulation") {
    store.recordRedriveAttempt(id, {
      target,
      reason,
      result: { status: "simulated" },
    });
    return { ok: true };
  }
  if (item.redrive.kind === "workflow") {
    const redrive = item.redrive;
    const definition = state.definitions.find(
      (candidate) => candidate.name === redrive.workflowName,
    );
    if (!definition?.enabled) {
      store.recordRedriveAttempt(id, {
        target,
        reason,
        result: {
          status: "failed",
          message: `workflow "${redrive.workflowName}" is not available`,
        },
      });
      return { ok: false, reason: "unknown_workflow" };
    }
    const now = Date.now();
    const runId = formatRunId(redrive.workflowName);
    const resolved = buildDeadLetterWorkflowTrigger(item, redrive, {
      runStore: state.store,
      eventJournal: state.eventJournal,
      runId,
      reason,
      nowMs: now,
    });
    if (!resolved.ok) {
      store.recordRedriveAttempt(id, {
        target,
        reason,
        result: { status: "failed", message: resolved.message },
      });
      return { ok: false, reason: "not_redrivable" };
    }
    const disposition = state.wfQueue.appendRun({
      runId,
      workflowName: redrive.workflowName,
      trigger: resolved.value,
      enqueuedAtMs: now,
      notBeforeMs: now,
    });
    if (disposition === null || disposition.status === "duplicate") {
      store.recordRedriveAttempt(id, {
        target,
        reason,
        result: {
          status: "failed",
          message: disposition === null
            ? "workflow redrive admission was rejected"
            : `workflow redrive resolved to existing run "${disposition.runId}"`,
        },
      });
      return { ok: false, reason: "admission_rejected" };
    }
    store.recordRedriveAttempt(id, {
      target,
      reason,
      result: {
        status: "queued",
        runId: disposition.runId,
        workflowName: redrive.workflowName,
      },
    });
    maybeStartNext(state);
    return {
      ok: true,
      runId: disposition.runId,
      workflowName: redrive.workflowName,
    };
  }
  if (item.redrive.kind === "event") {
    const resolved = buildDeadLetterEventEnvelope(item, item.redrive, {
      eventJournal: state.eventJournal,
      reason,
      nowMs: Date.now(),
    });
    if (!resolved.ok) {
      store.recordRedriveAttempt(id, {
        target,
        reason,
        result: { status: "failed", message: resolved.message },
      });
      return { ok: false, reason: "not_redrivable" };
    }
    state.pbus.emitDynamic(resolved.value.type, resolved.value.payload);
    store.recordRedriveAttempt(id, {
      target,
      reason,
      result: { status: "emitted", event: resolved.value.type },
    });
    return { ok: true, event: resolved.value.type };
  }
  store.recordRedriveAttempt(id, {
    target,
    reason,
    result: { status: "failed", message: item.redrive.reason },
  });
  return { ok: false, reason: "not_redrivable" };
}
