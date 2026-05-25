import type { ModuleContext } from "#core/modules/module-types.js";
import {
  type InboundSignalActorTrust,
  type InboundSignalJsonObject,
  type InboundSignalJsonValue,
  type InboundSignalReceivedPayload,
  type InboundSignalValidationResult,
  inboundSignalReceived,
  validateInboundSignalPayload,
} from "#modules/inbound-signals/events.js";

export type SocialProvider = "x";
export type SocialSignalKind = "mention" | "direct_message" | "webhook";

export type SocialConnectorConfig = {
  id: string;
  provider: SocialProvider;
  accountId: string;
  webhookSecret: string;
  trustedActorIds?: readonly string[];
  trustedHandles?: readonly string[];
  blockedActorIds?: readonly string[];
  blockedHandles?: readonly string[];
};

export type SocialInboundSignalContext = {
  projectId: string;
  receivedAt: string;
  connector: SocialConnectorConfig;
};

export type SocialInboundActor = {
  id: string;
  handle?: string;
  displayName?: string;
};

export type SocialInboundDelivery = {
  kind: SocialSignalKind;
  id: string;
  actor: SocialInboundActor;
  text?: string;
  url?: string;
  occurredAt?: string;
  threadId?: string;
  conversationId?: string;
  title?: string;
  data?: InboundSignalJsonObject;
};

export type SocialInboundInputResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type SocialInboundSignalEmitResult =
  | { emitted: true; payload: InboundSignalReceivedPayload }
  | { emitted: false; error: string };

export const MAX_SOCIAL_TEXT_LENGTH = 4_000;
export const MAX_SOCIAL_DATA_JSON_LENGTH = 8_000;

type TrustAssessment = {
  trust: InboundSignalActorTrust;
  trustReason: string;
};

function clean(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireInputString(
  value: InboundSignalJsonValue | undefined,
  label: string,
): string {
  if (typeof value === "string") {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  throw new Error(`${label} must be a non-empty string`);
}

function optionalInputString(
  value: InboundSignalJsonValue | undefined,
  label: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return clean(value) ?? undefined;
  throw new Error(`${label} must be a string`);
}

function optionalInputObject(
  value: InboundSignalJsonValue | undefined,
  label: string,
): InboundSignalJsonObject | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as InboundSignalJsonObject;
  }
  throw new Error(`${label} must be an object`);
}

function inputEnvelope(
  raw: InboundSignalJsonObject,
  field: string,
): InboundSignalJsonObject {
  return optionalInputObject(raw[field], field) ?? raw;
}

function kindValue(value: InboundSignalJsonValue | undefined): SocialSignalKind {
  if (value === "mention" || value === "direct_message" || value === "webhook") {
    return value;
  }
  throw new Error("kind must be mention, direct_message, or webhook");
}

function optionalTimestamp(
  value: InboundSignalJsonValue | undefined,
  label: string,
): string | undefined {
  const timestamp = optionalInputString(value, label);
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an ISO-compatible timestamp`);
  }
  return new Date(parsed).toISOString();
}

function boundedInputData(
  value: InboundSignalJsonObject | undefined,
  label: string,
): InboundSignalJsonObject | undefined {
  if (!value) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_SOCIAL_DATA_JSON_LENGTH) {
    throw new Error(
      `${label} must serialize to ${MAX_SOCIAL_DATA_JSON_LENGTH} characters or fewer`,
    );
  }
  return value;
}

function boundedText(value: string | undefined): {
  text: string | null;
  truncated: boolean;
} {
  const cleaned = clean(value);
  if (!cleaned) return { text: null, truncated: false };
  if (cleaned.length <= MAX_SOCIAL_TEXT_LENGTH) {
    return { text: cleaned, truncated: false };
  }
  return {
    text: cleaned.slice(0, MAX_SOCIAL_TEXT_LENGTH),
    truncated: true,
  };
}

function normalizedHandle(value: string | undefined): string | null {
  const cleaned = clean(value);
  if (!cleaned) return null;
  return cleaned.replace(/^@+/, "").toLowerCase();
}

function configuredStringMatches(
  value: string,
  configured: readonly string[] | undefined,
): boolean {
  const normalized = value.trim();
  return (configured ?? []).some((entry) => entry.trim() === normalized);
}

function configuredHandleMatches(
  handle: string | null,
  configured: readonly string[] | undefined,
): boolean {
  if (!handle) return false;
  return (configured ?? []).some((entry) => normalizedHandle(entry) === handle);
}

function actorTrust(
  actor: SocialInboundActor,
  connector: SocialConnectorConfig,
): TrustAssessment {
  const handle = normalizedHandle(actor.handle);
  if (configuredStringMatches(actor.id, connector.blockedActorIds)) {
    return {
      trust: "blocked",
      trustReason:
        `social actor id '${actor.id}' matched modules.social inbound blockedActorIds`,
    };
  }
  if (configuredHandleMatches(handle, connector.blockedHandles)) {
    return {
      trust: "blocked",
      trustReason:
        `social actor handle '@${handle}' matched modules.social inbound blockedHandles`,
    };
  }
  if (configuredStringMatches(actor.id, connector.trustedActorIds)) {
    return {
      trust: "trusted",
      trustReason:
        `social actor id '${actor.id}' matched modules.social inbound trustedActorIds`,
    };
  }
  if (configuredHandleMatches(handle, connector.trustedHandles)) {
    return {
      trust: "trusted",
      trustReason:
        `social actor handle '@${handle}' matched modules.social inbound trustedHandles`,
    };
  }
  return {
    trust: "untrusted",
    trustReason:
      "social actor did not match modules.social inbound trust lists",
  };
}

function providerLabel(provider: SocialProvider): string {
  return provider === "x" ? "X" : provider;
}

function kindLabel(kind: SocialSignalKind): string {
  if (kind === "direct_message") return "direct message";
  if (kind === "mention") return "mention";
  return "webhook delivery";
}

function actorDisplay(actor: SocialInboundActor): string {
  const handle = normalizedHandle(actor.handle);
  return handle
    ? `@${handle}`
    : clean(actor.displayName) ?? actor.id;
}

function actorId(provider: SocialProvider, actor: SocialInboundActor): string {
  if (provider === "x") return `x:user:${actor.id}`;
  return `${provider}:actor:${actor.id}`;
}

function accountId(provider: SocialProvider, account: string): string {
  return `${provider}:${account}`;
}

function sourceUrl(
  delivery: SocialInboundDelivery,
  connector: SocialConnectorConfig,
): string {
  const explicit = clean(delivery.url);
  if (explicit) return explicit;
  if (connector.provider === "x" && delivery.kind !== "direct_message") {
    return `https://x.com/i/web/status/${encodeURIComponent(delivery.id)}`;
  }
  return `${connector.provider}://${delivery.kind}/${encodeURIComponent(delivery.id)}`;
}

function actionName(
  provider: SocialProvider,
  kind: SocialSignalKind,
): string {
  return `${provider}.${kind}.received`;
}

function signalLabel(
  delivery: SocialInboundDelivery,
  connector: SocialConnectorConfig,
): string {
  const title = clean(delivery.title);
  if (title) return title;
  return `${providerLabel(connector.provider)} ${kindLabel(delivery.kind)} from ${actorDisplay(
    delivery.actor,
  )}`;
}

function signalData(
  delivery: SocialInboundDelivery,
  connector: SocialConnectorConfig,
): InboundSignalJsonObject {
  const text = boundedText(delivery.text);
  return {
    connectorId: connector.id,
    kind: delivery.kind,
    eventId: delivery.id,
    actor: {
      id: delivery.actor.id,
      handle: normalizedHandle(delivery.actor.handle),
      displayName: clean(delivery.actor.displayName),
    },
    text: text.text,
    textTruncated: text.truncated,
    url: clean(delivery.url),
    threadId: clean(delivery.threadId),
    conversationId: clean(delivery.conversationId),
    title: clean(delivery.title),
    providerData: delivery.data ?? null,
  };
}

export function socialDeliveryFromInboundRequest(
  raw: InboundSignalJsonObject,
): SocialInboundInputResult<SocialInboundDelivery> {
  try {
    const delivery = inputEnvelope(raw, "delivery");
    const kind = kindValue(delivery.kind);
    const actorInput = optionalInputObject(delivery.actor, "actor");
    if (!actorInput) throw new Error("actor must be an object");
    const actor: SocialInboundActor = {
      id: requireInputString(actorInput.id, "actor.id"),
      handle: optionalInputString(actorInput.handle, "actor.handle"),
      displayName: optionalInputString(
        actorInput.displayName,
        "actor.displayName",
      ),
    };
    const text = optionalInputString(delivery.text, "text");
    if ((kind === "mention" || kind === "direct_message") && !clean(text)) {
      throw new Error(`${kind} text must be a non-empty string`);
    }

    return {
      ok: true,
      value: {
        kind,
        id: requireInputString(delivery.id, "id"),
        actor,
        text,
        url: optionalInputString(delivery.url, "url"),
        occurredAt: optionalTimestamp(delivery.occurredAt, "occurredAt"),
        threadId: optionalInputString(delivery.threadId, "threadId"),
        conversationId: optionalInputString(
          delivery.conversationId,
          "conversationId",
        ),
        title: optionalInputString(delivery.title, "title"),
        data: boundedInputData(optionalInputObject(delivery.data, "data"), "data"),
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function socialDeliveryToInboundSignal(
  delivery: SocialInboundDelivery,
  context: SocialInboundSignalContext,
): InboundSignalValidationResult {
  const trust = actorTrust(delivery.actor, context.connector);
  const provider = context.connector.provider;
  const channel = `${provider}.${delivery.kind}`;
  const account = accountId(provider, context.connector.accountId);
  return validateInboundSignalPayload({
    projectId: context.projectId,
    provider,
    channel,
    accountId: account,
    sourceId: `${account}:${delivery.kind}:${delivery.id}`,
    sourceUrl: sourceUrl(delivery, context.connector),
    externalId: `${provider}:${delivery.kind}:${delivery.id}`,
    occurredAt: delivery.occurredAt ?? context.receivedAt,
    receivedAt: context.receivedAt,
    actor: {
      id: actorId(provider, delivery.actor),
      displayName: actorDisplay(delivery.actor),
      trust: trust.trust,
      trustReason: trust.trustReason,
    },
    body: {
      kind: "action",
      action: actionName(provider, delivery.kind),
      label: signalLabel(delivery, context.connector),
      data: signalData(delivery, context.connector),
    },
  });
}

export function emitSocialInboundSignal(
  events: Pick<ModuleContext["events"], "emit">,
  signal: InboundSignalValidationResult,
): SocialInboundSignalEmitResult {
  if (!signal.ok) return { emitted: false, error: signal.error };
  events.emit(inboundSignalReceived, signal.payload);
  return { emitted: true, payload: signal.payload };
}
