import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BusEnvelope } from "./event-bus.js";
import { EventBus } from "./event-bus.js";
import {
  type EventEnvelope,
  EventJournal,
  type EventJournalClientProjection,
  eventEnvelopeToBusEnvelope,
  installEventJournal,
} from "./event-journal.js";
import {
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "./module-event.js";
import { defineProjectScopedModuleEvent } from "./project-scope.js";

type TelegramSignal = {
  provider: string;
  channel: string;
  accountId: string;
  sourceId: string;
  sourceUrl: string;
  externalId: string;
  occurredAt: string;
  receivedAt: string;
  actor: {
    id: string;
    displayName: string;
    trust: string;
    trustReason: string;
  };
  body: {
    kind: "message";
    format: "plain";
    text: string;
  };
  token: string;
  correlationId: string;
  causationId: string;
  parentEventId: string;
  idempotencyKey: string;
  traceContext: {
    traceparent: string;
    tracestate: string;
  };
};

const telegramSignalReceived = defineProjectScopedModuleEvent<TelegramSignal>(
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
    "token",
    "correlationId",
    "causationId",
    "parentEventId",
    "idempotencyKey",
    "traceContext",
  ],
  {
    schemaVersion: 2,
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
            trust: { type: "string" },
            trustReason: { type: "string" },
          },
        },
        body: {
          type: "object",
          properties: {
            kind: { type: "string" },
            format: { type: "string" },
            text: { type: "string" },
          },
        },
        token: { type: "string", sensitivity: "secret" },
        correlationId: { type: "string" },
        causationId: { type: "string" },
        parentEventId: { type: "string" },
        idempotencyKey: { type: "string" },
        traceContext: {
          type: "object",
          properties: {
            traceparent: { type: "string" },
            tracestate: { type: "string" },
          },
        },
      },
      additionalProperties: false,
    },
    filterablePaths: ["provider", "channel", "sourceId", "externalId"],
    sensitivity: "internal",
  },
);

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `kota-event-journal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTelegramPayload() {
  return {
    scopeId: "scope-a",
    projectId: "scope-a",
    provider: "telegram",
    channel: "telegram",
    accountId: "acct-1",
    sourceId: "chat-9",
    sourceUrl: "https://t.me/c/9/1",
    externalId: "message-1",
    occurredAt: "2026-06-05T10:00:00.000Z",
    receivedAt: "2026-06-05T10:00:01.000Z",
    actor: {
      id: "user-7",
      displayName: "Owner",
      trust: "trusted",
      trustReason: "configured owner",
    },
    body: {
      kind: "message" as const,
      format: "plain" as const,
      text: "Book the 7pm court if available.",
    },
    token: "telegram-secret-token",
    correlationId: "corr-1",
    causationId: "owner-message-1",
    parentEventId: "evtj-000000000000",
    idempotencyKey: "telegram:acct-1:message-1",
    traceContext: {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "kota=telegram",
    },
  };
}

describe("EventJournal", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    resetModuleEventRegistry();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function trackTempDir(): string {
    const dir = makeTempDir();
    tempDirs.push(dir);
    return dir;
  }

  it("appends durable envelopes, queries by durable fields, and recovers the cursor after restart", () => {
    initModuleEventRegistry().register("telegram", telegramSignalReceived);
    const dir = trackTempDir();
    let now = new Date("2026-06-05T10:00:02.000Z");
    const journal = new EventJournal(dir, {
      now: () => now,
      scopeLineage: (scopeId) => ["global", scopeId],
    });
    const bus = new EventBus();
    const wildcard: BusEnvelope[] = [];
    bus.on("*", (envelope) => wildcard.push(envelope));
    const uninstall = installEventJournal(bus, journal);

    bus.emit(telegramSignalReceived, makeTelegramPayload());
    uninstall();

    expect(wildcard[0]?.eventId).toBe("evtj-000000000001");
    const sourceId = "telegram:telegram:acct-1:chat-9:message-1";
    const events = journal.query({
      type: "inbound.signal.received",
      scopeId: "scope-a",
      sourceId,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "evtj-000000000001",
      sequence: 1,
      event: { name: "inbound.signal.received", schema: { version: 2 } },
      source: { kind: "channel", id: sourceId },
      scope: { kind: "scope", scopeId: "scope-a", lineage: ["global", "scope-a"] },
      producer: {
        kind: "channel",
        provider: "telegram",
        channel: "telegram",
        sourceId: "chat-9",
        externalId: "message-1",
      },
      causality: {
        correlationId: "corr-1",
        causationId: "owner-message-1",
        parentEventId: "evtj-000000000000",
      },
      trace: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "kota=telegram",
      },
      idempotency: {
        idempotencyKey: "telegram:acct-1:message-1",
        externalProviderId: "message-1",
      },
    });

    const projection = journal.toClientProjection(events[0]!);
    expect(projection.payload.token).toBe("[redacted]");
    expect((projection.payload.body as { text: string }).text).toBe(
      "Book the 7pm court if available.",
    );

    const replayed: BusEnvelope[] = [];
    journal.replay({ id: events[0]!.id }, (envelope) => replayed.push(envelope));
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({
      type: "inbound.signal.received",
      eventId: "evtj-000000000001",
      schemaRef: { name: "inbound.signal.received", version: 2 },
      payload: { externalId: "message-1" },
    });

    now = new Date("2026-06-05T10:00:05.000Z");
    const restarted = new EventJournal(dir, { now: () => now });
    restarted.appendFromBusEnvelope({
      type: "daemon.config.reload",
      schemaRef: null,
      payload: {
        timestamp: "2026-06-05T10:00:04.000Z",
        scope: "daemon",
        outcome: "success",
        reloadKind: "noop",
        fullReload: false,
        changedModules: [],
        workflowCount: 1,
        sessionGuardrails: {
          refreshed: 0,
          unchanged: 0,
          nonRefreshable: [],
        },
      },
    });

    expect(restarted.query({ after: "evtj-000000000001" }).map((event) => event.id)).toEqual([
      "evtj-000000000002",
    ]);
    expect(restarted.query({ sinceMs: Date.parse("2026-06-05T10:00:03.000Z") })).toHaveLength(1);
  });

  it("excludes expired retained entries from queries", () => {
    const dir = trackTempDir();
    let now = new Date("2026-06-05T10:00:00.000Z");
    const journal = new EventJournal(dir, {
      now: () => now,
      retention: { kind: "expire-after-ms", durationMs: 10 },
    });

    journal.appendFromBusEnvelope({
      type: "custom.event",
      schemaRef: null,
      payload: { source: "test", receivedAt: "2026-06-05T10:00:00.000Z" },
    });
    expect(journal.query()).toHaveLength(1);

    now = new Date("2026-06-05T10:00:00.011Z");
    expect(journal.query()).toHaveLength(0);
  });

  it("redacts secret-shaped keys when no event schema is registered", () => {
    const journal = new EventJournal(trackTempDir());
    const envelope = journal.appendFromBusEnvelope({
      type: "custom.unregistered",
      schemaRef: null,
      payload: {
        token: "raw-token",
        nested: { password: "raw-password", safe: "visible" },
        values: [{ apiKey: "raw-key", label: "kept" }],
      },
    });

    const projection = journal.toClientProjection(envelope);

    expect(projection.payload.token).toBe("[redacted]");
    expect(projection.payload.nested).toEqual({
      password: "[redacted]",
      safe: "visible",
    });
    expect(projection.payload.values).toEqual([
      { apiKey: "[redacted]", label: "kept" },
    ]);
  });

  it("keeps the Telegram-like fixture aligned with the redacted client projection", () => {
    initModuleEventRegistry().register("telegram", telegramSignalReceived);
    const fixture = JSON.parse(
      readFileSync(
        join(process.cwd(), "src/core/events/fixtures/telegram-inbound-envelope.json"),
        "utf-8",
      ),
    ) as {
      envelope: EventEnvelope;
      clientProjection: EventJournalClientProjection;
    };
    const journal = new EventJournal(trackTempDir());

    expect(eventEnvelopeToBusEnvelope(fixture.envelope)).toMatchObject({
      type: "inbound.signal.received",
      eventId: "evtj-000000000001",
      payload: { provider: "telegram", externalId: "message-1" },
    });
    expect(journal.toClientProjection(fixture.envelope)).toEqual(fixture.clientProjection);
  });
});
