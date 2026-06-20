import type { ModuleEventPayloadObject } from "#core/events/module-event.js";
import { getModuleEventRegistry } from "#core/events/module-event.js";
import { validatePayloadAgainstSchema } from "#core/events/module-event-payload-validation.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { AutomationExplainSampleEvent } from "./types.js";

type Payload = WorkflowRunTrigger["payload"];
type PayloadValue = Payload[string];

function payloadPathValue(payload: Payload, path: string): PayloadValue {
  const segments = path.split(".");
  let current: Payload | PayloadValue = payload;
  for (const segment of segments) {
    if (!isPayloadObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isPayloadObject(value: Payload | PayloadValue): value is Payload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function payloadString(payload: Payload, path: string): string | undefined {
  const value = payloadPathValue(payload, path);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function payloadBoolean(payload: Payload, path: string): boolean | undefined {
  const value = payloadPathValue(payload, path);
  return typeof value === "boolean" ? value : undefined;
}

export function payloadNumber(payload: Payload, path: string): number | undefined {
  const value = payloadPathValue(payload, path);
  return typeof value === "number" ? value : undefined;
}

export function sourceIgnoredReason(sample: AutomationExplainSampleEvent): string | null {
  const trust = payloadString(sample.payload, "actor.trust");
  if (trust === "blocked") return "actor.trust is blocked";
  const status =
    payloadString(sample.payload, "sourceStatus") ??
    payloadString(sample.payload, "source.status");
  if (status === "blocked" || status === "archived") {
    return `source status is ${status}`;
  }
  const archived =
    payloadBoolean(sample.payload, "archived") ??
    payloadBoolean(sample.payload, "source.archived");
  return archived === true ? "source is archived" : null;
}

export function idempotencyDuplicateReason(sample: AutomationExplainSampleEvent): string | null {
  const status = payloadString(sample.payload, "idempotencyStatus");
  if (status === "replayed" || status === "ignored") {
    return `event idempotency status is ${status}`;
  }
  return null;
}

export function idempotencyRejectedReason(sample: AutomationExplainSampleEvent): string | null {
  const status = payloadString(sample.payload, "idempotencyStatus");
  return status === "rejected" ? "event idempotency status is rejected" : null;
}

export function schemaError(sample: AutomationExplainSampleEvent): string | null {
  const registration = getModuleEventRegistry()?.get(sample.event);
  if (!registration) return null;
  return validatePayloadAgainstSchema(
    registration.payloadSchema,
    sample.payload as ModuleEventPayloadObject,
  );
}
