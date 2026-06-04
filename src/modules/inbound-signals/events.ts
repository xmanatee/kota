import type { ProjectScopedPayload } from "#core/events/project-scope.js";
import { defineProjectScopedModuleEvent } from "#core/events/project-scope.js";

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
  ProjectScopedPayload<InboundSignalPayload>;

export type InboundSignalValidationResult =
  | { ok: true; payload: InboundSignalReceivedPayload }
  | { ok: false; error: string };

export type InboundSignalInputObject = {
  readonly [key: string]: InboundSignalJsonValue;
};

export type InboundSignalAdapterContext = {
  projectId: string;
  receivedAt: string;
};

export const inboundSignalReceived =
  defineProjectScopedModuleEvent<InboundSignalPayload>(
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
  );

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
    ["projectId", payload.projectId],
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
  if (payload.scopeId !== payload.projectId) {
    return { ok: false, error: "scopeId and projectId must match" };
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
  if (!nonEmpty(context.projectId)) {
    return { ok: false, error: "projectId must be a non-empty string" };
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
    scopeId: context.projectId,
    projectId: context.projectId,
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
