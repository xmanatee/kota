/**
 * Wire-level coverage for the `/api/history/search` route as consumed by
 * `DaemonControlClient.history.search`. A tiny in-process HTTP server
 * answers each branch the route declares — success, empty results,
 * semantic-unavailable, malformed envelope, and HTTP error — so the
 * client's parsing and surface-shape obligations are exercised against
 * a real fetch round-trip rather than a mock.
 */
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConversationRecord } from "#core/modules/provider-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import historyModule from "./index.js";

type SearchResponder = (
  query: URLSearchParams,
) => { status: number; body: string };

type MockServer = {
  server: Server;
  port: number;
  setSearchResponder(fn: SearchResponder): void;
  stop(): Promise<void>;
};

async function startMockServer(): Promise<MockServer> {
  let respond: SearchResponder = () => ({
    status: 500,
    body: JSON.stringify({ error: "no responder set" }),
  });

  const server = createServer((req, res) => {
    if (req.method !== "GET" || !req.url?.startsWith("/api/history/search")) {
      res.writeHead(404).end();
      return;
    }
    const url = new URL(req.url, "http://127.0.0.1");
    const { status, body } = respond(url.searchParams);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve(addr.port);
    });
  });

  return {
    server,
    port,
    setSearchResponder(fn) {
      respond = fn;
    },
    stop() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function makeRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "conv-abc",
    title: "Wire-test conversation",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T01:00:00Z",
    model: "claude",
    messageCount: 2,
    cwd: "/repo",
    source: "user",
    ...overrides,
  };
}

describe("DaemonControlClient.history.search", () => {
  let mock: MockServer;
  let client: DaemonControlClient;

  beforeEach(async () => {
    mock = await startMockServer();
    client = DaemonControlClient.fromAddressWithFactory(
      {
        port: mock.port,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        token: "test-token",
      },
      (link) => {
        const stubs = buildMigratedNamespaceTestStubs();
        delete stubs.history;
        return { ...stubs, ...historyModule.daemonClient!(link) };
      },
    );
  });

  afterEach(async () => {
    await mock.stop();
  });

  it("forwards filter params and returns ok:true with conversations on success", async () => {
    const captured: { params: URLSearchParams | null } = { params: null };
    mock.setSearchResponder((params) => {
      captured.params = params;
      return {
        status: 200,
        body: JSON.stringify({
          ok: true,
          conversations: [makeRecord({ title: "Match A" })],
        }),
      };
    });

    const result = await client.history.search("hello", {
      semantic: true,
      cwd: "/repo",
      source: "user",
      limit: 7,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].title).toBe("Match A");
    }
    expect(captured.params?.get("q")).toBe("hello");
    expect(captured.params?.get("semantic")).toBe("true");
    expect(captured.params?.get("cwd")).toBe("/repo");
    expect(captured.params?.get("source")).toBe("user");
    expect(captured.params?.get("limit")).toBe("7");
  });

  it("returns ok:true with conversations:[] for empty results", async () => {
    mock.setSearchResponder(() => ({
      status: 200,
      body: JSON.stringify({ ok: true, conversations: [] }),
    }));

    const result = await client.history.search("nothing-matches", {
      semantic: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.conversations).toEqual([]);
  });

  it("surfaces ok:false reason:semantic_unavailable verbatim", async () => {
    mock.setSearchResponder(() => ({
      status: 200,
      body: JSON.stringify({ ok: false, reason: "semantic_unavailable" }),
    }));

    const result = await client.history.search("hello", { semantic: true });

    expect(result).toEqual({ ok: false, reason: "semantic_unavailable" });
  });

  it("passes through an unknown reason without coercing it", async () => {
    mock.setSearchResponder(() => ({
      status: 200,
      body: JSON.stringify({ ok: false, reason: "some_other_reason" }),
    }));

    const result = (await client.history.search("hello", {
      semantic: true,
    })) as { ok: false; reason: string };

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("some_other_reason");
  });

  it("does not forge a discriminator when the daemon returns a malformed envelope", async () => {
    mock.setSearchResponder(() => ({
      status: 200,
      body: JSON.stringify({ unexpected: true }),
    }));

    const result = (await client.history.search("hello")) as Record<string, unknown>;

    expect(result.ok).toBeUndefined();
    expect(result.unexpected).toBe(true);
  });

  it("throws an Error carrying the daemon's error message on HTTP error", async () => {
    mock.setSearchResponder(() => ({
      status: 503,
      body: JSON.stringify({ error: "history store unavailable" }),
    }));

    await expect(client.history.search("hello")).rejects.toThrow(
      "history store unavailable",
    );
  });

  it("throws a fallback HTTP-status error when the daemon returns no body", async () => {
    mock.setSearchResponder(() => ({ status: 500, body: "not json" }));

    await expect(client.history.search("hello")).rejects.toThrow("HTTP 500");
  });
});
