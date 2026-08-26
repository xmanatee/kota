import type { ScopedPayload } from "#core/events/scope.js";
import { defineScopedModuleEvent } from "#core/events/scope.js";

export type InboundSignalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly InboundSignalJsonValue[]
  | InboundSignalJsonObject;

export type InboundSignalJsonObject = {
  readonly [key: string]: InboundSignalJsonValue;
};

export type InboundSignalActorTrust = "trusted" | "untrusted" | "blocked";

export type InboundSignalSourceStatus =
  | "active"
  | "blocked"
  | "archived"
  | "ignored";

export type InboundSignalActor = {
  id: string;
  displayName: string;
  trust: InboundSignalActorTrust;
  trustReason: string;
};

export type InboundSignalMessageBody = {
  kind: "message";
  format: "plain" | "markdown";
  text: string;
};

export type InboundSignalActionBody = {
  kind: "action";
  action: string;
  label: string;
  data: InboundSignalJsonObject;
};

export type InboundSignalBody =
  | InboundSignalMessageBody
  | InboundSignalActionBody;

export type InboundSignalPayload = {
  provider: string;
  channel: string;
  accountId: string;
  sourceId: string;
  sourceUrl: string;
  externalId: string;
  occurredAt: string;
  receivedAt: string;
  actor: InboundSignalActor;
  body: InboundSignalBody;
};

export type InboundSignalReceivedPayload =
  ScopedPayload<InboundSignalPayload>;

export type InboundSignalRouteDecision =
  | "dispatched"
  | "blocked"
  | "archived"
  | "ignored"
  | "no-route"
  | "validation-error";

export type InboundSignalRouteTargetKind = "workflow" | "agent";

export type InboundSignalRouteTargetStatus =
  | "queued"
  | "batched"
  | "completed"
  | "already-queued"
  | "skipped"
  | "unsupported"
  | "failed";

export type InboundSignalRouteTargetResult = {
  kind: InboundSignalRouteTargetKind;
  name: string;
  status: InboundSignalRouteTargetStatus;
  runId?: string;
  sessionId?: string;
  reason?: string;
};

export type InboundSignalRoutePolicyPayload = {
  routeId: string;
  sourceStatus: InboundSignalSourceStatus;
  blockedHandling: "audit-only" | "dispatch";
  batch: InboundSignalJsonObject | null;
  processing: InboundSignalJsonObject | null;
};

export type InboundSignalRoutedPayload = ScopedPayload<{
  routeId: string;
  decision: InboundSignalRouteDecision;
  sourceStatus: InboundSignalSourceStatus;
  provider: string;
  channel: string;
  accountId: string;
  sourceId: string;
  actorTrust: InboundSignalActorTrust;
  policy: InboundSignalRoutePolicyPayload;
  signal: InboundSignalReceivedPayload;
  targets: readonly InboundSignalRouteTargetResult[];
  reason: string;
}>;

export type InboundSignalValidationResult =
  | { ok: true; payload: InboundSignalReceivedPayload }
  | { ok: false; error: string };

export type InboundSignalInputObject = {
  readonly [key: string]: InboundSignalJsonValue;
};

export type InboundSignalAdapterContext = {
  scopeId: string;
  receivedAt: string;
};

export const inboundSignalReceived =
  defineScopedModuleEvent<InboundSignalPayload>(
    "inbound.signal.received",
    [
      "provider",
      "channel",
      "accountId",
      "sourceId",
      "sourceUrl",
      "externalId",
      "occurredAt",
      "receivedAt",
      "actor",
      "body",
    ],
    {
      payloadSchema: {
        type: "object",
        properties: {
          provider: { type: "string" },
          channel: { type: "string" },
          accountId: { type: "string" },
          sourceId: { type: "string" },
          sourceUrl: { type: "string" },
          externalId: { type: "string" },
          occurredAt: { type: "string", format: "date-time" },
          receivedAt: { type: "string", format: "date-time" },
          actor: {
            type: "object",
            properties: {
              id: { type: "string" },
              displayName: { type: "string" },
              trust: {
                type: "string",
                enum: ["trusted", "untrusted", "blocked"],
              },
              trustReason: { type: "string" },
            },
          },
          body: {
            type: "discriminatedUnion",
            discriminator: "kind",
            variants: {
              message: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["message"] },
                  format: {
                    type: "string",
                    enum: ["plain", "markdown"],
                  },
                  text: { type: "string" },
                },
                additionalProperties: false,
              },
              action: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["action"] },
                  action: { type: "string" },
                  label: { type: "string" },
                  data: {
                    type: "object",
                    properties: {},
                    additionalProperties: true,
                  },
                },
                additionalProperties: false,
              },
            },
          },
        },
      },
      sensitivity: "internal",
      workflowTriggerPolicy: "blocked",
    },
  );

export const inboundSignalRouted =
  defineScopedModuleEvent<Omit<InboundSignalRoutedPayload, "scopeId">>(
    "inbound.signal.routed",
    [
      "routeId",
      "decision",
      "sourceStatus",
      "provider",
      "channel",
      "accountId",
      "sourceId",
      "actorTrust",
      "policy",
      "signal",
      "targets",
      "reason",
    ],
    {
      payloadSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          routeId: { type: "string" },
          decision: {
            type: "string",
            enum: [
              "dispatched",
              "blocked",
              "archived",
              "ignored",
              "no-route",
              "validation-error",
            ],
          },
          sourceStatus: {
            type: "string",
            enum: ["active", "blocked", "archived", "ignored"],
          },
          provider: { type: "string" },
          channel: { type: "string" },
          accountId: { type: "string" },
          sourceId: { type: "string" },
          actorTrust: {
            type: "string",
            enum: ["trusted", "untrusted", "blocked"],
          },
          policy: {
            type: "object",
            additionalProperties: true,
            properties: {
              routeId: { type: "string" },
              sourceStatus: {
                type: "string",
                enum: ["active", "blocked", "archived", "ignored"],
              },
              blockedHandling: {
                type: "string",
                enum: ["audit-only", "dispatch"],
              },
              batch: { type: "json" },
              processing: { type: "json" },
            },
          },
          signal: { type: "json", filterable: false },
          targets: { type: "json", filterable: false },
          reason: { type: "string" },
        },
      },
      filterablePaths: [
        "routeId",
        "decision",
        "sourceStatus",
        "provider",
        "channel",
        "accountId",
        "sourceId",
        "actorTrust",
        "policy.blockedHandling",
      ],
      sensitivity: "internal",
      workflowTriggerPolicy: "blocked",
    },
  );

/**
 * Targeted workflow admission label. This is intentionally not emitted on the
 * event bus: `inboundSignalRouted` is the audit fact, while this label identifies
 * the one workflow selected by the route.
 */
export const inboundSignalWorkflowTargeted = "inbound.signal.workflow-targeted";

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function validTimestamp(value: string): boolean {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function stringValue(value: InboundSignalJsonValue | undefined): string | null {
  return typeof value === "string" && nonEmpty(value) ? value : null;
}

function objectValue(
  value: InboundSignalJsonValue | undefined,
): InboundSignalInputObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as InboundSignalInputObject;
}

function jsonObjectValue(
  value: InboundSignalJsonValue | undefined,
): InboundSignalJsonObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as InboundSignalJsonObject;
}

function trustValue(
  value: InboundSignalJsonValue | undefined,
): InboundSignalActorTrust | null {
  return value === "trusted" || value === "untrusted" || value === "blocked"
    ? value
    : null;
}

function bodyFormatValue(
  value: InboundSignalJsonValue | undefined,
): "plain" | "markdown" | null {
  return value === "plain" || value === "markdown" ? value : null;
}

function validateActor(actor: InboundSignalActor): string | null {
  if (!nonEmpty(actor.id)) return "actor.id must be a non-empty string";
  if (!nonEmpty(actor.displayName)) {
    return "actor.displayName must be a non-empty string";
  }
  if (
    actor.trust !== "trusted" &&
    actor.trust !== "untrusted" &&
    actor.trust !== "blocked"
  ) {
    return "actor.trust must be trusted, untrusted, or blocked";
  }
  if (!nonEmpty(actor.trustReason)) {
    return "actor.trustReason must be a non-empty string";
  }
  return null;
}

function validateBody(body: InboundSignalBody): string | null {
  if (body.kind === "message") {
    if (body.format !== "plain" && body.format !== "markdown") {
      return "body.format must be plain or markdown";
    }
    if (!nonEmpty(body.text)) return "body.text must be a non-empty string";
    return null;
  }
  if (body.kind === "action") {
    if (!nonEmpty(body.action)) return "body.action must be a non-empty string";
    if (!nonEmpty(body.label)) return "body.label must be a non-empty string";
    if (body.data === null || Array.isArray(body.data) || typeof body.data !== "object") {
      return "body.data must be an object";
    }
    return null;
  }
  return "body.kind must be message or action";
}

export function validateInboundSignalPayload(
  payload: InboundSignalReceivedPayload,
): InboundSignalValidationResult {
  const stringFields = [
    ["scopeId", payload.scopeId],
    ["provider", payload.provider],
    ["channel", payload.channel],
    ["accountId", payload.accountId],
    ["sourceId", payload.sourceId],
    ["sourceUrl", payload.sourceUrl],
    ["externalId", payload.externalId],
  ] as const;
  for (const [field, value] of stringFields) {
    if (!nonEmpty(value)) {
      return { ok: false, error: `${field} must be a non-empty string` };
    }
  }
  if (!validTimestamp(payload.occurredAt)) {
    return { ok: false, error: "occurredAt must be an ISO-compatible timestamp" };
  }
  if (!validTimestamp(payload.receivedAt)) {
    return { ok: false, error: "receivedAt must be an ISO-compatible timestamp" };
  }
  const actorError = validateActor(payload.actor);
  if (actorError) return { ok: false, error: actorError };
  const bodyError = validateBody(payload.body);
  if (bodyError) return { ok: false, error: bodyError };
  return { ok: true, payload };
}

export function normalizeInboundSignalInput(
  input: InboundSignalInputObject,
  context: InboundSignalAdapterContext,
): InboundSignalValidationResult {
  if (!nonEmpty(context.scopeId)) {
    return { ok: false, error: "scopeId must be a non-empty string" };
  }
  if (!validTimestamp(context.receivedAt)) {
    return { ok: false, error: "receivedAt must be an ISO-compatible timestamp" };
  }

  const actorInput = objectValue(input.actor);
  if (!actorInput) return { ok: false, error: "actor must be an object" };
  const trust = trustValue(actorInput.trust);
  if (!trust) {
    return { ok: false, error: "actor.trust must be trusted, untrusted, or blocked" };
  }
  const actor: InboundSignalActor = {
    id: stringValue(actorInput.id) ?? "",
    displayName: stringValue(actorInput.displayName) ?? "",
    trust,
    trustReason: stringValue(actorInput.trustReason) ?? "",
  };

  const bodyInput = objectValue(input.body);
  if (!bodyInput) return { ok: false, error: "body must be an object" };
  const bodyKind = stringValue(bodyInput.kind);
  let body: InboundSignalBody;
  if (bodyKind === "message") {
    const format = bodyFormatValue(bodyInput.format);
    if (!format) {
      return { ok: false, error: "body.format must be plain or markdown" };
    }
    body = {
      kind: "message",
      format,
      text: stringValue(bodyInput.text) ?? "",
    };
  } else if (bodyKind === "action") {
    const data = jsonObjectValue(bodyInput.data);
    if (!data) return { ok: false, error: "body.data must be an object" };
    body = {
      kind: "action",
      action: stringValue(bodyInput.action) ?? "",
      label: stringValue(bodyInput.label) ?? "",
      data,
    };
  } else {
    return { ok: false, error: "body.kind must be message or action" };
  }

  return validateInboundSignalPayload({
    scopeId: context.scopeId,
    provider: stringValue(input.provider) ?? "",
    channel: stringValue(input.channel) ?? "",
    accountId: stringValue(input.accountId) ?? "",
    sourceId: stringValue(input.sourceId) ?? "",
    sourceUrl: stringValue(input.sourceUrl) ?? "",
    externalId: stringValue(input.externalId) ?? "",
    occurredAt: stringValue(input.occurredAt) ?? "",
    receivedAt: context.receivedAt,
    actor,
    body,
  });
}
