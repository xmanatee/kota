import type { ModuleContext } from "#core/modules/module-types.js";
import {
  type InboundSignalActionBody,
  type InboundSignalActorTrust,
  type InboundSignalJsonValue,
  type InboundSignalMessageBody,
  type InboundSignalReceivedPayload,
  inboundSignalReceived,
  validateInboundSignalPayload,
} from "#modules/inbound-signals/events.js";
import type {
  TelegramCallbackQuery,
  TelegramChat,
  TelegramChatMemberUpdated,
  TelegramMessage,
  TelegramMessageReactionUpdated,
  TelegramReactionType,
  TelegramUpdate,
  TelegramUser,
} from "./client.js";

export const TELEGRAM_SIGNAL_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "message_reaction",
  "my_chat_member",
  "chat_member",
] as const;

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

export type TelegramInboundSignalContext = TelegramTextInboundSignalContext;

export type TelegramInboundSignalSkipReason =
  | "empty-message"
  | "unsupported-update"
  | "unsupported-presence"
  | "unsupported-delete"
  | "missing-chat";

export type TelegramInboundSignalBuildResult =
  | {
      kind: "signal";
      payload: InboundSignalReceivedPayload;
      consumed: boolean;
    }
  | {
      kind: "skip";
      reason: TelegramInboundSignalSkipReason;
    }
  | { kind: "invalid"; error: string };

export type TelegramTextInboundSignalBuildResult = TelegramInboundSignalBuildResult;

export type TelegramInboundSignalEmitResult =
  | {
      emitted: true;
      payload: InboundSignalReceivedPayload;
      consumed: boolean;
    }
  | { emitted: false; reason: TelegramInboundSignalSkipReason }
  | { emitted: false; error: string };

type MutableInboundSignalJsonObject = {
  [key: string]: InboundSignalJsonValue;
};

type BuildPayloadInput = {
  context: TelegramInboundSignalContext;
  chat: TelegramChat;
  actorUser?: TelegramUser;
  actorChat?: TelegramChat;
  channel: string;
  sourceUrl: string;
  externalId: string;
  occurredAt: string;
  body: InboundSignalMessageBody | InboundSignalActionBody;
};

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
  context: TelegramInboundSignalContext,
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

function userDisplayName(user: TelegramUser): string {
  return user.username ? `@${user.username}` : user.first_name;
}

function chatDisplayName(chat: TelegramChat): string {
  if (chat.username) return `@${chat.username}`;
  return chat.title ?? chat.first_name ?? `Telegram chat ${chat.id}`;
}

function actorIdentity(
  user: TelegramUser | undefined,
  actorChat: TelegramChat | undefined,
  sourceChatId: number,
): { id: string; displayName: string } {
  if (user) {
    return {
      id: `telegram:user:${user.id}`,
      displayName: userDisplayName(user),
    };
  }
  if (actorChat) {
    return {
      id: `telegram:chat:${actorChat.id}`,
      displayName: chatDisplayName(actorChat),
    };
  }
  return {
    id: `telegram:chat:${sourceChatId}`,
    displayName: `Telegram chat ${sourceChatId}`,
  };
}

function timestampFromTelegramDate(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

function messageSourceUrl(chatId: number, messageId: number): string {
  return `telegram://chat/${chatId}/message/${messageId}`;
}

function compactString(value: string, maxLength = 256): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 3)}...`
    : compact;
}

function validateTelegramPayload(
  input: BuildPayloadInput,
): TelegramInboundSignalBuildResult {
  const actor = actorIdentity(input.actorUser, input.actorChat, input.chat.id);
  const trust = actorTrust(input.chat.id, input.context);
  const signal = validateInboundSignalPayload({
    scopeId: input.context.projectId,
    projectId: input.context.projectId,
    provider: "telegram",
    channel: input.channel,
    accountId: "telegram:bot",
    sourceId: `telegram:chat:${input.chat.id}`,
    sourceUrl: input.sourceUrl,
    externalId: input.externalId,
    occurredAt: input.occurredAt,
    receivedAt: input.context.receivedAt,
    actor: {
      id: actor.id,
      displayName: actor.displayName,
      trust: trust.trust,
      trustReason: trust.trustReason,
    },
    body: input.body,
  });

  if (!signal.ok) return { kind: "invalid", error: signal.error };
  return { kind: "signal", payload: signal.payload, consumed: false };
}

function telegramMessageTextToInboundSignal(args: {
  message: TelegramMessage;
  text: string;
  context: TelegramInboundSignalContext;
  channel: string;
  externalId: string;
  occurredAt?: string;
}): TelegramInboundSignalBuildResult {
  const normalized = automationText(args.text, args.context.config.prefixes);
  if (!normalized.ok) return { kind: "skip", reason: normalized.reason };

  const result = validateTelegramPayload({
    context: args.context,
    chat: args.message.chat,
    actorUser: args.message.from,
    channel: args.channel,
    sourceUrl: messageSourceUrl(args.message.chat.id, args.message.message_id),
    externalId: args.externalId,
    occurredAt:
      args.occurredAt ??
      timestampFromTelegramDate(args.message.date) ??
      args.context.receivedAt,
    body: {
      kind: "message",
      format: "plain",
      text: normalized.text,
    },
  });

  if (result.kind !== "signal") return result;
  return { ...result, consumed: normalized.consumed };
}

export function telegramTextMessageToInboundSignal(
  message: TelegramMessage,
  context: TelegramInboundSignalContext,
): TelegramTextInboundSignalBuildResult {
  return telegramMessageTextToInboundSignal({
    message,
    text: message.text ?? "",
    context,
    channel: "telegram.message",
    externalId: `telegram:${message.chat.id}:${message.message_id}`,
  });
}

export function telegramMediaCaptionToInboundSignal(
  message: TelegramMessage,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalBuildResult {
  return telegramMessageTextToInboundSignal({
    message,
    text: message.caption ?? "",
    context,
    channel: "telegram.media_caption",
    externalId: `telegram:${message.chat.id}:${message.message_id}:caption`,
  });
}

export function telegramVoiceTranscriptToInboundSignal(
  message: TelegramMessage,
  transcript: string,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalBuildResult {
  return telegramMessageTextToInboundSignal({
    message,
    text: transcript,
    context,
    channel: "telegram.voice_transcript",
    externalId: `telegram:${message.chat.id}:${message.message_id}:voice-transcript`,
  });
}

export function telegramEditedMessageToInboundSignal(
  message: TelegramMessage,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalBuildResult {
  const text = message.text ?? message.caption ?? "";
  return telegramMessageTextToInboundSignal({
    message,
    text,
    context,
    channel: "telegram.edited_message",
    externalId: `telegram:${message.chat.id}:${message.message_id}:edited`,
    occurredAt:
      timestampFromTelegramDate(message.edit_date) ??
      timestampFromTelegramDate(message.date) ??
      context.receivedAt,
  });
}

export function telegramMessageToInboundSignal(
  message: TelegramMessage,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalBuildResult {
  if (message.text !== undefined) {
    return telegramTextMessageToInboundSignal(message, context);
  }
  if (message.caption !== undefined) {
    return telegramMediaCaptionToInboundSignal(message, context);
  }
  return { kind: "skip", reason: "unsupported-update" };
}

function reactionLabel(reaction: TelegramReactionType): string {
  if (reaction.type === "emoji" && reaction.emoji) {
    return `emoji:${reaction.emoji}`;
  }
  if (reaction.type === "custom_emoji" && reaction.custom_emoji_id) {
    return `custom_emoji:${reaction.custom_emoji_id}`;
  }
  return reaction.type;
}

export function telegramMessageReactionToInboundSignal(
  reaction: TelegramMessageReactionUpdated,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalBuildResult {
  const data: MutableInboundSignalJsonObject = {
    messageId: reaction.message_id,
    oldReaction: reaction.old_reaction.map(reactionLabel),
    newReaction: reaction.new_reaction.map(reactionLabel),
  };
  if (reaction.actor_chat) data.actorChatId = reaction.actor_chat.id;

  return validateTelegramPayload({
    context,
    chat: reaction.chat,
    actorUser: reaction.user,
    actorChat: reaction.actor_chat,
    channel: "telegram.message_reaction",
    sourceUrl: messageSourceUrl(reaction.chat.id, reaction.message_id),
    externalId: `telegram:${reaction.chat.id}:${reaction.message_id}:reaction:${reaction.date}`,
    occurredAt: timestampFromTelegramDate(reaction.date) ?? context.receivedAt,
    body: {
      kind: "action",
      action: "telegram.message_reaction",
      label: "Message reaction changed",
      data,
    },
  });
}

export function telegramCallbackQueryToInboundSignal(
  callback: TelegramCallbackQuery,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalBuildResult {
  const message = callback.message;
  if (!message) return { kind: "skip", reason: "missing-chat" };
  const data: MutableInboundSignalJsonObject = {
    callbackQueryId: callback.id,
    callbackData: callback.data ? compactString(callback.data) : "",
    messageId: message.message_id,
  };

  return validateTelegramPayload({
    context,
    chat: message.chat,
    actorUser: callback.from,
    channel: "telegram.callback",
    sourceUrl: `${messageSourceUrl(message.chat.id, message.message_id)}/callback/${callback.id}`,
    externalId: `telegram:${message.chat.id}:${message.message_id}:callback:${callback.id}`,
    occurredAt: timestampFromTelegramDate(message.date) ?? context.receivedAt,
    body: {
      kind: "action",
      action: "telegram.callback_query",
      label: callback.data ? compactString(callback.data, 80) : "Callback query",
      data,
    },
  });
}

export function telegramChatMemberUpdateToInboundSignal(
  update: TelegramChatMemberUpdated,
  context: TelegramInboundSignalContext,
  channel: "telegram.chat_member" | "telegram.my_chat_member" = "telegram.chat_member",
): TelegramInboundSignalBuildResult {
  const subject = update.new_chat_member.user;
  const data: MutableInboundSignalJsonObject = {
    oldStatus: update.old_chat_member.status,
    newStatus: update.new_chat_member.status,
    subjectUserId: subject.id,
    subjectDisplayName: userDisplayName(subject),
    actorUserId: update.from.id,
  };

  return validateTelegramPayload({
    context,
    chat: update.chat,
    actorUser: update.from,
    channel,
    sourceUrl: `telegram://chat/${update.chat.id}/member/${subject.id}`,
    externalId: `telegram:${update.chat.id}:member:${subject.id}:${update.date}:${update.old_chat_member.status}->${update.new_chat_member.status}`,
    occurredAt: timestampFromTelegramDate(update.date) ?? context.receivedAt,
    body: {
      kind: "action",
      action: "telegram.chat_member_updated",
      label: `${userDisplayName(subject)} ${update.old_chat_member.status}->${update.new_chat_member.status}`,
      data,
    },
  });
}

export function telegramPresenceToInboundSignal(): TelegramInboundSignalBuildResult {
  return { kind: "skip", reason: "unsupported-presence" };
}

export function telegramDeletedMessageToInboundSignal(): TelegramInboundSignalBuildResult {
  return { kind: "skip", reason: "unsupported-delete" };
}

export function telegramUpdateToInboundSignal(
  update: TelegramUpdate,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalBuildResult {
  if (update.message) return telegramMessageToInboundSignal(update.message, context);
  if (update.edited_message) {
    return telegramEditedMessageToInboundSignal(update.edited_message, context);
  }
  if (update.callback_query) {
    return telegramCallbackQueryToInboundSignal(update.callback_query, context);
  }
  if (update.message_reaction) {
    return telegramMessageReactionToInboundSignal(update.message_reaction, context);
  }
  if (update.my_chat_member) {
    return telegramChatMemberUpdateToInboundSignal(
      update.my_chat_member,
      context,
      "telegram.my_chat_member",
    );
  }
  if (update.chat_member) {
    return telegramChatMemberUpdateToInboundSignal(update.chat_member, context);
  }
  return { kind: "skip", reason: "unsupported-update" };
}

function emitSignalResult(
  events: Pick<ModuleContext["events"], "emit">,
  signal: TelegramInboundSignalBuildResult,
): TelegramInboundSignalEmitResult {
  if (signal.kind === "skip") {
    return { emitted: false, reason: signal.reason };
  }
  if (signal.kind === "invalid") return { emitted: false, error: signal.error };
  events.emit(inboundSignalReceived, signal.payload);
  return { emitted: true, payload: signal.payload, consumed: signal.consumed };
}

export function emitTelegramTextInboundSignal(
  events: Pick<ModuleContext["events"], "emit">,
  message: TelegramMessage,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalEmitResult {
  return emitSignalResult(
    events,
    telegramTextMessageToInboundSignal(message, context),
  );
}

export function emitTelegramMessageInboundSignal(
  events: Pick<ModuleContext["events"], "emit">,
  message: TelegramMessage,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalEmitResult {
  return emitSignalResult(events, telegramMessageToInboundSignal(message, context));
}

export function emitTelegramVoiceTranscriptInboundSignal(
  events: Pick<ModuleContext["events"], "emit">,
  message: TelegramMessage,
  transcript: string,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalEmitResult {
  return emitSignalResult(
    events,
    telegramVoiceTranscriptToInboundSignal(message, transcript, context),
  );
}

export function emitTelegramUpdateInboundSignal(
  events: Pick<ModuleContext["events"], "emit">,
  update: TelegramUpdate,
  context: TelegramInboundSignalContext,
): TelegramInboundSignalEmitResult {
  return emitSignalResult(events, telegramUpdateToInboundSignal(update, context));
}
