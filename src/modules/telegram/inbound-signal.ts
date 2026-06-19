import type { ModuleContext } from "#core/modules/module-types.js";
import {
  type InboundSignalActorTrust,
  type InboundSignalReceivedPayload,
  inboundSignalReceived,
  validateInboundSignalPayload,
} from "#modules/inbound-signals/events.js";
import type { TelegramMessage, TelegramUser } from "./client.js";

export type TelegramInboundSignalConfig = {
  prefixes: readonly string[];
  trustedChatIds?: readonly number[];
  blockedChatIds?: readonly number[];
};

export type TelegramTextInboundSignalContext = {
  projectId: string;
  receivedAt: string;
  config: TelegramInboundSignalConfig;
  allowedChatIds?: readonly number[];
};

export type TelegramTextInboundSignalBuildResult =
  | {
      kind: "signal";
      payload: InboundSignalReceivedPayload;
      consumed: boolean;
    }
  | {
      kind: "skip";
      reason: "empty-message";
    }
  | { kind: "invalid"; error: string };

export type TelegramInboundSignalEmitResult =
  | {
      emitted: true;
      payload: InboundSignalReceivedPayload;
      consumed: boolean;
    }
  | { emitted: false; reason: "empty-message" }
  | { emitted: false; error: string };

function automationText(
  text: string,
  prefixes: readonly string[],
): { ok: true; text: string; consumed: boolean } | { ok: false; reason: "empty-message" } {
  const trimmed = text.trimStart();
  for (const prefix of prefixes) {
    if (prefix.trim().length === 0) continue;
    if (!trimmed.startsWith(prefix)) continue;
    const body = trimmed.slice(prefix.length).trim();
    if (body.length === 0) return { ok: false, reason: "empty-message" };
    return { ok: true, text: body, consumed: true };
  }
  const body = trimmed.trim();
  if (body.length === 0) return { ok: false, reason: "empty-message" };
  return { ok: true, text: body, consumed: false };
}

function actorTrust(
  chatId: number,
  context: TelegramTextInboundSignalContext,
): { trust: InboundSignalActorTrust; trustReason: string } {
  if (context.config.blockedChatIds?.includes(chatId)) {
    return {
      trust: "blocked",
      trustReason: "Telegram chat id is configured in inboundSignals.blockedChatIds",
    };
  }
  if (context.config.trustedChatIds?.includes(chatId)) {
    return {
      trust: "trusted",
      trustReason: "Telegram chat id is configured in inboundSignals.trustedChatIds",
    };
  }
  if (context.allowedChatIds?.includes(chatId)) {
    return {
      trust: "trusted",
      trustReason: "Telegram chat id is allowed by modules.telegram.allowedChatIds",
    };
  }
  return {
    trust: "untrusted",
    trustReason:
      "Telegram chat id is not configured as trusted for inbound automation",
  };
}

function actorIdentity(
  from: TelegramUser | undefined,
  chatId: number,
): { id: string; displayName: string } {
  if (!from) {
    return {
      id: `telegram:chat:${chatId}`,
      displayName: `Telegram chat ${chatId}`,
    };
  }
  return {
    id: `telegram:user:${from.id}`,
    displayName: from.username ? `@${from.username}` : from.first_name,
  };
}

function timestampFromTelegramDate(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

export function telegramTextMessageToInboundSignal(
  message: TelegramMessage,
  context: TelegramTextInboundSignalContext,
): TelegramTextInboundSignalBuildResult {
  const text = message.text ?? "";
  const normalized = automationText(text, context.config.prefixes);
  if (!normalized.ok) return { kind: "skip", reason: normalized.reason };

  const chatId = message.chat.id;
  const actor = actorIdentity(message.from, chatId);
  const trust = actorTrust(chatId, context);
  const signal = validateInboundSignalPayload({
    scopeId: context.projectId,
    projectId: context.projectId,
    provider: "telegram",
    channel: "telegram.message",
    accountId: "telegram:bot",
    sourceId: `telegram:chat:${chatId}`,
    sourceUrl: `telegram://chat/${chatId}/message/${message.message_id}`,
    externalId: `telegram:${chatId}:${message.message_id}`,
    occurredAt: timestampFromTelegramDate(message.date) ?? context.receivedAt,
    receivedAt: context.receivedAt,
    actor: {
      id: actor.id,
      displayName: actor.displayName,
      trust: trust.trust,
      trustReason: trust.trustReason,
    },
    body: {
      kind: "message",
      format: "plain",
      text: normalized.text,
    },
  });

  if (!signal.ok) return { kind: "invalid", error: signal.error };
  return { kind: "signal", payload: signal.payload, consumed: normalized.consumed };
}

export function emitTelegramTextInboundSignal(
  events: Pick<ModuleContext["events"], "emit">,
  message: TelegramMessage,
  context: TelegramTextInboundSignalContext,
): TelegramInboundSignalEmitResult {
  const signal = telegramTextMessageToInboundSignal(message, context);
  if (signal.kind === "skip") {
    return { emitted: false, reason: signal.reason };
  }
  if (signal.kind === "invalid") return { emitted: false, error: signal.error };
  events.emit(inboundSignalReceived, signal.payload);
  return { emitted: true, payload: signal.payload, consumed: signal.consumed };
}
