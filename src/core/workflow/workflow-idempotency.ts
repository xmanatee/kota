import {
  fingerprintIdempotencyParams,
  hashIdempotencyMaterial,
  type IdempotencyJsonObject,
  type IdempotencyStore,
} from "#core/daemon/idempotency-store.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

function payloadString(
  payload: WorkflowRunTrigger["payload"],
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function explicitScope(
  payload: WorkflowRunTrigger["payload"],
  fallback: string,
): string {
  return payloadString(payload, "scopeId") ?? payloadString(payload, "projectId") ?? fallback;
}

function batchEventIds(payload: WorkflowRunTrigger["payload"]): string[] {
  const inputEvents = payload.inputEvents;
  if (!Array.isArray(inputEvents)) return [];
  return inputEvents.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as IdempotencyJsonObject;
    const eventId = item.eventId;
    if (typeof eventId === "string" && eventId.trim().length > 0) return [eventId];
    const entryPayload = item.payload;
    if (!entryPayload || typeof entryPayload !== "object" || Array.isArray(entryPayload)) {
      return [];
    }
    const nested = entryPayload as IdempotencyJsonObject;
    const idempotencyKey = nested.idempotencyKey;
    if (typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0) {
      return [idempotencyKey];
    }
    const externalId = nested.externalId;
    return typeof externalId === "string" && externalId.trim().length > 0
      ? [externalId]
      : [];
  });
}

function durableEventId(trigger: WorkflowRunTrigger): string | undefined {
  return trigger.eventId !== undefined && trigger.eventId.trim().length > 0
    ? trigger.eventId
    : undefined;
}

function isIdempotencyJsonObject(
  value: IdempotencyJsonObject[string],
): value is IdempotencyJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function workflowDispatchIdempotency(
  store: IdempotencyStore,
  workflowName: string,
  trigger: WorkflowRunTrigger,
):
  | {
      scopeId: string;
      key: string;
      parameterFingerprint: string;
    }
  | null {
  const scopeId = explicitScope(trigger.payload, store.getDefaultScopeId());
  const explicitKey = payloadString(trigger.payload, "idempotencyKey");
  const batchIds = batchEventIds(trigger.payload);
  const eventId = durableEventId(trigger);

  let keyMaterial: string[];
  if (explicitKey !== undefined) {
    keyMaterial = [workflowName, trigger.event, explicitKey];
  } else if (batchIds.length > 0) {
    keyMaterial = [workflowName, trigger.event, ...batchIds];
  } else if (eventId !== undefined) {
    keyMaterial = [workflowName, trigger.event, eventId];
  } else {
    return null;
  }

  const key = `workflow:${hashIdempotencyMaterial(keyMaterial)}`;
  const projection = { ...(trigger.payload as IdempotencyJsonObject) };
  delete projection._runId;
  delete projection.triggeredAt;
  delete projection.idempotencyStatus;
  delete projection.receivedAt;
  if (trigger.event === "webhook") delete projection.timestamp;
  const window = projection.window;
  if (isIdempotencyJsonObject(window)) {
    const normalizedWindow = { ...window };
    delete normalizedWindow.flushedAt;
    projection.window = normalizedWindow;
  }
  return {
    scopeId,
    key,
    parameterFingerprint: fingerprintIdempotencyParams({
      workflow: workflowName,
      event: trigger.event,
      payload: projection,
    }),
  };
}
