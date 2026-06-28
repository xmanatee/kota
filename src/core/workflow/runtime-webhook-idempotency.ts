import type {
  IdempotencyJsonObject,
  IdempotencyReservation,
  IdempotencyStore,
} from "#core/daemon/idempotency-store.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import { workflowDispatchIdempotency } from "./workflow-idempotency.js";

export type WorkflowDispatchIdempotencyClaim =
  | { status: "reserved"; reservation: IdempotencyReservation | null }
  | { status: "replayed"; runId: string }
  | { status: "ignored"; error: string }
  | { status: "expired"; error: string }
  | { status: "rejected"; error: string };

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

export function replayWorkflowDispatchIdempotency(
  idempotencyStore: IdempotencyStore,
  workflowName: string,
  trigger: WorkflowRunTrigger,
): string | null {
  const idempotency = workflowDispatchIdempotency(
    idempotencyStore,
    workflowName,
    trigger,
  );
  if (!idempotency) return null;

  const existing = idempotencyStore.get(
    idempotency.scopeId,
    "workflow-dispatch",
    idempotency.key,
  );
  if (
    existing?.firstResult !== undefined &&
    existing.parameterFingerprint === idempotency.parameterFingerprint &&
    !isExpiredIdempotencyEntry(existing.expiresAt)
  ) {
    const replay = idempotencyStore.record({
      scopeId: idempotency.scopeId,
      operation: "workflow-dispatch",
      key: idempotency.key,
      parameterFingerprint: idempotency.parameterFingerprint,
      result: existing.firstResult,
    });
    if (replay.status === "replayed") {
      return runIdFromWorkflowDispatchResult(replay.result);
    }
  }
  return null;
}

export function claimWorkflowDispatchIdempotency(
  idempotencyStore: IdempotencyStore,
  workflowName: string,
  trigger: WorkflowRunTrigger,
): WorkflowDispatchIdempotencyClaim {
  const idempotency = workflowDispatchIdempotency(
    idempotencyStore,
    workflowName,
    trigger,
  );
  if (!idempotency) return { status: "reserved", reservation: null };
  const claim = idempotencyStore.claim({
    scopeId: idempotency.scopeId,
    operation: "workflow-dispatch",
    key: idempotency.key,
    parameterFingerprint: idempotency.parameterFingerprint,
  });
  if (claim.status === "replayed") {
    return {
      status: "replayed",
      runId: runIdFromWorkflowDispatchResult(claim.result),
    };
  }
  if (claim.status === "ignored") {
    return {
      status: "ignored",
      error: `Webhook dispatch for "${workflowName}" is already in progress`,
    };
  }
  if (claim.status === "expired") {
    return {
      status: "expired",
      error: `Webhook dispatch for "${workflowName}" used an expired idempotency key; retry to claim fresh work`,
    };
  }
  if (claim.status === "rejected") {
    return {
      status: "rejected",
      error: `Webhook dispatch for "${workflowName}" reused an idempotency key with different parameters`,
    };
  }
  return { status: "reserved", reservation: claim.reservation };
}

export function completeWorkflowDispatchIdempotency(
  idempotencyStore: IdempotencyStore,
  reservation: IdempotencyReservation,
  workflowName: string,
  runId: string,
  triggerEvent: string,
  enqueuedAtMs: number,
): void {
  idempotencyStore.complete(
    reservation,
    workflowDispatchResult(workflowName, runId, triggerEvent, enqueuedAtMs),
  );
}
