import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RecallHit } from "./client.js";
import type { RecallProvider } from "./recall-types.js";
import { createRecallRouteHandler } from "./routes.js";

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
  hits: RecallHit[],
  capture?: { query?: string; filter?: unknown },
  contributors: ReadonlyArray<
    "knowledge" | "memory" | "history" | "tasks" | "answer"
  > = ["knowledge", "memory", "history", "tasks"],
): RecallProvider {
  return {
    register: () => {},
    unregister: () => {},
    contributors: () => contributors,
    async recall(query, filter) {
      if (capture) {
        capture.query = query;
        capture.filter = filter;
      }
      return hits;
    },
  };
}

describe("recall route handler", () => {
  it("returns 200 with discriminated hits payload", async () => {
    const hits: RecallHit[] = [
      {
        source: "knowledge",
        score: 1,
        id: "k1",
        title: "Recall design",
        preview: "...",
        updated: "2026-04-26",
      },
      {
        source: "tasks",
        score: 0.8,
        id: "task-recall",
        title: "Add recall seam",
        state: "doing",
        priority: "p2",
        updatedAt: "2026-04-27",
      },
    ];
    const handler = createRecallRouteHandler(() => fakeProvider(hits));
    const { res, result } = mockResponse();
    await handler(mockRequest({ query: "recall" }), res);
    expect(result.status).toBe(200);
    const body = result.body as { ok: true; hits: RecallHit[] };
    expect(body.ok).toBe(true);
    expect(body.hits).toHaveLength(2);
    expect(body.hits[0]).toMatchObject({ source: "knowledge", id: "k1" });
    expect(body.hits[1]).toMatchObject({ source: "tasks", id: "task-recall" });
  });

  it("returns ok:false reason:semantic_unavailable when no contributors are registered", async () => {
    const handler = createRecallRouteHandler(() =>
      fakeProvider([], undefined, []),
    );
    const { res, result } = mockResponse();
    await handler(mockRequest({ query: "anything" }), res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: false,
      reason: "semantic_unavailable",
    });
  });

  it("forwards filter fields through to the provider", async () => {
    const capture: { query?: string; filter?: unknown } = {};
    const handler = createRecallRouteHandler(() => fakeProvider([], capture));
    const { res } = mockResponse();
    await handler(
      mockRequest({
        query: "graphrag",
        filter: { topK: 5, minScore: 0.4, sources: ["knowledge", "tasks"] },
      }),
      res,
    );
    expect(capture.query).toBe("graphrag");
    expect(capture.filter).toEqual({
      topK: 5,
      minScore: 0.4,
      sources: ["knowledge", "tasks"],
    });
  });

  it("drops unknown sources from the filter and ignores empty source list", async () => {
    const capture: { query?: string; filter?: unknown } = {};
    const handler = createRecallRouteHandler(() => fakeProvider([], capture));
    const { res } = mockResponse();
    await handler(
      mockRequest({ query: "x", filter: { sources: ["bogus"] } }),
      res,
    );
    expect(capture.filter).toEqual({});
  });

  it("returns 400 when query is missing", async () => {
    const handler = createRecallRouteHandler(() => fakeProvider([]));
    const { res, result } = mockResponse();
    await handler(mockRequest({}), res);
    expect(result.status).toBe(400);
  });

  it("returns 400 when query is blank", async () => {
    const handler = createRecallRouteHandler(() => fakeProvider([]));
    const { res, result } = mockResponse();
    await handler(mockRequest({ query: "   " }), res);
    expect(result.status).toBe(400);
  });

  it("returns 500 when the provider throws", async () => {
    const handler = createRecallRouteHandler(() => ({
      register: () => {},
      unregister: () => {},
      contributors: () => ["knowledge"],
      async recall() {
        throw new Error("provider boom");
      },
    }));
    const { res, result } = mockResponse();
    await handler(mockRequest({ query: "anything" }), res);
    expect(result.status).toBe(500);
    expect((result.body as { error: string }).error).toContain("provider boom");
  });
});
