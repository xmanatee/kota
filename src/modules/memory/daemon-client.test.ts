/**
 * Memory namespace daemon-side handler test.
 *
 * The memory namespace migrated out of the core stub into
 * `daemonClient(link)` on the memory module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The memory module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `memory` namespace.
 *  2. `list(filter)` is wired through `DaemonTransport.requestStrict<T>`
 *     with method `GET`, path `/api/memory`, and an undefined body. The
 *     daemon-wire `{ id, tags, created, excerpt }[]` payload collapses
 *     into the `MemoryListResult` shape by mapping `excerpt → content`,
 *     dropping `tags`, and slicing by `filter.limit ?? Number.POSITIVE_INFINITY`.
 *     Both the undefined-filter and finite-limit paths thread through.
 *  3. `add(content, tags)` is wired through `requestStrict<T>` with
 *     method `POST`, path `/api/memory`, and body `{ content, tags }`.
 *     An undefined `tags` argument collapses to `[]`, and a multi-tag
 *     array threads through verbatim.
 *  4. `delete(id)` is wired through `fetchRaw` with method `DELETE`,
 *     path `/api/memory/${encodeURIComponent(id)}`, and an undefined body.
 *     An id containing reserved characters (`%`, `/`, space) round-trips
 *     through `encodeURIComponent`. A `null` (404) response collapses into
 *     `{ ok: false, reason: "not_found" }` and a non-null response
 *     collapses into `{ ok: true }`.
 *  5. `search(query, filter)` is wired through `requestStrict<T>` with
 *     method `GET`, path `/api/memory/search?${params}`, and an undefined
 *     body. The `URLSearchParams` insertion order matches the
 *     pre-migration `searchMemoryHttp` (q, tag, since, semantic, limit).
 *  6. `reindex()` is wired through `requestStrict<T>` with method `POST`,
 *     path `/api/memory/reindex`, and an undefined body.
 *  7. `MemorySearchResult` decodes correctly through `requestStrict<T>`
 *     for both arms (`{ ok: true; entries }` and
 *     `{ ok: false; reason: "semantic_unavailable" }`).
 *  8. `MemoryDeleteResult` arms decode correctly: a `200` non-null
 *     response collapses into `{ ok: true }` and a `null` (404) response
 *     collapses into `{ ok: false, reason: "not_found" }`.
 *  9. `MemoryReindexResult` decodes correctly through `requestStrict<T>`
 *     (the provider's `ReindexResult` shape passes through unchanged).
 * 10. Removing the memory module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "memory" missing-handler
 *     error.
 * 11. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  MemoryListEntry,
  MemoryReindexResult,
  MemorySearchResult,
} from "./client.js";
import memoryModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  shape: "fetchRaw" | "request" | "requestStrict";
};

const ENCODING_SENSITIVE_ID = "weird/id %value with space";

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
        "request",
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

describe("memory module daemonClient(link)", () => {
  it("contributes a memory namespace handler", () => {
    expect(memoryModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = memoryModule.daemonClient!(link);
    expect(contributed.memory).toBeDefined();
    expect(typeof contributed.memory!.list).toBe("function");
    expect(typeof contributed.memory!.add).toBe("function");
    expect(typeof contributed.memory!.delete).toBe("function");
    expect(typeof contributed.memory!.search).toBe("function");
    expect(typeof contributed.memory!.reindex).toBe("function");
  });

  it("routes list() through GET /api/memory via requestStrict<T> with no body", async () => {
    const wirePayload = {
      entries: [
        { id: "a", tags: ["x"], created: "2026-01-01T00:00:00Z", excerpt: "first" },
        { id: "b", tags: ["y", "z"], created: "2026-01-02T00:00:00Z", excerpt: "second" },
        { id: "c", tags: [], created: "2026-01-03T00:00:00Z", excerpt: "third" },
      ],
    };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.list();
    expect(result).toEqual({
      entries: [
        { id: "a", created: "2026-01-01T00:00:00Z", content: "first" },
        { id: "b", created: "2026-01-02T00:00:00Z", content: "second" },
        { id: "c", created: "2026-01-03T00:00:00Z", content: "third" },
      ],
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/memory",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("slices the list() result by limit and drops tags by mapping excerpt -> content", async () => {
    const wirePayload = {
      entries: [
        { id: "a", tags: ["x"], created: "2026-01-01T00:00:00Z", excerpt: "first" },
        { id: "b", tags: ["y", "z"], created: "2026-01-02T00:00:00Z", excerpt: "second" },
        { id: "c", tags: [], created: "2026-01-03T00:00:00Z", excerpt: "third" },
      ],
    };
    const { transport } = makeRecordingTransport(() => wirePayload);
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.list({ limit: 2 });
    expect(result).toEqual({
      entries: [
        { id: "a", created: "2026-01-01T00:00:00Z", content: "first" },
        { id: "b", created: "2026-01-02T00:00:00Z", content: "second" },
      ],
    });
  });

  it("threads an explicit project id through list()", async () => {
    const wirePayload = { entries: [] };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = memoryModule.daemonClient!(transport);
    await contributed.memory!.list({ projectId: "project-b" });
    expect(calls[0]!.path).toBe("/api/memory?projectId=project-b");
  });

  it("routes add(content, tags) through POST /api/memory via requestStrict<T> with body { content, tags }", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({ id: "new-id" }));
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.add("the content", ["alpha", "beta"]);
    expect(result).toEqual({ id: "new-id" });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/memory",
        body: { content: "the content", tags: ["alpha", "beta"] },
        shape: "requestStrict",
      },
    ]);
  });

  it("collapses an undefined tags argument on add into []", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({ id: "new-id" }));
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.add("the content");
    expect(result).toEqual({ id: "new-id" });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/memory",
        body: { content: "the content", tags: [] },
        shape: "requestStrict",
      },
    ]);
  });

  it("threads an explicit project id through add()", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({ id: "new-id" }));
    const contributed = memoryModule.daemonClient!(transport);
    await contributed.memory!.add("the content", ["alpha"], {
      projectId: "project-b",
    });
    expect(calls[0]!.path).toBe("/api/memory?projectId=project-b");
  });

  it("routes delete(id) through DELETE /api/memory/:id via fetchRaw with encodeURIComponent and no body", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({ deleted: ENCODING_SENSITIVE_ID }));
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.delete(ENCODING_SENSITIVE_ID);
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        method: "DELETE",
        path: `/api/memory/${encodeURIComponent(ENCODING_SENSITIVE_ID)}`,
        body: undefined,
        shape: "fetchRaw",
      },
    ]);
  });

  it("collapses a null (404) response from delete into { ok: false, reason: 'not_found' }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.delete("missing");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("threads an explicit project id through delete()", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({ deleted: "plain-id" }));
    const contributed = memoryModule.daemonClient!(transport);
    await contributed.memory!.delete("plain-id", { projectId: "project-b" });
    expect(calls[0]!.path).toBe("/api/memory/plain-id?projectId=project-b");
  });

  it("throws the typed unknown project route error from delete()", async () => {
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
    const contributed = memoryModule.daemonClient!(transport);
    await expect(
      contributed.memory!.delete("plain-id", { projectId: "ghost" }),
    ).rejects.toThrow("Unknown project: ghost");
  });

  it("routes search(query) through GET /api/memory/search?q=... via requestStrict<T> with no filter", async () => {
    const expected: MemorySearchResult = { ok: true, entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.search("query");
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/memory/search?q=query",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("threads { tag, since, limit } into URLSearchParams in q,tag,since,limit insertion order", async () => {
    const expected: MemorySearchResult = { ok: true, entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = memoryModule.daemonClient!(transport);
    await contributed.memory!.search("query", {
      tag: "alpha",
      since: "2026-01-01",
      limit: 10,
    });
    expect(calls[0]!.path).toBe(
      "/api/memory/search?q=query&tag=alpha&since=2026-01-01&limit=10",
    );
  });

  it("threads { semantic: true } into URLSearchParams as semantic=true", async () => {
    const expected: MemorySearchResult = { ok: true, entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = memoryModule.daemonClient!(transport);
    await contributed.memory!.search("query", { semantic: true });
    expect(calls[0]!.path).toBe("/api/memory/search?q=query&semantic=true");
  });

  it("threads an explicit project id through search()", async () => {
    const expected: MemorySearchResult = { ok: true, entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = memoryModule.daemonClient!(transport);
    await contributed.memory!.search("query", { projectId: "project-b" });
    expect(calls[0]!.path).toBe("/api/memory/search?q=query&projectId=project-b");
  });

  it("decodes a multi-entry MemorySearchResult ok: true arm unchanged", async () => {
    const entries: MemoryListEntry[] = [
      { id: "a", created: "2026-01-01T00:00:00Z", content: "first" },
      { id: "b", created: "2026-01-02T00:00:00Z", content: "second" },
    ];
    const expected: MemorySearchResult = { ok: true, entries };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.search("query");
    expect(result).toEqual(expected);
  });

  it("decodes a MemorySearchResult semantic_unavailable arm unchanged", async () => {
    const expected: MemorySearchResult = {
      ok: false,
      reason: "semantic_unavailable",
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.search("query", { semantic: true });
    expect(result).toEqual(expected);
  });

  it("routes reindex() through POST /api/memory/reindex via requestStrict<T> with no body", async () => {
    const expected: MemoryReindexResult = { indexed: 5, failed: 0 };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = memoryModule.daemonClient!(transport);
    const result = await contributed.memory!.reindex();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/memory/reindex",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("threads an explicit project id through reindex()", async () => {
    const expected: MemoryReindexResult = { indexed: 5, failed: 0 };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = memoryModule.daemonClient!(transport);
    await contributed.memory!.reindex({ projectId: "project-b" });
    expect(calls[0]!.path).toBe("/api/memory/reindex?projectId=project-b");
  });

  it("the assembly path fails loudly when the memory module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.memory;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /memory/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the memory module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = memoryModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.memory;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
