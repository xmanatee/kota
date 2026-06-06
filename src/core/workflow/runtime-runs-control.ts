import type {
  IdempotencyJsonObject,
  IdempotencyReservation,
} from "#core/daemon/idempotency-store.js";
import {
  buildDeadLetterEventEnvelope,
  buildDeadLetterWorkflowTrigger,
} from "./dead-letter-redrive.js";
import { formatRunId } from "./run-io.js";
import { maybeStartNext, type WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WebhookRunPayload } from "./workflow-dispatcher-provider.js";
import { workflowDispatchIdempotency } from "./workflow-idempotency.js";


export type WorkflowRuntimeRunsControlState = WorkflowRuntimeDispatchState;

function workflowDispatchResult(
  workflowName: string,
  runId: string,
  triggerEvent: string,
  enqueuedAtMs: number,
): IdempotencyJsonObject {
  return {
    workflowName,
    runId,
    triggerEvent,
    queuedAt: new Date(enqueuedAtMs).toISOString(),
  };
}

function runIdFromWorkflowDispatchResult(result: IdempotencyJsonObject): string {
  const runId = result.runId;
  if (typeof runId !== "string" || runId.trim().length === 0) {
    throw new Error("workflow dispatch idempotency result is missing runId");
  }
  return runId;
}

function isExpiredIdempotencyEntry(expiresAt: string | undefined): boolean {
  if (expiresAt === undefined) return false;
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    throw new Error(`invalid idempotency expiry timestamp: ${expiresAt}`);
  }
  return expiresAtMs <= Date.now();
}

export function abortActiveRuns(state: WorkflowRuntimeRunsControlState): { aborted: number } {
  const count = state.activeRuns.size;
  for (const { abortController } of state.activeRuns.values()) {
    abortController.abort();
  }
  return { aborted: count };
}

export function abortActiveRun(
  state: WorkflowRuntimeRunsControlState,
  runId: string,
): { ok: boolean; notFound?: boolean; queued?: boolean } {
  const runtimeState = state.store.readState();
  const activeEntry = (runtimeState.activeRuns ?? []).find((r) => r.runId === runId);
  if (activeEntry) {
    const inMemory = state.activeRuns.get(activeEntry.workflow);
    if (inMemory) {
      inMemory.abortController.abort();
      return { ok: true };
    }
  }
  const isQueued = state.wfQueue.getRuns().some((r) => r.runId === runId);
  if (isQueued) return { ok: false, queued: true };
  return { ok: false, notFound: true };
}

export function enqueuePendingRun(
  state: WorkflowRuntimeRunsControlState,
  name: string,
  tags?: string[],
  extraPayload?: Record<string, unknown>,
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
  const runtimeState = state.store.readState();
  if (runtimeState.pendingRuns.some((r) => r.workflowName === name)) {
    return { ok: false, alreadyQueued: true };
  }
  const now = Date.now();
  const runId = formatRunId(name);
  const trigger = {
    event: "manual",
    schemaRef: null, payload: {
      ...(extraPayload ?? {}),
      triggeredAt: new Date().toISOString(),
      _runId: runId,
      ...(tags && tags.length > 0 && { tags }),
    },
  };
  state.wfQueue.appendRun({
    runId,
    workflowName: name,
    trigger,
    enqueuedAtMs: now,
    notBeforeMs: now,
  });
  maybeStartNext(state);
  return { ok: true, queued: name, runId };
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
  const idempotency = workflowDispatchIdempotency(
    state.idempotencyStore,
    name,
    trigger,
  );
  const existingIdempotency = idempotency
    ? state.idempotencyStore.get(
        idempotency.scopeId,
        "workflow-dispatch",
        idempotency.key,
      )
    : null;
  if (
    idempotency &&
    existingIdempotency?.firstResult !== undefined &&
    existingIdempotency.parameterFingerprint === idempotency.parameterFingerprint &&
    !isExpiredIdempotencyEntry(existingIdempotency.expiresAt)
  ) {
    const replay = state.idempotencyStore.record({
      scopeId: idempotency.scopeId,
      operation: "workflow-dispatch",
      key: idempotency.key,
      parameterFingerprint: idempotency.parameterFingerprint,
      result: existingIdempotency.firstResult,
    });
    if (replay.status === "replayed") {
      return { ok: true, runId: runIdFromWorkflowDispatchResult(replay.result) };
    }
  }
  if (state.activeRuns.has(name)) return { ok: false, alreadyRunning: true };
  let idempotencyReservation: IdempotencyReservation | null = null;
  if (idempotency) {
    const claim = state.idempotencyStore.claim({
      scopeId: idempotency.scopeId,
      operation: "workflow-dispatch",
      key: idempotency.key,
      parameterFingerprint: idempotency.parameterFingerprint,
    });
    if (claim.status === "replayed") {
      return { ok: true, runId: runIdFromWorkflowDispatchResult(claim.result) };
    }
    if (claim.status === "ignored") {
      return {
        ok: false,
        alreadyRunning: true,
        error: `Webhook dispatch for "${name}" is already in progress`,
      };
    }
    if (claim.status === "expired") {
      return {
        ok: false,
        error: `Webhook dispatch for "${name}" used an expired idempotency key; retry to claim fresh work`,
      };
    }
    if (claim.status === "rejected") {
      return {
        ok: false,
        error: `Webhook dispatch for "${name}" reused an idempotency key with different parameters`,
      };
    }
    idempotencyReservation = claim.reservation;
  }
  state.wfQueue.appendRun({
    runId,
    workflowName: name,
    trigger,
    enqueuedAtMs: now,
    notBeforeMs: now,
  });
  if (idempotencyReservation) {
    state.idempotencyStore.complete(
      idempotencyReservation,
      workflowDispatchResult(name, runId, trigger.event, now),
    );
  }
  maybeStartNext(state);
  return { ok: true, runId };
}

export function cancelQueuedRun(
  state: WorkflowRuntimeRunsControlState,
  runId: string,
): { ok: boolean; notFound?: boolean; active?: boolean } {
  const { cancelled } = state.wfQueue.cancel(runId);
  if (cancelled) return { ok: true };
  const runtimeState = state.store.readState();
  const isActive = (runtimeState.activeRuns ?? []).some((r) => r.runId === runId);
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
  reason?: "not_found" | "not_redrivable" | "unknown_workflow";
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
    state.wfQueue.appendRun({
      runId,
      workflowName: redrive.workflowName,
      trigger: resolved.value,
      enqueuedAtMs: now,
      notBeforeMs: now,
    });
    store.recordRedriveAttempt(id, {
      target,
      reason,
      result: {
        status: "queued",
        runId,
        workflowName: redrive.workflowName,
      },
    });
    maybeStartNext(state);
    return { ok: true, runId, workflowName: redrive.workflowName };
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
