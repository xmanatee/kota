import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RecallProvider } from "./recall-types.js";
import { RecallScopeSelectionError } from "./recall-types.js";
import { createRecallRouteHandler } from "./routes.js";

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

function response(): {
  res: ServerResponse;
  result: { status: number; body: unknown };
} {
  const result = { status: 0, body: undefined as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead(status: number) { result.status = status; },
    end(data: string) { result.body = JSON.parse(data); },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function provider(recall: RecallProvider["recall"]): RecallProvider {
  return {
    register() {},
    unregister() {},
    contributors: () => ["knowledge"],
    recall,
  };
}

describe("recall route boundary", () => {
  it("decodes the untrusted query/filter once before calling the domain owner", async () => {
    const recall = vi.fn<RecallProvider["recall"]>(async () => ({ ok: true, hits: [] }));
    const handler = createRecallRouteHandler(() => provider(recall));
    const { res, result } = response();

    await handler(request({
      query: "graphrag",
      filter: {
        topK: 5,
        minScore: 0.4,
        sources: ["knowledge", "unknown"],
        scopeId: "scope-a",
      },
    }), res);

    expect(result.status).toBe(200);
    expect(recall).toHaveBeenCalledWith("graphrag", {
      topK: 5,
      minScore: 0.4,
      sources: ["knowledge"],
      scopeId: "scope-a",
    });
  });

  it("rejects a blank wire query and maps an unknown domain scope", async () => {
    const recall = vi.fn<RecallProvider["recall"]>(async () => {
      throw new RecallScopeSelectionError("missing");
    });
    const handler = createRecallRouteHandler(() => provider(recall));
    const blank = response();
    await handler(request({ query: "  " }), blank.res);
    expect(blank.result.status).toBe(400);
    expect(recall).not.toHaveBeenCalled();

    const unknown = response();
    await handler(request({ query: "x", filter: { scopeId: "missing" } }), unknown.res);
    expect(unknown.result.status).toBe(404);
    expect(unknown.result.body).toEqual({
      error: "Unknown scope",
      reason: "unknown_scope",
      scopeId: "missing",
    });
  });
});
