import { describe, expect, it, vi } from "vitest";
import {
  OUTBOUND_HTTP_PROFILES,
  type OutboundHttpDispatcher,
  OutboundHttpTransport,
} from "#core/outbound-http/index.js";

const PUBLIC_ADDRESS = [{ address: "93.184.216.34", family: 4 as const }];

function queuedDispatcher(responses: Response[], captured: Array<{ url: string; init: RequestInit }> = []): OutboundHttpDispatcher {
  const queue = [...responses];
  return async (url, init) => {
    captured.push({ url: url.toString(), init });
    const response = queue.shift();
    if (!response) throw new Error(`unexpected request to ${url.toString()}`);
    return response;
  };
}

function publicTransport(dispatcher: OutboundHttpDispatcher): OutboundHttpTransport {
  return new OutboundHttpTransport({
    dispatcher,
    resolveAddresses: async () => PUBLIC_ADDRESS,
  });
}

describe("OutboundHttpTransport", () => {
  it("strips credentials and unsafe headers on a cross-origin POST-to-GET redirect", async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    const transport = publicTransport(
      queuedDispatcher(
        [
          new Response(null, {
            status: 302,
            headers: { location: "https://uploads.example/final" },
          }),
          new Response("ok"),
        ],
        captured,
      ),
    );

    const result = await transport.request({
      profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
      operation: "redirect-fixture",
      url: "https://api.example/start",
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
        "X-Api-Key": "secret",
      },
      body: '{"secret":"value"}',
    });

    expect(result.redirected).toBe(true);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.init.method).toBe("GET");
    expect(captured[1]?.init.body).toBeUndefined();
    const redirectedHeaders = new Headers(captured[1]?.init.headers);
    expect(redirectedHeaders.get("accept")).toBe("application/json");
    expect(redirectedHeaders.get("authorization")).toBeNull();
    expect(redirectedHeaders.get("content-type")).toBeNull();
    expect(redirectedHeaders.get("x-api-key")).toBeNull();
  });

  it("rejects a cross-origin redirect that would replay a state-changing body", async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    const transport = publicTransport(
      queuedDispatcher(
        [
          new Response(null, {
            status: 307,
            headers: { location: "https://uploads.example/final" },
          }),
        ],
        captured,
      ),
    );

    await expect(
      transport.request({
        profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
        operation: "redirect-fixture",
        url: "https://api.example/start",
        method: "POST",
        body: "secret",
      }),
    ).rejects.toMatchObject({ failure: { code: "redirect-denied" } });
    expect(captured).toHaveLength(1);
  });

  it("enforces redirect policy before returning a streaming response", async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    const transport = publicTransport(
      queuedDispatcher(
        [
          new Response(null, {
            status: 307,
            headers: { location: "http://127.0.0.1/private" },
          }),
        ],
        captured,
      ),
    );

    await expect(
      transport.requestStream({
        profile: OUTBOUND_HTTP_PROFILES.configuredProvider(["https://mcp.example"]),
        operation: "mcp-stream-redirect-fixture",
        url: "https://mcp.example/rpc",
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        body: '{"jsonrpc":"2.0"}',
      }),
    ).rejects.toMatchObject({ failure: { code: "redirect-denied" } });
    expect(captured.map((request) => request.url)).toEqual(["https://mcp.example/rpc"]);
  });

  it("classifies retries by the original method after a POST-to-GET redirect", async () => {
    const transport = publicTransport(
      queuedDispatcher([
        new Response(null, {
          status: 302,
          headers: { location: "https://api.example/final" },
        }),
        new Response("down", { status: 503 }),
      ]),
    );

    const result = await transport.request({
      profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
      operation: "redirected-write-retry-fixture",
      url: "https://api.example/start",
      method: "POST",
      body: "payload",
    });

    expect(result.method).toBe("GET");
    expect(result.retry).toEqual({
      eligible: false,
      reason: "method-not-idempotent",
    });
  });

  it("classifies transport timeout and caller abort separately", async () => {
    vi.useFakeTimers();
    try {
      const dispatcher: OutboundHttpDispatcher = async (_url, init) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      const transport = publicTransport(dispatcher);
      const timedOut = transport.request({
        profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
        operation: "timeout-fixture",
        url: "https://api.example/slow",
        limits: { timeoutMs: 10 },
      });
      const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
        failure: {
          code: "timeout",
          retry: { eligible: true, reason: "timeout" },
        },
      });
      await vi.advanceTimersByTimeAsync(10);
      await timeoutAssertion;

      const controller = new AbortController();
      const aborted = transport.request({
        profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
        operation: "abort-fixture",
        url: "https://api.example/slow",
        signal: controller.signal,
      });
      const abortAssertion = expect(aborted).rejects.toMatchObject({
        failure: {
          code: "aborted",
          retry: { eligible: false, reason: "caller-aborted" },
        },
      });
      controller.abort();
      await abortAssertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces timeout and caller abort while public DNS validation is pending", async () => {
    vi.useFakeTimers();
    try {
      const dispatcher = vi.fn<OutboundHttpDispatcher>();
      const pendingResolutions: Array<(addresses: typeof PUBLIC_ADDRESS) => void> = [];
      const resolveAddresses = () =>
        new Promise<typeof PUBLIC_ADDRESS>((resolve) => {
          pendingResolutions.push(resolve);
        });
      const transport = new OutboundHttpTransport({ dispatcher, resolveAddresses });

      const timedOut = transport.request({
        profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
        operation: "dns-timeout-fixture",
        url: "https://api.example/slow-dns",
        limits: { timeoutMs: 10 },
      });
      const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
        failure: {
          code: "timeout",
          retry: { eligible: true, reason: "timeout" },
        },
      });
      await vi.advanceTimersByTimeAsync(10);
      await timeoutAssertion;
      pendingResolutions.shift()?.(PUBLIC_ADDRESS);
      await Promise.resolve();

      const controller = new AbortController();
      const aborted = transport.request({
        profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
        operation: "dns-abort-fixture",
        url: "https://api.example/slow-dns",
        signal: controller.signal,
        limits: { timeoutMs: 10 },
      });
      const abortAssertion = expect(aborted).rejects.toMatchObject({
        failure: {
          code: "aborted",
          retry: { eligible: false, reason: "caller-aborted" },
        },
      });
      controller.abort();
      await vi.advanceTimersByTimeAsync(10);
      pendingResolutions.shift()?.(PUBLIC_ADDRESS);
      await abortAssertion;
      await Promise.resolve();
      expect(dispatcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

});
