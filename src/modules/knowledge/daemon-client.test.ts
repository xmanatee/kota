/**
 * Knowledge namespace daemon-side handler test.
 *
 * The knowledge namespace migrated out of the core stub into
 * `daemonClient(link)` on the knowledge module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The knowledge module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `knowledge` namespace.
 *  2. `list(filter)` is wired through `DaemonTransport.requestStrict<T>`
 *     with method `GET`, path `/api/knowledge` (no query string when filter
 *     is undefined or empty), and an undefined body. The multi-key filter
 *     (`{ tag, type, status, scope }`) threads through `URLSearchParams`
 *     in `tag,type,status,scope` insertion order to match today's
 *     pre-migration `listKnowledgeHttp`.
 *  3. `show(id)` is wired through `request<T>` with method `GET`, path
 *     `/api/knowledge/${encodeURIComponent(id)}`, and an undefined body.
 *     An id containing reserved characters (`%`, `/`, space) round-trips
 *     through `encodeURIComponent`. A `null` (404) response collapses into
 *     `{ found: false }` and a non-null entry collapses into
 *     `{ found: true, entry }`.
 *  4. `search(query, filter)` is wired through `requestStrict<T>` with
 *     method `GET`, path `/api/knowledge/search?${params}`, and an undefined
 *     body. The optional-key insertion order is `q,tag,type,status,scope,
 *     semantic,limit`, matching today's pre-migration `searchKnowledgeHttp`.
 *     `semantic: true` threads through as `semantic=true`.
 *  5. `add(options)` is wired through `requestStrict<T>` with method `POST`,
 *     path `/api/knowledge`, and the full `KnowledgeAddOptions` body. A
 *     minimal `{ title, content }` body and a body with every optional key
 *     (`type`, `tags`, `status`, `scope`, `meta`) both pass through
 *     verbatim.
 *  6. `delete(id)` is wired through `request<T>` with method `DELETE`,
 *     path `/api/knowledge/${encodeURIComponent(id)}`, and an undefined
 *     body. An id containing reserved characters round-trips through
 *     `encodeURIComponent`. A `null` (404) response collapses into
 *     `{ ok: false, reason: "not_found" }` and a non-null response
 *     collapses into `{ ok: true }`.
 *  7. `reindex()` is wired through `requestStrict<T>` with method `POST`,
 *     path `/api/knowledge/reindex`, and an undefined body.
 *  8. `KnowledgeSearchResult` decodes correctly through `requestStrict<T>`
 *     for both arms (`{ ok: true; entries }` and
 *     `{ ok: false; reason: "semantic_unavailable" }`).
 *  9. `KnowledgeShowResult` arms decode correctly: a `200` non-null
 *     response collapses into `{ found: true, entry }` and a `null` (404)
 *     response collapses into `{ found: false }`.
 * 10. `KnowledgeDeleteResult` arms decode correctly: a `200` non-null
 *     response collapses into `{ ok: true }` and a `null` (404) response
 *     collapses into `{ ok: false, reason: "not_found" }`.
 * 11. `KnowledgeReindexResult` decodes correctly through `requestStrict<T>`
 *     (the provider's `ReindexResult` shape passes through unchanged).
 * 12. Removing the knowledge module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "knowledge" missing-handler
 *     error.
 * 13. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  KnowledgeReindexResult,
  KnowledgeSearchResult,
} from "./client.js";
import knowledgeModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
  shape: "request" | "requestStrict";
};

const ENCODING_SENSITIVE_ID = "weird/id %value with space";

function makeEntry(id: string): KnowledgeEntry {
  return {
    id,
    title: `title-${id}`,
    type: "note",
    tags: [],
    status: "active",
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    content: `content-${id}`,
    meta: {},
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

describe("knowledge module daemonClient(link)", () => {
  it("contributes a knowledge namespace handler", () => {
    expect(knowledgeModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = knowledgeModule.daemonClient!(link);
    expect(contributed.knowledge).toBeDefined();
    expect(typeof contributed.knowledge!.list).toBe("function");
    expect(typeof contributed.knowledge!.show).toBe("function");
    expect(typeof contributed.knowledge!.search).toBe("function");
    expect(typeof contributed.knowledge!.add).toBe("function");
    expect(typeof contributed.knowledge!.delete).toBe("function");
    expect(typeof contributed.knowledge!.reindex).toBe("function");
  });

  it("routes list() with no filter through GET /api/knowledge via requestStrict<T> with no query string and no body", async () => {
    const wirePayload = { entries: [makeEntry("a"), makeEntry("b")] };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = knowledgeModule.daemonClient!(transport);
    const result = await contributed.knowledge!.list();
    expect(result).toEqual(wirePayload);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/knowledge",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("routes list() with an empty filter through GET /api/knowledge with no query string", async () => {
    const wirePayload = { entries: [] };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = knowledgeModule.daemonClient!(transport);
    await contributed.knowledge!.list({});
    expect(calls[0]!.path).toBe("/api/knowledge");
  });

  it("threads list() filter keys into URLSearchParams in tag,type,status,scope insertion order", async () => {
    const wirePayload = { entries: [] };
    const { transport, calls } = makeRecordingTransport(() => wirePayload);
    const contributed = knowledgeModule.daemonClient!(transport);
    await contributed.knowledge!.list({
      tag: "alpha",
      type: "note",
      status: "active",
      scope: "project",
    });
    expect(calls[0]!.path).toBe(
      "/api/knowledge?tag=alpha&type=note&status=active&scope=project",
    );
  });

  it("routes show(id) through GET /api/knowledge/:id via request<T> with encodeURIComponent and no body", async () => {
    const entry = makeEntry("plain-id");
    const { transport, calls } = makeRecordingTransport(() => entry);
    const contributed = knowledgeModule.daemonClient!(transport);
    const result = await contributed.knowledge!.show(ENCODING_SENSITIVE_ID);
    expect(result).toEqual({ found: true, entry });
    expect(calls).toEqual([
      {
        method: "GET",
        path: `/api/knowledge/${encodeURIComponent(ENCODING_SENSITIVE_ID)}`,
        body: undefined,
        shape: "request",
      },
    ]);
  });

  it("collapses a null (404) response from show into { found: false }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = knowledgeModule.daemonClient!(transport);
    const result = await contributed.knowledge!.show("missing");
    expect(result).toEqual({ found: false });
  });

  it("routes search(query) with no filter through GET /api/knowledge/search?q=... via requestStrict<T>", async () => {
    const expected: KnowledgeSearchResult = { ok: true, entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = knowledgeModule.daemonClient!(transport);
    const result = await contributed.knowledge!.search("query");
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/knowledge/search?q=query",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("threads search() filter keys into URLSearchParams in q,tag,type,status,scope,limit insertion order", async () => {
    const expected: KnowledgeSearchResult = { ok: true, entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = knowledgeModule.daemonClient!(transport);
    await contributed.knowledge!.search("query", {
      tag: "alpha",
      type: "note",
      status: "active",
      scope: "project",
      limit: 10,
    });
    expect(calls[0]!.path).toBe(
      "/api/knowledge/search?q=query&tag=alpha&type=note&status=active&scope=project&limit=10",
    );
  });

  it("threads { semantic: true } into URLSearchParams as semantic=true", async () => {
    const expected: KnowledgeSearchResult = { ok: true, entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = knowledgeModule.daemonClient!(transport);
    await contributed.knowledge!.search("query", { semantic: true });
    expect(calls[0]!.path).toBe("/api/knowledge/search?q=query&semantic=true");
  });

  it("decodes a multi-entry KnowledgeSearchResult ok: true arm unchanged", async () => {
    const entries: KnowledgeEntry[] = [makeEntry("a"), makeEntry("b")];
    const expected: KnowledgeSearchResult = { ok: true, entries };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = knowledgeModule.daemonClient!(transport);
    const result = await contributed.knowledge!.search("query");
    expect(result).toEqual(expected);
  });

  it("decodes a KnowledgeSearchResult semantic_unavailable arm unchanged", async () => {
    const expected: KnowledgeSearchResult = {
      ok: false,
      reason: "semantic_unavailable",
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = knowledgeModule.daemonClient!(transport);
    const result = await contributed.knowledge!.search("query", {
      semantic: true,
    });
    expect(result).toEqual(expected);
  });

  it("routes add() with only required fields through POST /api/knowledge via requestStrict<T> with body", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({ id: "new-id" }));
    const contributed = knowledgeModule.daemonClient!(transport);
    const options = { title: "Title", content: "body" };
    const result = await contributed.knowledge!.add(options);
    expect(result).toEqual({ id: "new-id" });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/knowledge",
        body: options,
        shape: "requestStrict",
      },
    ]);
  });

  it("threads the full KnowledgeAddOptions body verbatim through add()", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({ id: "new-id" }));
    const contributed = knowledgeModule.daemonClient!(transport);
    const options = {
      title: "Title",
      content: "body",
      type: "note",
      tags: ["alpha", "beta"],
      status: "active",
      scope: "global" as const,
      meta: { author: "kota" },
    };
    await contributed.knowledge!.add(options);
    expect(calls[0]!.body).toEqual(options);
  });

  it("routes delete(id) through DELETE /api/knowledge/:id via request<T> with encodeURIComponent and no body", async () => {
    const { transport, calls } = makeRecordingTransport(() => ({
      deleted: ENCODING_SENSITIVE_ID,
    }));
    const contributed = knowledgeModule.daemonClient!(transport);
    const result = await contributed.knowledge!.delete(ENCODING_SENSITIVE_ID);
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        method: "DELETE",
        path: `/api/knowledge/${encodeURIComponent(ENCODING_SENSITIVE_ID)}`,
        body: undefined,
        shape: "request",
      },
    ]);
  });

  it("collapses a null (404) response from delete into { ok: false, reason: 'not_found' }", async () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = knowledgeModule.daemonClient!(transport);
    const result = await contributed.knowledge!.delete("missing");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("routes reindex() through POST /api/knowledge/reindex via requestStrict<T> with no body", async () => {
    const expected: KnowledgeReindexResult = { indexed: 5, failed: 0 };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = knowledgeModule.daemonClient!(transport);
    const result = await contributed.knowledge!.reindex();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/knowledge/reindex",
        body: undefined,
        shape: "requestStrict",
      },
    ]);
  });

  it("the assembly path fails loudly when the knowledge module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.knowledge;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /knowledge/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the knowledge module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = knowledgeModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.knowledge;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
