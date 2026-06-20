import type {
  OwnerDecisionJsonObject,
  OwnerDecisionJsonValue,
} from "#core/daemon/owner-decision-store.js";
import type {
  InboundSignalJsonObject,
  InboundSignalJsonValue,
} from "#modules/inbound-signals/events.js";

export const EMPTY_JSON_OBJECT: InboundSignalJsonObject = {};

export function jsonString(
  source: InboundSignalJsonObject,
  key: string,
): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function jsonNumber(
  source: InboundSignalJsonObject,
  key: string,
): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function jsonObject(
  source: InboundSignalJsonObject,
  key: string,
): InboundSignalJsonObject | null {
  const value = source[key];
  return isInboundJsonObject(value)
    ? value
    : null;
}

function isInboundJsonArray(
  value: InboundSignalJsonValue,
): value is readonly InboundSignalJsonValue[] {
  return Array.isArray(value);
}

function isInboundJsonObject(
  value: InboundSignalJsonValue,
): value is InboundSignalJsonObject {
  return value !== null && typeof value === "object" && !isInboundJsonArray(value);
}

function ownerJsonValue(value: InboundSignalJsonValue): OwnerDecisionJsonValue {
  if (isInboundJsonArray(value)) return value.map(ownerJsonValue);
  if (isInboundJsonObject(value)) return ownerJsonObject(value);
  return value;
}

export function ownerJsonObject(source: InboundSignalJsonObject): OwnerDecisionJsonObject {
  const out: OwnerDecisionJsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = ownerJsonValue(value);
  }
  return out;
}
