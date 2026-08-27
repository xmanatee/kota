import type { BusEnvelope, EventBus } from "#core/events/event-bus.js";
import {
  fingerprintIdempotencyParams,
  hashIdempotencyMaterial,
  type IdempotencyClaimInput,
  type IdempotencyJsonObject,
  type IdempotencyStore,
  toIdempotencyJsonValue,
} from "./idempotency-store.js";

export type EventIdempotencyInstallOptions = {
  getDefaultScopeId: () => string;
  resolveStore: (scopeId: string) => IdempotencyStore;
  log?: (message: string) => void;
};

function payloadString(
  payload: BusEnvelope["payload"],
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function explicitScope(payload: BusEnvelope["payload"], fallback: string): string {
  return payloadString(payload, "scopeId") ?? fallback;
}

function eventIngestionIdentity(
  envelope: BusEnvelope,
  defaultScopeId: string,
): IdempotencyClaimInput | null {
  if (envelope.delivery === "outbox") return null;
  const payload = envelope.payload;
  const scopeId = explicitScope(payload, defaultScopeId);
  const explicitKey = payloadString(payload, "idempotencyKey");
  const provider = payloadString(payload, "provider");
  const channel = payloadString(payload, "channel");
  const sourceId = payloadString(payload, "sourceId");
  const externalId = payloadString(payload, "externalId");
  if (
    explicitKey === undefined &&
    (provider === undefined || channel === undefined || sourceId === undefined || externalId === undefined)
  ) {
    return null;
  }

  const keyMaterial =
    explicitKey !== undefined
      ? ["explicit", envelope.type, explicitKey]
      : [
          "provider",
          envelope.type,
          provider!,
          channel!,
          payloadString(payload, "accountId") ?? "default",
          sourceId!,
          externalId!,
        ];
  const key = `event:${hashIdempotencyMaterial(keyMaterial)}`;
  const projection = toIdempotencyJsonValue(
    payload as IdempotencyJsonObject,
  ) as IdempotencyJsonObject;
  delete projection.idempotencyKey;
  delete projection.idempotencyStatus;
  delete projection.receivedAt;
  return {
    scopeId,
    operation: "event-ingestion",
    key,
    parameterFingerprint: fingerprintIdempotencyParams({
      event: envelope.type,
      payload: projection,
    }),
  };
}

export function installEventIdempotency(
  bus: EventBus,
  options: EventIdempotencyInstallOptions,
): () => void {
  return bus.addEmitMiddleware((envelope, next) => {
    const input = eventIngestionIdentity(envelope, options.getDefaultScopeId());
    if (!input) {
      next();
      return;
    }
    const store = options.resolveStore(input.scopeId);
    const claim = store.claim(input);
    envelope.payload.idempotencyStatus = claim.status;
    if (claim.status === "accepted") {
      try {
        next();
        store.complete(claim.reservation, {
          event: envelope.type,
          acceptedAt: new Date().toISOString(),
        });
      } catch (error) {
        store.abandon(claim.reservation);
        throw error;
      }
      return;
    }
    options.log?.(
      `Suppressed duplicate event "${envelope.type}" for idempotency key ${input.key} (${claim.status})`,
    );
  });
}
