import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { installEventIdempotency } from "./idempotency-events.js";
import {
  fingerprintIdempotencyParams,
  IdempotencyStore,
} from "./idempotency-store.js";

describe("IdempotencyStore", () => {
  let root: string;
  let nowMs: number;
  let store: IdempotencyStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-idempotency-store-"));
    nowMs = Date.parse("2026-06-05T12:00:00.000Z");
    store = new IdempotencyStore(join(root, "scope-a"), "scope-a", () => new Date(nowMs));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts the first request and replays exact duplicates", () => {
    const input = {
      scopeId: "scope-a",
      operation: "provider-write" as const,
      key: "tool:abc",
      parameterFingerprint: fingerprintIdempotencyParams({ slot: "7pm" }),
      result: { ok: true, bookingId: "book-1" },
    };

    const accepted = store.record(input);
    expect(accepted.status).toBe("accepted");
    if (accepted.status === "accepted") {
      expect(accepted.entry.retention).toEqual({
        kind: "expire-after-ms",
        durationMs: 7 * 24 * 60 * 60 * 1000,
      });
      expect(accepted.entry.expiresAt).toBe("2026-06-12T12:00:00.000Z");
    }
    const replayed = store.record(input);

    expect(replayed.status).toBe("replayed");
    if (replayed.status === "replayed") {
      expect(replayed.result).toEqual({ ok: true, bookingId: "book-1" });
      expect(replayed.entry.duplicateCount).toBe(1);
    }
  });

  it("rejects reused keys when parameters differ", () => {
    store.record({
      scopeId: "scope-a",
      operation: "provider-write",
      key: "tool:abc",
      parameterFingerprint: fingerprintIdempotencyParams({ slot: "7pm" }),
      result: { ok: true },
    });

    const rejected = store.record({
      scopeId: "scope-a",
      operation: "provider-write",
      key: "tool:abc",
      parameterFingerprint: fingerprintIdempotencyParams({ slot: "8pm" }),
      result: { ok: true },
    });

    expect(rejected.status).toBe("rejected");
    if (rejected.status === "rejected") {
      expect(rejected.reason).toBe("parameter_mismatch");
      expect(rejected.entry.conflictStatus).toBe("parameter_mismatch");
    }
  });

  it("persists retention, exposes expiry, then accepts the next request as fresh work", () => {
    const first = store.record({
      scopeId: "scope-a",
      operation: "workflow-dispatch",
      key: "workflow:abc",
      parameterFingerprint: "fp-1",
      result: { runId: "run-1" },
      retention: { kind: "expire-after-ms", durationMs: 10 },
    });
    expect(first.status).toBe("accepted");
    if (first.status === "accepted") {
      expect(first.entry.retention).toEqual({ kind: "expire-after-ms", durationMs: 10 });
      expect(first.entry.expiresAt).toBe("2026-06-05T12:00:00.010Z");
    }

    nowMs += 11;
    const expired = store.record({
      scopeId: "scope-a",
      operation: "workflow-dispatch",
      key: "workflow:abc",
      parameterFingerprint: "fp-2",
      result: { runId: "run-2" },
      retention: { kind: "expire-after-ms", durationMs: 10 },
    });

    expect(expired.status).toBe("expired");
    if (expired.status === "expired") {
      expect(expired.reason).toBe("retention_expired");
      expect(expired.entry.status).toBe("expired");
      expect(expired.entry.expiredAt).toBe("2026-06-05T12:00:00.011Z");
      expect(expired.entry.retention).toEqual({ kind: "expire-after-ms", durationMs: 10 });
    }
    expect(store.list({ status: "expired" })).toHaveLength(1);

    const fresh = store.record({
      scopeId: "scope-a",
      operation: "workflow-dispatch",
      key: "workflow:abc",
      parameterFingerprint: "fp-2",
      result: { runId: "run-2" },
      retention: { kind: "expire-after-ms", durationMs: 10 },
    });

    expect(fresh.status).toBe("accepted");
    if (fresh.status === "accepted") {
      expect(fresh.result).toEqual({ runId: "run-2" });
      expect(fresh.entry.status).toBe("accepted");
      expect(fresh.entry.retention).toEqual({ kind: "expire-after-ms", durationMs: 10 });
    }
  });

  it("isolates identical keys by scope", () => {
    const scopeA = store.record({
      scopeId: "scope-a",
      operation: "event-ingestion",
      key: "event:shared",
      parameterFingerprint: "fp-a",
      result: { event: "inbound.signal.received" },
    });
    const scopeB = store.record({
      scopeId: "scope-b",
      operation: "event-ingestion",
      key: "event:shared",
      parameterFingerprint: "fp-b",
      result: { event: "inbound.signal.received" },
    });

    expect(scopeA.status).toBe("accepted");
    expect(scopeB.status).toBe("accepted");
    expect(store.list({ scopeId: "scope-a" })).toHaveLength(1);
    expect(store.list({ scopeId: "scope-b" })).toHaveLength(1);
  });

  it("ignores concurrent duplicates while the first request is in progress", () => {
    const first = store.claim({
      scopeId: "scope-a",
      operation: "provider-write",
      key: "tool:race",
      parameterFingerprint: "fp",
    });
    expect(first.status).toBe("accepted");

    const duplicate = store.claim({
      scopeId: "scope-a",
      operation: "provider-write",
      key: "tool:race",
      parameterFingerprint: "fp",
    });
    expect(duplicate.status).toBe("ignored");

    if (first.status === "accepted") {
      store.complete(first.reservation, { ok: true });
    }
    const replayed = store.claim({
      scopeId: "scope-a",
      operation: "provider-write",
      key: "tool:race",
      parameterFingerprint: "fp",
    });
    expect(replayed.status).toBe("replayed");
  });

  it("suppresses duplicate provider events through bus middleware", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    installEventIdempotency(bus, {
      defaultScopeId: "scope-a",
      resolveStore: () => store,
    });
    bus.on("inbound.signal.received", (payload) => {
      seen.push(String(payload.externalId));
    });

    const payload = {
      scopeId: "scope-a",
      projectId: "scope-a",
      provider: "telegram",
      channel: "message",
      accountId: "acct",
      sourceId: "chat-1",
      externalId: "message-1",
      occurredAt: "2026-06-05T12:00:00.000Z",
      receivedAt: "2026-06-05T12:00:00.000Z",
    };
    bus.emit("inbound.signal.received", { ...payload });
    bus.emit("inbound.signal.received", {
      ...payload,
      receivedAt: "2026-06-05T12:00:01.000Z",
    });

    expect(seen).toEqual(["message-1"]);
    expect(store.list({ operation: "event-ingestion" })[0]?.status).toBe("replayed");
  });
});
