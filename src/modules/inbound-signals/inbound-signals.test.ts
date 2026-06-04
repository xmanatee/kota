import { describe, expect, it } from "vitest";
import {
  type InboundSignalReceivedPayload,
  inboundSignalReceived,
  normalizeInboundSignalInput,
  validateInboundSignalPayload,
} from "./events.js";
import inboundSignalsModule from "./index.js";

const RECEIVED_AT = "2026-05-25T02:40:00.000Z";

function sampleSignal(): InboundSignalReceivedPayload {
  return {
    scopeId: "project-1",
    projectId: "project-1",
    provider: "webhook",
    channel: "http",
    accountId: "manual",
    sourceId: "curl/demo",
    sourceUrl: "https://example.test/signals/demo",
    externalId: "delivery-1",
    occurredAt: "2026-05-25T02:39:55.000Z",
    receivedAt: RECEIVED_AT,
    actor: {
      id: "owner@example.test",
      displayName: "Owner",
      trust: "trusted",
      trustReason: "authenticated daemon API token",
    },
    body: {
      kind: "message",
      format: "plain",
      text: "Capture this into the appropriate workflow.",
    },
  };
}

describe("inbound-signals module", () => {
  it("owns the project-scoped inbound signal event declaration", () => {
    expect(inboundSignalsModule.events).toEqual([inboundSignalReceived]);
    expect(inboundSignalReceived.name).toBe("inbound.signal.received");
    expect(inboundSignalReceived.scope).toBe("project");
    expect(inboundSignalReceived.fields).toEqual([
      "scopeId",
      "projectId",
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
    ]);
  });

  it("validates the required scope, identity, trust, source, timestamp, and body fields", () => {
    expect(validateInboundSignalPayload(sampleSignal())).toMatchObject({ ok: true });

    expect(
      validateInboundSignalPayload({ ...sampleSignal(), scopeId: "" }),
    ).toEqual({
      ok: false,
      error: "scopeId must be a non-empty string",
    });
    expect(
      validateInboundSignalPayload({ ...sampleSignal(), projectId: "" }),
    ).toEqual({
      ok: false,
      error: "projectId must be a non-empty string",
    });
    expect(
      validateInboundSignalPayload({ ...sampleSignal(), projectId: "other" }),
    ).toEqual({
      ok: false,
      error: "scopeId and projectId must match",
    });
    expect(
      validateInboundSignalPayload({
        ...sampleSignal(),
        actor: { ...sampleSignal().actor, trust: "unknown" as never },
      }),
    ).toEqual({
      ok: false,
      error: "actor.trust must be trusted, untrusted, or blocked",
    });
    expect(
      validateInboundSignalPayload({
        ...sampleSignal(),
        body: { kind: "message", format: "plain", text: "" },
      }),
    ).toEqual({
      ok: false,
      error: "body.text must be a non-empty string",
    });
    expect(
      validateInboundSignalPayload({
        ...sampleSignal(),
        occurredAt: "not-a-date",
      }),
    ).toEqual({
      ok: false,
      error: "occurredAt must be an ISO-compatible timestamp",
    });
  });

  it("normalizes an adapter input by injecting project scope and receive time", () => {
    const result = normalizeInboundSignalInput(
      {
        provider: "webhook",
        channel: "http",
        accountId: "manual",
        sourceId: "curl/demo",
        sourceUrl: "https://example.test/signals/demo",
        externalId: "delivery-2",
        occurredAt: "2026-05-25T02:41:00.000Z",
        actor: {
          id: "owner@example.test",
          displayName: "Owner",
          trust: "trusted",
          trustReason: "authenticated daemon API token",
        },
        body: {
          kind: "action",
          action: "task.capture",
          label: "Capture task request",
          data: { title: "Investigate inbound automation", urgent: false },
        },
      },
      { projectId: "project-2", receivedAt: RECEIVED_AT },
    );

    expect(result).toMatchObject({
      ok: true,
      payload: {
        scopeId: "project-2",
        projectId: "project-2",
        receivedAt: RECEIVED_AT,
        body: {
          kind: "action",
          action: "task.capture",
        },
      },
    });
  });
});
