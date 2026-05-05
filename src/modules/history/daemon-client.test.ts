/**
 * History namespace daemon-side handler test.
 *
 * The history namespace migrated out of the core stub into
 * `daemonClient(link)` on the history module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The history module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `history` namespace.
 *  2. `list(filter)` is wired through `DaemonTransport.requestStrict<T>`
 *     with method `GET`, path `/history` (no query string when filter is
 *     undefined or empty), and an undefined body. The multi-key filter
 *     (`{ search, limit, cwd, source }`) threads through `URLSearchParams`
 *     in `search,limit,cwd,source` insertion order to match today's
 *     pre-migration `historyListHttp`.
 *  3. `show(id)` is wired through `request<T>` with method `GET`, path
 *     `/history/${encodeURIComponent(id)}`, and an undefined body. An id
 *     containing reserved characters (`%`, `/`, space) round-trips through
 *     `encodeURIComponent`. A `null` (404) response collapses into
 *     `{ found: false }` and a non-null `ConversationData` collapses into
 *     `{ found: true, data }`.
 *  4. `delete(id)` is wired through `request<T>` with method `DELETE`,
 *     path `/history/${encodeURIComponent(id)}`, and an undefined body. An
 *     id containing reserved characters round-trips through
 *     `encodeURIComponent`. A `null` (404) response collapses into
 *     `{ ok: false, reason: "not_found" }` and a non-null
 *     `{ deleted: id }` envelope collapses into `{ ok: true }`. The control
 *     route was reshaped from a `204` success to `200 + { deleted: id }`
 *     to match the knowledge / approvals / secrets delete precedent.
 *  5. `search(query, filter)` is wired through `requestStrict<T>` with
 *     method `GET`, path `/api/history/search?${params}`, and an undefined
 *     body. The optional-key insertion order is `q,cwd,source,semantic,
 *     limit`, matching today's pre-migration `searchHistoryHttp`.
 *     `semantic: true` threads through as `semantic=true`.
 *  6. `reindex()` is wired through `requestStrict<T>` with method `POST`,
 *     path `/history/reindex`, and an undefined body.
 *  7. `HistorySearchResult` decodes correctly through `requestStrict<T>`
 *     for both arms (`{ ok: true; conversations }` and
 *     `{ ok: false; reason: "semantic_unavailable" }`).
 *  8. `HistoryShowResult` arms decode correctly: a `200` non-null
 *     response collapses into `{ found: true, data }` and a `null` (404)
 *     response collapses into `{ found: false }`.
 *  9. `HistoryDeleteResult` arms decode correctly: a `200` non-null
 *     response collapses into `{ ok: true }` and a `null` (404) response
 *     collapses into `{ ok: false, reason: "not_found" }`.
 * 10. `HistoryReindexResult` decodes correctly through `requestStrict<T>`
 *     (the provider's `ReindexResult` shape passes through unchanged).
 * 11. Removing the history module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "history" missing-handler
 *     error.
 * 12. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import type {
  ConversationData,
  ConversationRecord,
} from "#core/modules/provider-types.js";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  HistoryReindexResult,
  HistorySearchResult,
} from "./client.js";
import historyModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  shape: "request" | "requestStrict";
};

const ENCODING_SENSITIVE_ID = "weird/id %value with space";

function makeRecord(id: string): ConversationRecord {
  return {
    id,
    title: `title-${id}`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    model: "claude-sonnet-4-6",
    messageCount: 0,
    cwd: "/tmp/project",
  };
}

function makeData(id: string): ConversationData {
  return {
    record: makeRecord(id),
    messages: [],
    compactionCount: 0,
    lastInputTokens: 0,
  };
}

function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: unknown,
    shape: "request" | "requestStrict",
  ) => unknown,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T | null> => {
      calls.push({ method, path, body, shape: "request" });
      return responder(method, path, body, "request") as T | null;
    },
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ method, path, body, shape: "requestStrict" });
      return responder(method, path, body, "requestStrict") as T;
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

describe("history module daemonClient(link)", () => {
  it("contributes a history namespace handler", () => {
    expect(historyModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = historyModule.daemonClient!(link);
    expect(contributed.history).toBeDefined();
    expect(typeof contributed.history!.list).toBe("function");
    expect(typeof contributed.history!.show).toBe("function");
    expect(typeof contributed.history!.delete).toBe("function");
    expect(typeof contributed.history!.search).toBe("function");
    expect(typeof contributed.history!.reindex).toBe("function");
  });

  it("routes list() with no filter through GET /history via requestStrict<T> with no query string and no body", async () => {
    const wirePayload = {
      conversations: [makeRecord("a"), makeRecord("b")],
    };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.list();
    expect(result).toEqual(wirePayload);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/history",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("routes list() with an empty filter through GET /history with no query string", async () => {
    const wirePayload = { conversations: [] };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = historyModule.daemonClient!(transport);
    await contributed.history!.list({});
    expect(calls[0]!.path).toBe("/history");
  });

  it("threads list() filter keys into URLSearchParams in search,limit,cwd,source insertion order", async () => {
    const wirePayload = { conversations: [] };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = historyModule.daemonClient!(transport);
    await contributed.history!.list({
      search: "alpha",
      limit: 10,
      cwd: "/repo",
      source: "user",
    });
    expect(calls[0]!.path).toBe(
      "/history?search=alpha&limit=10&cwd=%2Frepo&source=user",
    );
  });

  it("routes show(id) through GET /history/:id via request<T> with encodeURIComponent and no body", async () => {
    const data = makeData("plain-id");
    const { transport, calls } = makeRecordingTransport(() => data);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.show(ENCODING_SENSITIVE_ID);
    expect(result).toEqual({ found: true, data });
    expect(calls).toEqual([
      {
        method: "GET",
        path: `/history/${encodeURIComponent(ENCODING_SENSITIVE_ID)}`,
        body: undefined,
        shape: "request",
      },
    ]);
  });

  it("collapses a null (404) response from show into { found: false }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.show("missing");
    expect(result).toEqual({ found: false });
  });

  it("routes delete(id) through DELETE /history/:id via request<T> with encodeURIComponent and no body", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({
      deleted: ENCODING_SENSITIVE_ID,
    }));
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.delete(ENCODING_SENSITIVE_ID);
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        method: "DELETE",
        path: `/history/${encodeURIComponent(ENCODING_SENSITIVE_ID)}`,
        body: undefined,
        shape: "request",
      },
    ]);
  });

  it("collapses a null (404) response from delete into { ok: false, reason: 'not_found' }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.delete("missing");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("routes search(query) with no filter through GET /api/history/search?q=... via requestStrict<T>", async () => {
    const expected: HistorySearchResult = { ok: true, conversations: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.search("query");
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/history/search?q=query",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("threads search() filter keys into URLSearchParams in q,cwd,source,limit insertion order", async () => {
    const expected: HistorySearchResult = { ok: true, conversations: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = historyModule.daemonClient!(transport);
    await contributed.history!.search("query", {
      cwd: "/repo",
      source: "user",
      limit: 10,
    });
    expect(calls[0]!.path).toBe(
      "/api/history/search?q=query&cwd=%2Frepo&source=user&limit=10",
    );
  });

  it("threads { semantic: true } into URLSearchParams as semantic=true", async () => {
    const expected: HistorySearchResult = { ok: true, conversations: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = historyModule.daemonClient!(transport);
    await contributed.history!.search("query", { semantic: true });
    expect(calls[0]!.path).toBe("/api/history/search?q=query&semantic=true");
  });

  it("decodes a multi-record HistorySearchResult ok: true arm unchanged", async () => {
    const conversations: ConversationRecord[] = [makeRecord("a"), makeRecord("b")];
    const expected: HistorySearchResult = { ok: true, conversations };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.search("query");
    expect(result).toEqual(expected);
  });

  it("decodes a HistorySearchResult semantic_unavailable arm unchanged", async () => {
    const expected: HistorySearchResult = {
      ok: false,
      reason: "semantic_unavailable",
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.search("query", {
      semantic: true,
    });
    expect(result).toEqual(expected);
  });

  it("routes reindex() through POST /history/reindex via requestStrict<T> with no body", async () => {
    const expected: HistoryReindexResult = { indexed: 5, failed: 0 };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.reindex();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/history/reindex",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("the assembly path fails loudly when the history module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.history;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /history/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the history module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = historyModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.history;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
