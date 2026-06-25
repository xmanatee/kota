import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type {
  ResourceDiscoveryFilter,
  ResourceDiscoveryProvider,
  ResourceDiscoveryResult,
} from "./client.js";
import { createResourceDiscoveryRouteHandler } from "./routes.js";

const sampleResult: ResourceDiscoveryResult = {
  ok: true,
  query: "send a Slack approval",
  degradation: "keyword_only",
  hits: [],
};

function mockResponse() {
  const result = { status: 0, body: null as object | null };
  const res = {
    setHeader: vi.fn(),
    writeHead: (status: number) => {
      result.status = status;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function mockRequest(body: object): IncomingMessage {
  const data = Buffer.from(JSON.stringify(body));
  const handlers: { data?: Array<(arg: Buffer) => void>; end?: Array<() => void> } = {};
  return {
    on(event: string, handler: (arg?: Buffer) => void) {
      if (event === "data") {
        handlers.data = [...(handlers.data ?? []), handler as (arg: Buffer) => void];
      }
      if (event === "end") {
        handlers.end = [...(handlers.end ?? []), handler as () => void];
        setImmediate(() => {
          for (const dataHandler of handlers.data ?? []) dataHandler(data);
          for (const endHandler of handlers.end ?? []) endHandler();
        });
      }
      return this;
    },
  } as unknown as IncomingMessage;
}

function provider(capture: { query?: string; filter?: ResourceDiscoveryFilter }): ResourceDiscoveryProvider {
  return {
    async discover(query, filter) {
      capture.query = query;
      capture.filter = filter;
      return sampleResult;
    },
  };
}

describe("resource discovery route handler", () => {
  it("returns the shared discovery envelope and forwards filters", async () => {
    const capture: { query?: string; filter?: ResourceDiscoveryFilter } = {};
    const handler = createResourceDiscoveryRouteHandler(() => provider(capture));
    const { res, result } = mockResponse();
    await handler(
      mockRequest({
        query: "send a Slack approval",
        filter: { limit: 3, kinds: ["tool"], includeUnavailable: false },
      }),
      res,
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual(sampleResult);
    expect(capture).toEqual({
      query: "send a Slack approval",
      filter: { limit: 3, kinds: ["tool"], includeUnavailable: false },
    });
  });

  it("returns 400 for a missing query", async () => {
    const handler = createResourceDiscoveryRouteHandler(() => provider({}));
    const { res, result } = mockResponse();
    await handler(mockRequest({}), res);
    expect(result.status).toBe(400);
  });
});
