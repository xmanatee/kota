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
 *  3. `show(id)` is wired through `fetchRaw` with method `GET`, path
 *     `/history/${encodeURIComponent(id)}`, and an undefined body. An id
 *     containing reserved characters (`%`, `/`, space) round-trips through
 *     `encodeURIComponent`. A 404 missing response collapses into
 *     `{ found: false }`, typed unknown-project 404s throw, and a non-null
 *     `HistoryDetail` collapses into `{ found: true, detail }`.
 *  4. `delete(id)` is wired through `fetchRaw` with method `DELETE`,
 *     path `/history/${encodeURIComponent(id)}`, and an undefined body. An
 *     id containing reserved characters round-trips through
 *     `encodeURIComponent`. A 404 missing response collapses into
 *     `{ ok: false, reason: "not_found" }`, typed unknown-project 404s
 *     throw, and a non-null `{ deleted: id }` envelope collapses into
 *     `{ ok: true }`. The control
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
 *  8. `HistoryShowResult` arms decode correctly: `metadata`, `window`, and
 *     `full` success responses collapse into `{ found: true, detail }`, and
 *     a `null` (404) response collapses into `{ found: false }`.
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
  HistoryDetail,
  HistoryReindexResult,
  HistorySearchResult,
} from "./client.js";
import historyModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  shape: "fetchRaw" | "request" | "requestStrict";
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

function makeMetadataDetail(id: string): HistoryDetail {
  return {
    view: "metadata",
    record: makeRecord(id),
    messageWindow: {
      offset: 0,
      limit: 0,
      total: 7,
      returned: 0,
      hasMoreBefore: false,
      hasMoreAfter: true,
    },
  };
}

function makeWindowDetail(id: string): HistoryDetail {
  return {
    view: "window",
    record: makeRecord(id),
    messages: [
      {
        index: 20,
        role: "user",
        content: "bounded content",
        contentTruncation: {
          maxCharacters: 200,
          originalCharacters: 15,
          truncated: false,
        },
      },
    ],
    compactionCount: 0,
    lastInputTokens: 0,
    contentLimit: 200,
    messageWindow: {
      offset: 20,
      limit: 1,
      total: 42,
      returned: 1,
      hasMoreBefore: true,
      hasMoreAfter: true,
    },
  };
}

function makeFullDetail(id: string): HistoryDetail {
  return {
    ...makeData(id),
    view: "full",
    messageWindow: {
      offset: 0,
      limit: 0,
      total: 0,
      returned: 0,
      hasMoreBefore: false,
      hasMoreAfter: false,
    },
  };
}

function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: unknown,
    shape: "fetchRaw" | "request" | "requestStrict",
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
    fetchRaw: async (path, init) => {
      calls.push({
        method: init?.method ?? "GET",
        path,
        body: init?.body,
        shape: "fetchRaw",
      });
      const payload = responder(
        init?.method ?? "GET",
        path,
        init?.body,
        "fetchRaw",
      );
      if (payload instanceof Response) return payload;
      if (payload === null) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    },
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

  it("threads an explicit project id through list()", async () => {
    const wirePayload = { conversations: [] };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = historyModule.daemonClient!(transport);
    await contributed.history!.list({ projectId: "project-b" });
    expect(calls[0]!.path).toBe("/history?projectId=project-b");
  });

  it("routes show(id) through GET /history/:id via fetchRaw with encodeURIComponent and no body", async () => {
    const detail = makeWindowDetail("plain-id");
    const { transport, calls } = makeRecordingTransport(() => detail);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.show(ENCODING_SENSITIVE_ID);
    expect(result).toEqual({ found: true, detail });
    expect(calls).toEqual([
      {
        method: "GET",
        path: `/history/${encodeURIComponent(ENCODING_SENSITIVE_ID)}?view=window&offset=0&limit=20&contentLimit=200`,
        body: undefined,
        shape: "fetchRaw",
      },
    ]);
  });

  it("collapses a null (404) response from show into { found: false }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.show("missing");
    expect(result).toEqual({ found: false });
  });

  it("threads an explicit project id through show()", async () => {
    const detail = makeWindowDetail("plain-id");
    const { transport, calls } = makeRecordingTransport(() => detail);
    const contributed = historyModule.daemonClient!(transport);
    await contributed.history!.show("plain-id", { projectId: "project-b" });
    expect(calls[0]!.path).toBe(
      "/history/plain-id?view=window&offset=0&limit=20&contentLimit=200&projectId=project-b",
    );
  });

  it("routes show(id, { view: 'metadata' }) through the metadata detail arm", async () => {
    const detail = makeMetadataDetail("plain-id");
    const { transport, calls } = makeRecordingTransport(() => detail);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.show("plain-id", {
      view: "metadata",
    });
    expect(result).toEqual({ found: true, detail });
    expect(calls[0]!.path).toBe("/history/plain-id?view=metadata");
  });

  it("routes show(id, { view: 'window' }) with explicit window bounds", async () => {
    const detail = makeWindowDetail("plain-id");
    const { transport, calls } = makeRecordingTransport(() => detail);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.show("plain-id", {
      view: "window",
      offset: 20,
      limit: 1,
      contentLimit: 50,
    });
    expect(result).toEqual({ found: true, detail });
    expect(calls[0]!.path).toBe(
      "/history/plain-id?view=window&offset=20&limit=1&contentLimit=50",
    );
  });

  it("routes show(id, { view: 'full' }) through the explicit full detail arm", async () => {
    const detail = makeFullDetail("plain-id");
    const { transport, calls } = makeRecordingTransport(() => detail);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.show("plain-id", {
      view: "full",
    });
    expect(result).toEqual({ found: true, detail });
    expect(calls[0]!.path).toBe("/history/plain-id?view=full");
  });

  it("rejects malformed show options at the daemon-client boundary", async () => {
    const { transport, calls } = makeRecordingTransport(() => makeWindowDetail("x"));
    const contributed = historyModule.daemonClient!(transport);
    await expect(
      contributed.history!.show("plain-id", {
        view: "window",
        offset: -1,
      }),
    ).rejects.toThrow("offset must be a non-negative integer");
    expect(calls).toEqual([]);
  });

  it("throws the typed unknown project route error from show()", async () => {
    const { transport } = makeRecordingTransport(() =>
      new Response(
        JSON.stringify({
          error: "Unknown project",
          reason: "unknown_project",
          projectId: "ghost",
        }),
        { status: 404 },
      ),
    );
    const contributed = historyModule.daemonClient!(transport);
    await expect(
      contributed.history!.show("plain-id", { projectId: "ghost" }),
    ).rejects.toThrow("Unknown project: ghost");
  });

  it("routes delete(id) through DELETE /history/:id via fetchRaw with encodeURIComponent and no body", async () => {
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
        shape: "fetchRaw",
      },
    ]);
  });

  it("collapses a null (404) response from delete into { ok: false, reason: 'not_found' }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = historyModule.daemonClient!(transport);
    const result = await contributed.history!.delete("missing");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("threads an explicit project id through delete()", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({
      deleted: "plain-id",
    }));
    const contributed = historyModule.daemonClient!(transport);
    await contributed.history!.delete("plain-id", { projectId: "project-b" });
    expect(calls[0]!.path).toBe("/history/plain-id?projectId=project-b");
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

  it("threads an explicit project id through search()", async () => {
    const expected: HistorySearchResult = { ok: true, conversations: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = historyModule.daemonClient!(transport);
    await contributed.history!.search("query", { projectId: "project-b" });
    expect(calls[0]!.path).toBe(
      "/api/history/search?q=query&projectId=project-b",
    );
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

  it("threads an explicit project id through reindex()", async () => {
    const expected: HistoryReindexResult = { indexed: 5, failed: 0 };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = historyModule.daemonClient!(transport);
    await contributed.history!.reindex({ projectId: "project-b" });
    expect(calls[0]!.path).toBe("/history/reindex?projectId=project-b");
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
