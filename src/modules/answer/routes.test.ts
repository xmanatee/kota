import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { AnswerResult } from "#core/server/kota-client.js";
import type { AnswerProvider } from "./answer-types.js";
import { createAnswerRouteHandler } from "./routes.js";

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
