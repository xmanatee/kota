import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RetractRequest, RetractResult } from "./client.js";
import type { RetractProvider } from "./retract-types.js";
import { createRetractRouteHandler } from "./routes.js";

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

function fixedProvider(
  result: RetractResult,
  recorded?: { request?: RetractRequest },
): RetractProvider {
  return {
    register() {},
    contributors() {
      return ["memory", "knowledge", "tasks", "inbox"];
    },
    async retract(request) {
      if (recorded) recorded.request = request;
      return result;
    },
  };
}

describe("createRetractRouteHandler", () => {
  it("rejects missing target with 400", async () => {
    const handler = createRetractRouteHandler(() =>
      fixedProvider({ ok: false, reason: "no_contributors" }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({});
    await handler(req, res);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "target is required" });
  });

  it("rejects unknown target with 400", async () => {
    const handler = createRetractRouteHandler(() =>
      fixedProvider({ ok: false, reason: "no_contributors" }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ target: "garbage" });
    await handler(req, res);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'unknown target "garbage"' });
  });

  it("rejects memory request without id with 400", async () => {
    const handler = createRetractRouteHandler(() =>
      fixedProvider({ ok: false, reason: "no_contributors" }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ target: "memory" });
    await handler(req, res);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "memory retract requires `id`" });
  });

  it("rejects knowledge request without slug with 400", async () => {
    const handler = createRetractRouteHandler(() =>
      fixedProvider({ ok: false, reason: "no_contributors" }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ target: "knowledge" });
    await handler(req, res);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "knowledge retract requires `slug`",
    });
  });

  it("rejects inbox request without path with 400", async () => {
    const handler = createRetractRouteHandler(() =>
      fixedProvider({ ok: false, reason: "no_contributors" }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ target: "inbox" });
    await handler(req, res);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "inbox retract requires `path`",
    });
  });

  it("returns the typed memory success envelope verbatim", async () => {
    const recorded: { request?: RetractRequest } = {};
    const handler = createRetractRouteHandler(() =>
      fixedProvider(
        { ok: true, record: { target: "memory", recordId: "mem-1" } },
        recorded,
      ),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ target: "memory", id: "mem-1" });
    await handler(req, res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      record: { target: "memory", recordId: "mem-1" },
    });
    expect(recorded.request).toEqual({ target: "memory", id: "mem-1" });
  });

  it("returns the typed tasks success envelope (moved-to-dropped)", async () => {
    const handler = createRetractRouteHandler(() =>
      fixedProvider({
        ok: true,
        record: {
          target: "tasks",
          recordId: "task-x",
          previousPath: "data/tasks/backlog/task-x.md",
          path: "data/tasks/dropped/task-x.md",
          toState: "dropped",
        },
      }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ target: "tasks", id: "task-x" });
    await handler(req, res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      record: {
        target: "tasks",
        recordId: "task-x",
        previousPath: "data/tasks/backlog/task-x.md",
        path: "data/tasks/dropped/task-x.md",
        toState: "dropped",
      },
    });
  });

  it("returns the typed not_found envelope as 200 JSON", async () => {
    const handler = createRetractRouteHandler(() =>
      fixedProvider({
        ok: false,
        reason: "not_found",
        target: "memory",
        identifier: "mem-missing",
      }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ target: "memory", id: "mem-missing" });
    await handler(req, res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: false,
      reason: "not_found",
      target: "memory",
      identifier: "mem-missing",
    });
  });

  it("returns the typed no_contributors envelope as 200 JSON", async () => {
    const handler = createRetractRouteHandler(() =>
      fixedProvider({ ok: false, reason: "no_contributors" }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ target: "knowledge", slug: "k" });
    await handler(req, res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: false, reason: "no_contributors" });
  });

  it("returns the typed contributor_failed envelope as 200 JSON", async () => {
    const handler = createRetractRouteHandler(() =>
      fixedProvider({
        ok: false,
        reason: "contributor_failed",
        target: "inbox",
        message: "disk read-only",
      }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({
      target: "inbox",
      path: "data/inbox/note-x.md",
    });
    await handler(req, res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: false,
      reason: "contributor_failed",
      target: "inbox",
      message: "disk read-only",
    });
  });

  it("returns 500 with the error message when the provider throws", async () => {
    const handler = createRetractRouteHandler(() => ({
      register() {},
      contributors() {
        return [];
      },
      async retract() {
        throw new Error("boom");
      },
    }));
    const { res, result } = mockResponse();
    const req = mockRequest({ target: "memory", id: "mem-1" });
    await handler(req, res);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "boom" });
  });
});
