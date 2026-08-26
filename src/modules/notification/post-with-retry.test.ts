import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type OutboundHttpRequestHandler,
  outboundHttpRequestPort,
} from "#core/outbound-http/testing/request-port.js";
import { postWithRetry } from "./index.js";

const mockRequest = vi.fn<OutboundHttpRequestHandler>();
const http = outboundHttpRequestPort(mockRequest);

const URL = "https://hooks.example.com/notify";
const BODY = JSON.stringify({ event: "test" });

describe("postWithRetry", () => {
  beforeEach(() => {
    mockRequest.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately on a 2xx response with one fetch call", async () => {
    mockRequest.mockResolvedValue(new Response("", { status: 200 }));
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 3, baseDelayMs: 100, http });
    await vi.runAllTimersAsync();
    await p;
    expect(mockRequest).toHaveBeenCalledOnce();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("retries up to the configured count on non-2xx response", async () => {
    mockRequest.mockResolvedValue(new Response("", { status: 503 }));
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 3, baseDelayMs: 100, http });
    await vi.runAllTimersAsync();
    await p;
    // 1 initial + 3 retries = 4 total
    expect(mockRequest).toHaveBeenCalledTimes(4);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(URL));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("503"));
  });

  it("retries on network error and logs warning after all retries", async () => {
    mockRequest.mockRejectedValue(new Error("ECONNRESET"));
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 2, baseDelayMs: 100, http });
    await vi.runAllTimersAsync();
    await p;
    // 1 initial + 2 retries = 3 total
    expect(mockRequest).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("ECONNRESET"));
  });

  it("succeeds on a retry after an initial failure", async () => {
    mockRequest
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValue(new Response("", { status: 200 }));
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 3, baseDelayMs: 100, http });
    await vi.runAllTimersAsync();
    await p;
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("uses exponential backoff — delays grow as 1x, 2x, 4x base", async () => {
    mockRequest.mockResolvedValue(new Response("", { status: 500 }));
    const log = { warn: vi.fn() };
    const BASE = 100;
    const p = postWithRetry(URL, BODY, log, { retries: 3, baseDelayMs: BASE, http });

    // After initial attempt, advance by less than first delay — only 1 call
    await vi.advanceTimersByTimeAsync(BASE - 1);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    // Advance through 1st retry delay (100ms total)
    await vi.advanceTimersByTimeAsync(1);
    expect(mockRequest).toHaveBeenCalledTimes(2);

    // Before second retry delay (200ms) fires — still 2 calls
    await vi.advanceTimersByTimeAsync(BASE * 2 - 1);
    expect(mockRequest).toHaveBeenCalledTimes(2);

    // After second retry delay
    await vi.advanceTimersByTimeAsync(1);
    expect(mockRequest).toHaveBeenCalledTimes(3);

    // Advance through remaining time
    await vi.runAllTimersAsync();
    await p;
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });

  it("respects retries=0 — only one attempt, immediate warning on failure", async () => {
    mockRequest.mockResolvedValue(new Response("", { status: 429 }));
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 0, baseDelayMs: 100, http });
    await vi.runAllTimersAsync();
    await p;
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("429"));
  });

  it("uses default retries (3) and baseDelayMs (1000) when options omitted", async () => {
    mockRequest.mockResolvedValue(new Response("", { status: 502 }));
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { http });
    await vi.runAllTimersAsync();
    await p;
    // 1 + 3 retries = 4 calls with default retries=3
    expect(mockRequest).toHaveBeenCalledTimes(4);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("includes attempt count in the warning message", async () => {
    mockRequest.mockResolvedValue(new Response("", { status: 500 }));
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 2, baseDelayMs: 10, http });
    await vi.runAllTimersAsync();
    await p;
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("3 attempt(s)"));
  });

  it("applies caller headers, injected fetch, and redacted log URLs", async () => {
    const callbackUrl = "https://hooks.example.com/notify?secret=query-token#fragment-secret";
    const redactedUrl = "https://hooks.example.com/notify?...";
    const request = vi.fn<OutboundHttpRequestHandler>()
      .mockRejectedValue(new Error(`connect to ${callbackUrl} failed`));
    const log = { warn: vi.fn() };
    const p = postWithRetry(callbackUrl, BODY, log, {
      retries: 0,
      baseDelayMs: 100,
      headers: {
        "Content-Type": "application/a2a+json",
        Authorization: "Bearer secret-token",
      },
      logUrl: redactedUrl,
      http: outboundHttpRequestPort(request),
    });
    await vi.runAllTimersAsync();
    await p;

    expect(request).toHaveBeenCalledWith({
      profile: expect.objectContaining({ name: "explicit-callback" }),
      operation: "notification.webhook.post",
      url: callbackUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/a2a+json",
        Authorization: "Bearer secret-token",
      },
      body: BODY,
    });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("notify?..."));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining("query-token"));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining("fragment-secret"));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining("secret-token"));
  });
});
