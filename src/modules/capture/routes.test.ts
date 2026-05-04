import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { CaptureProvider } from "./capture-types.js";
import type { CaptureFilter, CaptureResult } from "./client.js";
import { createCaptureRouteHandler } from "./routes.js";

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
  result: CaptureResult,
  recorded?: { text?: string; filter?: CaptureFilter | undefined },
): CaptureProvider {
  return {
    register() {},
    contributors() {
      return ["memory", "knowledge", "tasks", "inbox"];
    },
    async capture(text, filter) {
      if (recorded) {
        recorded.text = text;
        recorded.filter = filter;
      }
      return result;
    },
  };
}

describe("createCaptureRouteHandler", () => {
  it("rejects empty text with 400", async () => {
    const handler = createCaptureRouteHandler(() =>
      fixedProvider({
        ok: false,
        reason: "ambiguous",
        suggestions: ["memory"],
      }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ text: "" });
    await handler(req, res);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "text is required" });
  });

  it("returns the typed success envelope verbatim", async () => {
    const recorded: { text?: string; filter?: CaptureFilter | undefined } = {};
    const handler = createCaptureRouteHandler(() =>
      fixedProvider(
        {
          ok: true,
          record: { target: "memory", recordId: "mem-1" },
        },
        recorded,
      ),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ text: "remember dark themes" });
    await handler(req, res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      record: { target: "memory", recordId: "mem-1" },
    });
    expect(recorded.text).toBe("remember dark themes");
    expect(recorded.filter).toBeUndefined();
  });

  it("forwards target and hint from the request body", async () => {
    const recorded: { text?: string; filter?: CaptureFilter | undefined } = {};
    const handler = createCaptureRouteHandler(() =>
      fixedProvider(
        {
          ok: true,
          record: {
            target: "tasks",
            recordId: "task-x",
            path: "data/tasks/backlog/task-x.md",
          },
        },
        recorded,
      ),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({
      text: "review macOS push perms",
      filter: { target: "tasks", hint: "release-prep" },
    });
    await handler(req, res);
    expect(result.status).toBe(200);
    expect(recorded.filter).toEqual({ target: "tasks", hint: "release-prep" });
  });

  it("drops unknown target values from the filter", async () => {
    const recorded: { text?: string; filter?: CaptureFilter | undefined } = {};
    const handler = createCaptureRouteHandler(() =>
      fixedProvider(
        {
          ok: false,
          reason: "ambiguous",
          suggestions: ["memory", "tasks"],
        },
        recorded,
      ),
    );
    const { res } = mockResponse();
    const req = mockRequest({
      text: "anything",
      filter: { target: "garbage" },
    });
    await handler(req, res);
    expect(recorded.filter).toBeUndefined();
  });

  it("returns the typed ambiguous envelope as 200 JSON", async () => {
    const handler = createCaptureRouteHandler(() =>
      fixedProvider({
        ok: false,
        reason: "ambiguous",
        suggestions: ["memory", "knowledge"],
      }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ text: "ambiguous note" });
    await handler(req, res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: false,
      reason: "ambiguous",
      suggestions: ["memory", "knowledge"],
    });
  });

  it("returns the typed contributor_failed envelope as 200 JSON", async () => {
    const handler = createCaptureRouteHandler(() =>
      fixedProvider({
        ok: false,
        reason: "contributor_failed",
        target: "inbox",
        message: "disk full",
      }),
    );
    const { res, result } = mockResponse();
    const req = mockRequest({ text: "rough thought", filter: { target: "inbox" } });
    await handler(req, res);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: false,
      reason: "contributor_failed",
      target: "inbox",
      message: "disk full",
    });
  });

  it("returns 500 with the error message when the provider throws", async () => {
    const handler = createCaptureRouteHandler(() => ({
      register() {},
      contributors() {
        return [];
      },
      async capture() {
        throw new Error("boom");
      },
    }));
    const { res, result } = mockResponse();
    const req = mockRequest({ text: "x" });
    await handler(req, res);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "boom" });
  });
});
