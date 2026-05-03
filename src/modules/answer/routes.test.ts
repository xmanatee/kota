import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { AnswerHistoryStore } from "./answer-history-store.js";
import type { AnswerProvider } from "./answer-types.js";
import type {
  AnswerHistoryEntry,
  AnswerHistoryListFilter,
  AnswerHistoryRecord,
  AnswerResult,
} from "./client.js";
import {
  createAnswerHistoryRouteHandler,
  createAnswerRouteHandler,
} from "./routes.js";

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => {
      result.status = s;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function mockRequest(body: Record<string, unknown>): IncomingMessage {
  const data = Buffer.from(JSON.stringify(body));
  const handlers: Record<string, Array<(arg?: Buffer | Error) => void>> = {};
  return {
    on(event: string, handler: (arg?: Buffer | Error) => void) {
      (handlers[event] = handlers[event] || []).push(handler);
      if (event === "end") {
        setImmediate(() => {
          for (const h of handlers.data ?? []) h(data);
          for (const h of handlers.end ?? []) h();
        });
      }
      return this;
    },
  } as unknown as IncomingMessage;
}

function mockGetRequest(url: string): IncomingMessage {
  return { url, method: "GET", on: vi.fn() } as unknown as IncomingMessage;
}

function inMemoryHistoryStore(records: AnswerHistoryRecord[]): AnswerHistoryStore {
  const store = new Map<string, AnswerHistoryRecord>();
  for (const r of records) store.set(r.id, r);
  return {
    async appendAnswer(record) {
      store.set(record.id, record);
    },
    async searchAnswers() {
      // Routes test only exercises the read API, not the recall contributor.
      return [];
    },
    async listAnswers(filter?: AnswerHistoryListFilter) {
      const ids = Array.from(store.keys()).sort().reverse();
      const fromIndex = filter?.beforeId
        ? ids.indexOf(filter.beforeId) + 1
        : 0;
      const limit = filter?.limit ?? 20;
      const slice = ids.slice(fromIndex, fromIndex + limit);
      const out: AnswerHistoryEntry[] = [];
      for (const id of slice) {
        const record = store.get(id);
        if (!record) continue;
        out.push({
          id: record.id,
          createdAt: record.createdAt,
          query: record.query,
          result: record.result.ok
            ? { ok: true, citationCount: record.result.citations.length }
            : { ok: false, reason: record.result.reason },
        });
      }
      return out;
    },
    async getAnswer(id) {
      return store.get(id) ?? null;
    },
  };
}

function sampleHistoryRecord(
  index: number,
  ok: boolean,
): AnswerHistoryRecord {
  const stamp = new Date(Date.UTC(2026, 3, 28, 0, 0, index)).toISOString();
  const id = `${stamp.replace(/[:.]/g, "-")}-${String(index).padStart(6, "0")}`;
  if (ok) {
    return {
      id,
      createdAt: stamp,
      query: `q${index}`,
      filter: { topK: 8 },
      recallHits: [
        {
          source: "knowledge",
          score: 1,
          id: "k1",
          title: "Title",
          preview: "...",
          updated: "2026-04-26",
        },
      ],
      result: {
        ok: true,
        answer: `Body [knowledge:k1] ${index}.`,
        citations: [{ source: "knowledge", id: "k1" }],
        hits: [
          {
            source: "knowledge",
            score: 1,
            id: "k1",
            title: "Title",
            preview: "...",
            updated: "2026-04-26",
          },
        ],
      },
    };
  }
  return {
    id,
    createdAt: stamp,
    query: `q${index}`,
    filter: { topK: 8 },
    recallHits: [],
    result: { ok: false, reason: "no_hits" },
  };
}

function fakeProvider(
  result: AnswerResult,
  capture?: { query?: string; filter?: unknown },
): AnswerProvider {
  return {
    async answer(query, filter) {
      if (capture) {
        capture.query = query;
        capture.filter = filter;
      }
      return result;
    },
  };
}

describe("answer route handler", () => {
  it("returns 200 with discriminated answer payload on success", async () => {
    const handler = createAnswerRouteHandler(() =>
      fakeProvider({
        ok: true,
        answer: "Recall ranks across stores [knowledge:k1] and [tasks:task-add-recall].",
        citations: [
          { source: "knowledge", id: "k1" },
          { source: "tasks", id: "task-add-recall" },
        ],
        hits: [
          {
            source: "knowledge",
            score: 1,
            id: "k1",
            title: "Cross-store recall",
            preview: "...",
            updated: "2026-04-26",
          },
          {
            source: "tasks",
            score: 0.8,
            id: "task-add-recall",
            title: "Add recall seam",
            state: "done",
            priority: "p1",
            updatedAt: "2026-04-25",
          },
        ],
      }),
    );
    const { res, result } = mockResponse();
    await handler(mockRequest({ query: "How does recall work?" }), res);
    expect(result.status).toBe(200);
    const body = result.body as AnswerResult;
    if (!body.ok) throw new Error("expected ok:true");
    expect(body.answer).toContain("[knowledge:k1]");
    expect(body.citations).toHaveLength(2);
    expect(body.hits).toHaveLength(2);
  });

  it("returns ok:false reason:no_hits verbatim", async () => {
    const handler = createAnswerRouteHandler(() =>
      fakeProvider({ ok: false, reason: "no_hits" }),
    );
    const { res, result } = mockResponse();
    await handler(mockRequest({ query: "anything" }), res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: false, reason: "no_hits" });
  });

  it("returns ok:false reason:semantic_unavailable verbatim", async () => {
    const handler = createAnswerRouteHandler(() =>
      fakeProvider({ ok: false, reason: "semantic_unavailable" }),
    );
    const { res, result } = mockResponse();
    await handler(mockRequest({ query: "anything" }), res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: false, reason: "semantic_unavailable" });
  });

  it("returns ok:false reason:synthesis_failed verbatim", async () => {
    const handler = createAnswerRouteHandler(() =>
      fakeProvider({ ok: false, reason: "synthesis_failed" }),
    );
    const { res, result } = mockResponse();
    await handler(mockRequest({ query: "anything" }), res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: false, reason: "synthesis_failed" });
  });

  it("forwards filter fields through to the provider", async () => {
    const capture: { query?: string; filter?: unknown } = {};
    const handler = createAnswerRouteHandler(() =>
      fakeProvider({ ok: false, reason: "no_hits" }, capture),
    );
    const { res } = mockResponse();
    await handler(
      mockRequest({
        query: "graphrag",
        filter: { topK: 3, minScore: 0.4, sources: ["knowledge", "tasks"] },
      }),
      res,
    );
    expect(capture.query).toBe("graphrag");
    expect(capture.filter).toEqual({
      topK: 3,
      minScore: 0.4,
      sources: ["knowledge", "tasks"],
    });
  });

  it("drops unknown sources from the filter", async () => {
    const capture: { query?: string; filter?: unknown } = {};
    const handler = createAnswerRouteHandler(() =>
      fakeProvider({ ok: false, reason: "no_hits" }, capture),
    );
    const { res } = mockResponse();
    await handler(
      mockRequest({ query: "x", filter: { sources: ["bogus"] } }),
      res,
    );
    expect(capture.filter).toEqual({});
  });

  it("returns 400 when query is missing or blank", async () => {
    const handler = createAnswerRouteHandler(() =>
      fakeProvider({ ok: false, reason: "no_hits" }),
    );
    const a = mockResponse();
    await handler(mockRequest({}), a.res);
    expect(a.result.status).toBe(400);
    const b = mockResponse();
    await handler(mockRequest({ query: "   " }), b.res);
    expect(b.result.status).toBe(400);
  });

  it("returns 500 when the provider throws", async () => {
    const handler = createAnswerRouteHandler(() => ({
      async answer() {
        throw new Error("provider boom");
      },
    }));
    const { res, result } = mockResponse();
    await handler(mockRequest({ query: "anything" }), res);
    expect(result.status).toBe(500);
    expect((result.body as { error: string }).error).toContain("provider boom");
  });
});

describe("answer history route handler", () => {
  it("list returns an empty entries array for an empty store", async () => {
    const handlers = createAnswerHistoryRouteHandler(() =>
      inMemoryHistoryStore([]),
    );
    const { res, result } = mockResponse();
    await handlers.list(mockGetRequest("/answers"), res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ entries: [] });
  });

  it("list returns newest-first entries with mixed ok and ok=false rows", async () => {
    const records = [
      sampleHistoryRecord(0, true),
      sampleHistoryRecord(1, false),
      sampleHistoryRecord(2, true),
    ];
    const handlers = createAnswerHistoryRouteHandler(() =>
      inMemoryHistoryStore(records),
    );
    const { res, result } = mockResponse();
    await handlers.list(mockGetRequest("/answers"), res);
    expect(result.status).toBe(200);
    const body = result.body as { entries: AnswerHistoryEntry[] };
    expect(body.entries.map((e) => e.id)).toEqual([
      records[2].id,
      records[1].id,
      records[0].id,
    ]);
    expect(body.entries[0].result).toEqual({ ok: true, citationCount: 1 });
    expect(body.entries[1].result).toEqual({ ok: false, reason: "no_hits" });
  });

  it("list pagination uses beforeId cursor", async () => {
    const records = [
      sampleHistoryRecord(0, true),
      sampleHistoryRecord(1, true),
      sampleHistoryRecord(2, true),
      sampleHistoryRecord(3, true),
    ];
    const handlers = createAnswerHistoryRouteHandler(() =>
      inMemoryHistoryStore(records),
    );
    const firstPage = mockResponse();
    await handlers.list(
      mockGetRequest("/answers?limit=2"),
      firstPage.res,
    );
    const firstBody = firstPage.result.body as { entries: AnswerHistoryEntry[] };
    expect(firstBody.entries.map((e) => e.query)).toEqual(["q3", "q2"]);

    const secondPage = mockResponse();
    await handlers.list(
      mockGetRequest(
        `/answers?limit=2&beforeId=${encodeURIComponent(firstBody.entries[1].id)}`,
      ),
      secondPage.res,
    );
    const secondBody = secondPage.result.body as { entries: AnswerHistoryEntry[] };
    expect(secondBody.entries.map((e) => e.query)).toEqual(["q1", "q0"]);
  });

  it("show returns ok:true with the record body for an ok:true arm", async () => {
    const record = sampleHistoryRecord(0, true);
    const handlers = createAnswerHistoryRouteHandler(() =>
      inMemoryHistoryStore([record]),
    );
    const { res, result } = mockResponse();
    await handlers.showById(record.id, res);
    expect(result.status).toBe(200);
    const body = result.body as { ok: boolean; record?: AnswerHistoryRecord };
    expect(body.ok).toBe(true);
    expect(body.record?.id).toBe(record.id);
    expect(body.record?.result.ok).toBe(true);
  });

  it("show returns ok:true with the record body for an ok:false arm", async () => {
    const record = sampleHistoryRecord(0, false);
    const handlers = createAnswerHistoryRouteHandler(() =>
      inMemoryHistoryStore([record]),
    );
    const { res, result } = mockResponse();
    await handlers.showById(record.id, res);
    expect(result.status).toBe(200);
    const body = result.body as { ok: boolean; record?: AnswerHistoryRecord };
    expect(body.ok).toBe(true);
    expect(body.record?.result).toEqual({ ok: false, reason: "no_hits" });
  });

  it("show returns ok:false reason:not_found for an unknown id", async () => {
    const handlers = createAnswerHistoryRouteHandler(() =>
      inMemoryHistoryStore([]),
    );
    const { res, result } = mockResponse();
    await handlers.showById("nope", res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: false, reason: "not_found" });
  });
});
