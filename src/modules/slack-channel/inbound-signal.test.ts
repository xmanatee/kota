import { describe, expect, it, vi } from "vitest";
import {
  inboundSignalReceived,
} from "#modules/inbound-signals/events.js";
import type { SlackEventsApiPayload, SlackMessageEvent } from "./client.js";
import {
  emitSlackTextInboundSignal,
  slackTextMessageToInboundSignal,
} from "./inbound-signal.js";

const RECEIVED_AT = "2026-05-25T03:50:00.000Z";

function slackMessage(
  text = "!task Capture the failed nightly build as follow-up work",
): SlackMessageEvent {
  return {
    type: "message",
    user: "U123",
    channel: "D123",
    text,
    ts: "1770000000.250000",
  };
}

function slackEnvelope(event = slackMessage()): SlackEventsApiPayload {
  return {
    team_id: "T123",
    event_id: "Ev123",
    event_time: 1770000000,
    event,
  };
}

const slackSignalContext = {
  scopeId: "scope-slack",
  receivedAt: RECEIVED_AT,
  config: {
    prefixes: ["!task"],
    trustedUserIds: ["U123"],
  },
};

describe("Slack channel inbound signal adapter", () => {
  it("normalizes a configured Slack text update into inbound.signal.received", () => {
    const result = slackTextMessageToInboundSignal(
      slackMessage(),
      slackEnvelope(),
      slackSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        scopeId: "scope-slack",
        provider: "slack",
        channel: "slack.message",
        accountId: "slack:T123",
        sourceId: "slack:T123:channel:D123",
        externalId: "slack:event:Ev123",
        actor: {
          id: "slack:user:U123",
          trust: "trusted",
        },
        body: {
          kind: "message",
          format: "plain",
          text: "Capture the failed nightly build as follow-up work",
        },
      },
    });
  });

  it("emits non-prefixed Slack text so shared routing decides eligibility", () => {
    const result = slackTextMessageToInboundSignal(
      slackMessage("ordinary chat session message"),
      slackEnvelope(),
      slackSignalContext,
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
    const result = emitSlackTextInboundSignal(
      events,
      slackMessage(),
      slackEnvelope(),
      slackSignalContext,
    );

    expect(result).toMatchObject({ emitted: true });
    if (!result.emitted) throw new Error("expected emit");
    expect(events.emit).toHaveBeenCalledWith(
      inboundSignalReceived,
      result.payload,
    );
  });
});
