import type { ModuleContext } from "#core/modules/module-types.js";
import {
  type InboundSignalActorTrust,
  type InboundSignalReceivedPayload,
  inboundSignalReceived,
  validateInboundSignalPayload,
} from "#modules/inbound-signals/events.js";
import type { SlackEventsApiPayload, SlackMessageEvent } from "./client.js";

export type SlackChannelInboundSignalConfig = {
  prefixes: readonly string[];
  trustedUserIds?: readonly string[];
  blockedUserIds?: readonly string[];
};

export type SlackTextInboundSignalContext = {
  projectId: string;
  receivedAt: string;
  config: SlackChannelInboundSignalConfig;
};

export type SlackTextInboundSignalBuildResult =
  | { kind: "signal"; payload: InboundSignalReceivedPayload }
  | {
      kind: "skip";
      reason: "prefix-mismatch" | "empty-message";
    }
  | { kind: "invalid"; error: string };

export type SlackInboundSignalEmitResult =
  | { emitted: true; payload: InboundSignalReceivedPayload }
  | { emitted: false; reason: "prefix-mismatch" | "empty-message" }
  | { emitted: false; error: string };

function matchedAutomationText(
  text: string,
  prefixes: readonly string[],
): { matched: true; text: string } | { matched: false; reason: "prefix-mismatch" | "empty-message" } {
  const trimmed = text.trimStart();
  for (const prefix of prefixes) {
    if (prefix.trim().length === 0) {
      return { matched: false, reason: "prefix-mismatch" };
    }
    if (!trimmed.startsWith(prefix)) continue;
    const body = trimmed.slice(prefix.length).trim();
    if (body.length === 0) return { matched: false, reason: "empty-message" };
    return { matched: true, text: body };
  }
  return { matched: false, reason: "prefix-mismatch" };
}

function timestampFromSlackSeconds(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const seconds = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(seconds)) return null;
  return new Date(Math.trunc(seconds * 1000)).toISOString();
}

function actorTrust(
  userId: string,
  config: SlackChannelInboundSignalConfig,
): { trust: InboundSignalActorTrust; trustReason: string } {
  if (config.blockedUserIds?.includes(userId)) {
    return {
      trust: "blocked",
      trustReason: "Slack user id is configured in inboundSignals.blockedUserIds",
    };
  }
  if (config.trustedUserIds?.includes(userId)) {
    return {
      trust: "trusted",
      trustReason: "Slack user id is configured in inboundSignals.trustedUserIds",
    };
  }
  return {
    trust: "untrusted",
    trustReason:
      "Slack user id is not configured in inboundSignals.trustedUserIds",
  };
}

function slackMessageExternalId(
  event: SlackMessageEvent,
  envelope: SlackEventsApiPayload,
  receivedAt: string,
): string {
  if (envelope.event_id) return `slack:event:${envelope.event_id}`;
  if (event.ts) return `slack:message:${event.ts}`;
  if (event.event_ts) return `slack:message:${event.event_ts}`;
  return `slack:received:${receivedAt}`;
}

export function slackTextMessageToInboundSignal(
  event: SlackMessageEvent,
  envelope: SlackEventsApiPayload,
  context: SlackTextInboundSignalContext,
): SlackTextInboundSignalBuildResult {
  const text = event.text ?? "";
  const matched = matchedAutomationText(text, context.config.prefixes);
  if (!matched.matched) return { kind: "skip", reason: matched.reason };

  const teamId = envelope.team_id ?? "unknown-team";
  const messageTs = event.ts ?? event.event_ts ?? envelope.event_id ?? context.receivedAt;
  const externalId = slackMessageExternalId(event, envelope, context.receivedAt);
  const trust = actorTrust(event.user ?? "unknown-user", context.config);
  const sourceUrl =
    `slack://team/${encodeURIComponent(teamId)}` +
    `/channel/${encodeURIComponent(event.channel ?? "unknown-channel")}` +
    `/message/${encodeURIComponent(messageTs)}`;
  const signal = validateInboundSignalPayload({
    projectId: context.projectId,
    provider: "slack",
    channel: "slack.message",
    accountId: `slack:${teamId}`,
    sourceId:
      `slack:${teamId}:channel:${event.channel ?? "unknown-channel"}` +
      `:message:${messageTs}`,
    sourceUrl,
    externalId,
    occurredAt:
      timestampFromSlackSeconds(event.ts) ??
      timestampFromSlackSeconds(event.event_ts) ??
      timestampFromSlackSeconds(envelope.event_time) ??
      context.receivedAt,
    receivedAt: context.receivedAt,
    actor: {
      id: `slack:user:${event.user ?? "unknown-user"}`,
      displayName: event.user ?? "unknown Slack user",
      trust: trust.trust,
      trustReason: trust.trustReason,
    },
    body: {
      kind: "message",
      format: "plain",
      text: matched.text,
    },
  });

  if (!signal.ok) return { kind: "invalid", error: signal.error };
  return { kind: "signal", payload: signal.payload };
}

export function emitSlackTextInboundSignal(
  events: Pick<ModuleContext["events"], "emit">,
  event: SlackMessageEvent,
  envelope: SlackEventsApiPayload,
  context: SlackTextInboundSignalContext,
): SlackInboundSignalEmitResult {
  const signal = slackTextMessageToInboundSignal(event, envelope, context);
  if (signal.kind === "skip") {
    return { emitted: false, reason: signal.reason };
  }
  if (signal.kind === "invalid") return { emitted: false, error: signal.error };
  events.emit(inboundSignalReceived, signal.payload);
  return { emitted: true, payload: signal.payload };
}
