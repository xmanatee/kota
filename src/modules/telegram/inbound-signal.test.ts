import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type InboundSignalRoutedPayload,
  inboundSignalReceived,
  inboundSignalWorkflowTargeted,
} from "#modules/inbound-signals/events.js";
import { dispatchInboundSignalRoute } from "#modules/inbound-signals/routing.js";
import type {
  TelegramChatMemberUpdated,
  TelegramMessage,
  TelegramMessageReactionUpdated,
  TelegramUpdate,
} from "./client.js";
import {
  emitTelegramTextInboundSignal,
  telegramCallbackQueryToInboundSignal,
  telegramChatMemberUpdateToInboundSignal,
  telegramDeletedMessageToInboundSignal,
  telegramEditedMessageToInboundSignal,
  telegramMediaCaptionToInboundSignal,
  telegramMessageReactionToInboundSignal,
  telegramPresenceToInboundSignal,
  telegramTextMessageToInboundSignal,
  telegramUpdateToInboundSignal,
  telegramVoiceTranscriptToInboundSignal,
} from "./inbound-signal.js";

const RECEIVED_AT = "2026-05-25T03:51:00.000Z";

function writeEvidenceFile(fileName: string, body: string): void {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return;
  const dir = join(runDir, "telegram-inbound-signals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), body, "utf-8");
}

function telegramMessage(
  text = "!task Capture the flaky Telegram deploy check",
): TelegramMessage {
  return {
    message_id: 42,
    from: { id: 77, first_name: "Operator", username: "operator" },
    chat: { id: 9001, type: "private", first_name: "Operator" },
    text,
    date: 1770000000,
  };
}

function telegramCaptionMessage(
  caption = "!task Badminton doubles Sunday 10:30. Looking for one sub.",
): TelegramMessage {
  return {
    ...telegramMessage(""),
    message_id: 43,
    text: undefined,
    caption,
    photo: [
      {
        file_id: "redacted-photo-file-id",
        file_unique_id: "redacted-photo-unique-id",
        width: 640,
        height: 480,
      },
    ],
  };
}

function telegramReaction(): TelegramMessageReactionUpdated {
  return {
    chat: { id: 9001, type: "supergroup", title: "Sports Chat" },
    message_id: 42,
    user: { id: 78, first_name: "Reviewer", username: "reviewer" },
    date: 1770000010,
    old_reaction: [],
    new_reaction: [{ type: "emoji", emoji: "👍" }],
  };
}

function telegramMembershipUpdate(): TelegramChatMemberUpdated {
  return {
    chat: { id: 9001, type: "supergroup", title: "Sports Chat" },
    from: { id: 79, first_name: "Admin", username: "admin" },
    date: 1770000020,
    old_chat_member: {
      user: { id: 80, first_name: "Player", username: "player" },
      status: "left",
    },
    new_chat_member: {
      user: { id: 80, first_name: "Player", username: "player" },
      status: "member",
    },
  };
}

const telegramSignalContext = {
  projectId: "project-telegram",
  receivedAt: RECEIVED_AT,
  config: {
    prefixes: ["!task"],
    trustedChatIds: [9001],
  },
};

describe("Telegram inbound signal adapter", () => {
  it("normalizes a configured Telegram text update into inbound.signal.received", () => {
    const result = telegramTextMessageToInboundSignal(
      telegramMessage(),
      telegramSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        projectId: "project-telegram",
        provider: "telegram",
        channel: "telegram.message",
        accountId: "telegram:bot",
        sourceId: "telegram:chat:9001",
        externalId: "telegram:9001:42",
        actor: {
          id: "telegram:user:77",
          displayName: "@operator",
          trust: "trusted",
        },
        body: {
          kind: "message",
          format: "plain",
          text: "Capture the flaky Telegram deploy check",
        },
      },
    });
  });

  it("uses the existing allowed-chat gate as trust metadata when configured", () => {
    const result = telegramTextMessageToInboundSignal(telegramMessage(), {
      projectId: "project-telegram",
      receivedAt: RECEIVED_AT,
      config: { prefixes: ["!task"] },
      allowedChatIds: [9001],
    });

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        actor: {
          trust: "trusted",
          trustReason:
            "Telegram chat id is allowed by modules.telegram.allowedChatIds",
        },
      },
    });
  });

  it("emits non-prefixed Telegram text so shared routing decides eligibility", () => {
    const result = telegramTextMessageToInboundSignal(
      telegramMessage("ordinary chat session message"),
      telegramSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        body: {
          kind: "message",
          format: "plain",
          text: "ordinary chat session message",
        },
      },
    });
  });

  it("normalizes Telegram media captions into bounded message signals", () => {
    const result = telegramMediaCaptionToInboundSignal(
      telegramCaptionMessage(),
      telegramSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        channel: "telegram.media_caption",
        externalId: "telegram:9001:43:caption",
        body: {
          kind: "message",
          text: "Badminton doubles Sunday 10:30. Looking for one sub.",
        },
      },
      consumed: true,
    });
    if (result.kind !== "signal") throw new Error("expected caption signal");
    expect(JSON.stringify(result.payload)).not.toContain("redacted-photo-file-id");
  });

  it("normalizes transcribed voice and audio messages without storing raw media", () => {
    const result = telegramVoiceTranscriptToInboundSignal(
      {
        ...telegramMessage(""),
        text: undefined,
        voice: {
          file_id: "redacted-voice-file-id",
          duration: 11,
          mime_type: "audio/ogg",
        },
      },
      "!task Voice says tennis at 18:30",
      telegramSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        channel: "telegram.voice_transcript",
        externalId: "telegram:9001:42:voice-transcript",
        body: {
          kind: "message",
          text: "Voice says tennis at 18:30",
        },
      },
      consumed: true,
    });
    if (result.kind !== "signal") throw new Error("expected voice signal");
    expect(JSON.stringify(result.payload)).not.toContain("redacted-voice-file-id");
  });

  it("normalizes edited Telegram messages as a distinct signal channel", () => {
    const result = telegramEditedMessageToInboundSignal(
      {
        ...telegramMessage("!task Tennis moved to 18:30"),
        edit_date: 1770000060,
      },
      telegramSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        channel: "telegram.edited_message",
        externalId: "telegram:9001:42:edited",
        occurredAt: "2026-02-02T02:41:00.000Z",
        body: {
          kind: "message",
          text: "Tennis moved to 18:30",
        },
      },
    });
  });

  it("normalizes Telegram reaction updates into bounded action signals", () => {
    const result = telegramMessageReactionToInboundSignal(
      telegramReaction(),
      telegramSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        channel: "telegram.message_reaction",
        externalId: "telegram:9001:42:reaction:1770000010",
        actor: {
          id: "telegram:user:78",
          displayName: "@reviewer",
        },
        body: {
          kind: "action",
          action: "telegram.message_reaction",
          data: {
            messageId: 42,
            oldReaction: [],
            newReaction: ["emoji:👍"],
          },
        },
      },
    });
  });

  it("normalizes Telegram callback actions that are not consumed by owner controls", () => {
    const result = telegramCallbackQueryToInboundSignal(
      {
        id: "callback-1",
        from: { id: 81, first_name: "Operator", username: "operator" },
        message: telegramMessage("Choose a court"),
        data: "court:4",
      },
      telegramSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        channel: "telegram.callback",
        externalId: "telegram:9001:42:callback:callback-1",
        actor: {
          id: "telegram:user:81",
        },
        body: {
          kind: "action",
          action: "telegram.callback_query",
          label: "court:4",
          data: {
            callbackQueryId: "callback-1",
            callbackData: "court:4",
            messageId: 42,
          },
        },
      },
    });
  });

  it("normalizes Telegram membership and status updates", () => {
    const result = telegramChatMemberUpdateToInboundSignal(
      telegramMembershipUpdate(),
      telegramSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        channel: "telegram.chat_member",
        externalId: "telegram:9001:member:80:1770000020:left->member",
        actor: {
          id: "telegram:user:79",
          displayName: "@admin",
        },
        body: {
          kind: "action",
          action: "telegram.chat_member_updated",
          label: "@player left->member",
          data: {
            oldStatus: "left",
            newStatus: "member",
            subjectUserId: 80,
          },
        },
      },
    });
  });

  it("documents Bot API signals that cannot be delivered to bots", () => {
    expect(telegramPresenceToInboundSignal()).toEqual({
      kind: "skip",
      reason: "unsupported-presence",
    });
    expect(telegramDeletedMessageToInboundSignal()).toEqual({
      kind: "skip",
      reason: "unsupported-delete",
    });
  });

  it("emits the shared typed event only after adapter validation succeeds", () => {
    const events = { emit: vi.fn() };
    const result = emitTelegramTextInboundSignal(
      events,
      telegramMessage(),
      telegramSignalContext,
    );

    expect(result).toMatchObject({ emitted: true });
    if (!result.emitted) throw new Error("expected emit");
    expect(events.emit).toHaveBeenCalledWith(
      inboundSignalReceived,
      result.payload,
    );
  });

  it("routes a configured Telegram chat source through the shared dispatcher", async () => {
    const signal = telegramTextMessageToInboundSignal(
      telegramMessage(),
      telegramSignalContext,
    );
    if (signal.kind !== "signal") throw new Error("expected Telegram signal");
    const queued: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const routed: InboundSignalRoutedPayload[] = [];

    const routeResult = await dispatchInboundSignalRoute({
      config: {
        routes: [
          {
            id: "telegram-9001-capture",
            provider: "telegram",
            channel: "telegram.message",
            sourceId: "telegram:chat:9001",
            targets: [{ kind: "workflow", name: "telegram-signal-probe" }],
          },
        ],
      },
      signal: signal.payload,
      context: {
        workflowNames: new Set(["telegram-signal-probe"]),
        agentNames: new Set(),
      },
      deps: {
        async triggerWorkflow(_name, options) {
          queued.push({
            event: options.event ?? "manual",
            payload: options.payload ?? {},
          });
          return {
            ok: true,
            path: "daemon",
            queued: "telegram-signal-probe",
            runId: "run-telegram-9001",
          };
        },
        emitRouted(payload) {
          routed.push(payload);
        },
      },
    });

    expect(routed).toEqual([routeResult]);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      event: inboundSignalWorkflowTargeted,
      payload: {
        routeId: "telegram-9001-capture",
        provider: "telegram",
        channel: "telegram.message",
        sourceId: "telegram:chat:9001",
        actorTrust: "trusted",
      },
    });
  });

  it("records blocked and archived Telegram sources without workflow dispatch", async () => {
    const blockedSignal = telegramTextMessageToInboundSignal(telegramMessage(), {
      ...telegramSignalContext,
      config: {
        prefixes: ["!task"],
        blockedChatIds: [9001],
      },
    });
    if (blockedSignal.kind !== "signal") throw new Error("expected blocked signal");

    const archivedSignal = telegramTextMessageToInboundSignal(telegramMessage(), {
      ...telegramSignalContext,
      config: {
        prefixes: ["!task"],
        trustedChatIds: [9001],
      },
    });
    if (archivedSignal.kind !== "signal") throw new Error("expected archived signal");

    const emitted: InboundSignalRoutedPayload[] = [];
    const triggerWorkflow = vi.fn(async () => ({
      ok: true as const,
      path: "daemon" as const,
      queued: "telegram-signal-probe",
      runId: "run-telegram-source",
    }));

    const blockedResult = await dispatchInboundSignalRoute({
      config: {
        routes: [
          {
            id: "telegram-blocked-group",
            provider: "telegram",
            channel: "telegram.message",
            actorTrust: "blocked",
            sourceStatus: "blocked",
            targets: [{ kind: "workflow", name: "telegram-signal-probe" }],
          },
        ],
      },
      signal: blockedSignal.payload,
      context: {
        workflowNames: new Set(["telegram-signal-probe"]),
        agentNames: new Set(),
      },
      deps: {
        triggerWorkflow,
        emitRouted(payload) {
          emitted.push(payload);
        },
      },
    });

    const archivedResult = await dispatchInboundSignalRoute({
      config: {
        routes: [
          {
            id: "telegram-archived-group",
            provider: "telegram",
            channel: "telegram.message",
            sourceId: "telegram:chat:9001",
            sourceStatus: "archived",
            targets: [{ kind: "workflow", name: "telegram-signal-probe" }],
          },
        ],
      },
      signal: archivedSignal.payload,
      context: {
        workflowNames: new Set(["telegram-signal-probe"]),
        agentNames: new Set(),
      },
      deps: {
        triggerWorkflow,
        emitRouted(payload) {
          emitted.push(payload);
        },
      },
    });

    expect(triggerWorkflow).not.toHaveBeenCalled();
    expect(blockedResult).toMatchObject({
      decision: "blocked",
      sourceStatus: "blocked",
      targets: [
        {
          status: "skipped",
          reason: "source status is blocked; route is audit-only",
        },
      ],
    });
    expect(archivedResult).toMatchObject({
      decision: "archived",
      sourceStatus: "archived",
      targets: [
        {
          status: "skipped",
          reason: "source status is archived; route is audit-only",
        },
      ],
    });
    expect(emitted).toEqual([blockedResult, archivedResult]);
  });

  it("normalizes the redacted community fixture into dispatcher-ready signals", async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/community-inbound-updates.json", import.meta.url),
        "utf-8",
      ),
    ) as { updates: TelegramUpdate[] };

    const signals = fixture.updates.map((update) =>
      telegramUpdateToInboundSignal(update, {
        projectId: "project-telegram",
        receivedAt: RECEIVED_AT,
        config: {
          prefixes: ["!sport"],
          trustedChatIds: [-7001],
          blockedChatIds: [-9001],
        },
      })
    );

    expect(signals).toHaveLength(6);
    expect(signals.every((signal) => signal.kind === "signal")).toBe(true);
    expect(signals.map((signal) => {
      if (signal.kind === "signal") return signal.payload.channel;
      if (signal.kind === "skip") return signal.reason;
      return signal.error;
    })).toEqual([
      "telegram.message",
      "telegram.media_caption",
      "telegram.edited_message",
      "telegram.message_reaction",
      "telegram.chat_member",
      "telegram.message",
    ]);
    expect(signals[5]).toMatchObject({
      kind: "signal",
      payload: {
        actor: {
          trust: "blocked",
        },
        body: {
          kind: "message",
          text: "Tennis spam from archived group.",
        },
      },
    });
    expect(JSON.stringify(signals)).not.toContain("redacted-photo-file-id");

    const firstSignal = signals[0];
    if (firstSignal.kind !== "signal") throw new Error("expected first fixture signal");
    const queued: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const routed: InboundSignalRoutedPayload[] = [];
    const routeResult = await dispatchInboundSignalRoute({
      config: {
        routes: [
          {
            id: "telegram-sports-community-batch",
            provider: "telegram",
            sourceId: "telegram:chat:-7001",
            targets: [{ kind: "workflow", name: "telegram-community-intake" }],
          },
        ],
      },
      signal: firstSignal.payload,
      context: {
        workflowNames: new Set(["telegram-community-intake"]),
        agentNames: new Set(),
      },
      deps: {
        async triggerWorkflow(_name, options) {
          queued.push({
            event: options.event ?? "manual",
            payload: options.payload ?? {},
          });
          return {
            ok: true,
            path: "daemon",
            queued: "telegram-community-intake",
            runId: "run-telegram-community-intake",
          };
        },
        emitRouted(payload) {
          routed.push(payload);
        },
      },
    });

    expect(routeResult).toMatchObject({
      decision: "dispatched",
      routeId: "telegram-sports-community-batch",
      targets: [
        {
          kind: "workflow",
          name: "telegram-community-intake",
          status: "queued",
        },
      ],
    });
    expect(routed).toEqual([routeResult]);
    expect(queued).toHaveLength(1);
    writeEvidenceFile(
      "dispatcher-delivery.json",
      JSON.stringify(
        {
          fixture: "community-inbound-updates.json",
          normalizedChannels: signals.map((signal) =>
            signal.kind === "signal" ? signal.payload.channel : signal.kind
          ),
          dispatcher: {
            routeId: routeResult.routeId,
            decision: routeResult.decision,
            event: queued[0]?.event,
            queuedWorkflow: routeResult.targets[0]?.name,
            targetStatus: routeResult.targets[0]?.status,
            sourceId: routeResult.sourceId,
          },
        },
        null,
        2,
      ),
    );
  });
});
