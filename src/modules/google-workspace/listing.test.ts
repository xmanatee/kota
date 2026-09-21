import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type OutboundHttpRequestHandler, outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { listGooglePages } from "./listing.js";

const pageSchema = z.object({
  items: z.array(z.string()),
  nextPageToken: z.string().min(1).optional(),
  limitation: z.string().optional(),
});

function listing(responses: Array<Response | Error>, maxResults = 3) {
  const request = vi.fn<OutboundHttpRequestHandler>(() => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("Unexpected request");
    return response;
  });
  const result = listGooglePages({
    getToken: async () => "test-token",
    http: outboundHttpRequestPort(request),
    maxResults,
    pageSchema,
    url: (remaining, pageToken) => `https://www.googleapis.com/list?${new URLSearchParams({
      remaining: String(remaining), ...(pageToken ? { pageToken } : {}),
    })}`,
  });
  return { result, request };
}

describe("bounded Google listing", () => {
  it("exhausts empty and short pages, including an exact terminal result limit", async () => {
    const { result, request } = listing([
      Response.json({ items: [], nextPageToken: "a /+" }),
      Response.json({ items: ["one"], nextPageToken: "b" }),
      Response.json({ items: ["two"] }),
    ], 2);
    expect(await result).toEqual({ items: ["one", "two"], state: { kind: "complete" } });
    const urls = request.mock.calls.map(([req]) => new URL(String(req.url)));
    expect(urls.map((url) => url.searchParams.get("remaining"))).toEqual(["2", "2", "1"]);
    expect(urls.map((url) => url.searchParams.get("pageToken"))).toEqual([null, "a /+", "b"]);
  });

  it.each([
    { items: ["kept"], nextPageToken: "more" },
    { items: ["kept", "omitted"] },
  ])("reports a result bound without discarding retained items: %j", async (page) => {
    const { result, request } = listing([Response.json(page)], 1);
    expect(await result).toEqual({ items: ["kept"], state: { kind: "partial", reason: expect.stringContaining("1-result limit") } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [Response.json({}, { status: 503 }), "503"],
    [new Error("secret transport detail"), "request failed"],
    [new Response("not json"), "invalid list page"],
    [Response.json({ items: [null] }), "invalid list page"],
    [Response.json({ items: [], nextPageToken: 2 }), "invalid list page"],
  ])("retains items on continuation failure %s", async (failure, reason) => {
    const { result } = listing([
      Response.json({ items: ["kept"], nextPageToken: "next" }),
      failure,
    ]);
    expect(await result).toEqual({ items: ["kept"], state: { kind: "unavailable", reason: expect.stringContaining(reason) } });
    expect(JSON.stringify(await result)).not.toContain("secret transport detail");
  });

  it("does not confuse failed continuation after an empty page with exhaustion", async () => {
    const { result } = listing([
      Response.json({ items: [], nextPageToken: "next" }),
      Response.json({}, { status: 500 }),
    ]);
    expect(await result).toMatchObject({ items: [], state: { kind: "unavailable" } });
  });

  it("stops cyclic tokens", async () => {
    const { result, request } = listing(["a", "b", "a"].map((nextPageToken) => Response.json({ items: [], nextPageToken })));
    expect(await result).toMatchObject({ state: { kind: "unavailable", reason: expect.stringContaining("repeated a continuation token") } });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("bounds distinct continuation tokens", async () => {
    const { result, request } = listing(Array.from({ length: 11 }, (_, i) => Response.json({ items: [], nextPageToken: `page-${i}` })));
    expect(await result).toMatchObject({ state: { kind: "partial", reason: expect.stringContaining("10-page limit") } });
    expect(request).toHaveBeenCalledTimes(10);
  });

  it("retains service limitations through exhaustion and later failures", async () => {
    for (const last of [Response.json({ items: [] }), Response.json({}, { status: 503 })]) {
      const { result } = listing([
        Response.json({ items: ["kept"], limitation: "Search incomplete.", nextPageToken: "next" }),
        last,
      ]);
      expect(await result).toMatchObject({ items: ["kept"], state: {
        kind: last.ok ? "partial" : "unavailable", reason: expect.stringContaining("Search incomplete."),
      } });
    }
  });

  it("reports credential failure without exposing its details or requesting pages", async () => {
    const request = vi.fn();
    const result = await listGooglePages({
      getToken: async () => { throw new Error("credential secret"); },
      http: outboundHttpRequestPort(request), maxResults: 1, pageSchema,
      url: () => "https://www.googleapis.com/list",
    });
    expect(result.state.kind).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("credential secret");
    expect(request).not.toHaveBeenCalled();
  });
});
