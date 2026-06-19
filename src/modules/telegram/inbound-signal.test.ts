import { describe, expect, it, vi } from "vitest";
import {
  type InboundSignalRoutedPayload,
  inboundSignalReceived,
  inboundSignalRouted,
} from "#modules/inbound-signals/events.js";
import { dispatchInboundSignalRoute } from "#modules/inbound-signals/routing.js";
import type { TelegramMessage } from "./client.js";
import {
  emitTelegramTextInboundSignal,
  telegramTextMessageToInboundSignal,
} from "./inbound-signal.js";

const RECEIVED_AT = "2026-05-25T03:51:00.000Z";

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
            path: "queue",
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
      event: inboundSignalRouted.name,
      payload: {
        routeId: "telegram-9001-capture",
        provider: "telegram",
        channel: "telegram.message",
        sourceId: "telegram:chat:9001",
        actorTrust: "trusted",
      },
    });
  });
});
