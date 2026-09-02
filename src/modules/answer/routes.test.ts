import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { AnswerScopeSelectionError } from "./answer-types.js";
import type { AnswerClient } from "./client.js";
import { createAnswerRouteHandler } from "./routes.js";

function request(body: Record<string, unknown>): IncomingMessage {
  const data = Buffer.from(JSON.stringify(body));
  const handlers: Record<string, Array<(value?: Buffer) => void>> = {};
  return {
    on(event: string, handler: (value?: Buffer) => void) {
      (handlers[event] ??= []).push(handler);
      if (event === "end") {
        setImmediate(() => {
          for (const listener of handlers.data ?? []) listener(data);
          for (const listener of handlers.end ?? []) listener();
        });
      }
      return this;
    },
  } as unknown as IncomingMessage;
}

function response() {
  const result = { status: 0, body: undefined as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead(status: number) { result.status = status; },
    end(data: string) { result.body = JSON.parse(data); },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function client(answer: AnswerClient["answer"]): AnswerClient {
  return {
    answer,
    async log() { return { entries: [] }; },
    async show() { return { ok: false, reason: "not_found" }; },
  };
}

describe("answer route boundary", () => {
  it("rejects blank wire queries before synthesis", async () => {
    const answer = vi.fn<AnswerClient["answer"]>(async () => ({ ok: false, reason: "no_hits" }));
    const handler = createAnswerRouteHandler(() => client(answer));
    const { res, result } = response();
    await handler(request({ query: " " }), res);
    expect(result.status).toBe(400);
    expect(answer).not.toHaveBeenCalled();
  });

  it("maps the domain owner's unknown-scope error without copying result arms", async () => {
    const answer = vi.fn<AnswerClient["answer"]>(async () => {
      throw new AnswerScopeSelectionError("missing");
    });
    const handler = createAnswerRouteHandler(() => client(answer));
    const { res, result } = response();
    await handler(request({ query: "x", filter: { scopeId: "missing" } }), res);
    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: "Unknown scope",
      reason: "unknown_scope",
      scopeId: "missing",
    });
  });
});
