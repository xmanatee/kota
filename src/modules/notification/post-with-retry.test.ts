import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postWithRetry } from "./index.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const URL = "https://hooks.example.com/notify";
const BODY = JSON.stringify({ event: "test" });

describe("postWithRetry", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately on a 2xx response with one fetch call", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 3, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    await p;
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("retries up to the configured count on non-2xx response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 3, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    await p;
    // 1 initial + 3 retries = 4 total
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(URL));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("503"));
  });

  it("retries on network error and logs warning after all retries", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNRESET"));
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 2, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    await p;
    // 1 initial + 2 retries = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("ECONNRESET"));
  });

  it("succeeds on a retry after an initial failure", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, status: 200 });
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 3, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    await p;
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("uses exponential backoff — delays grow as 1x, 2x, 4x base", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const log = { warn: vi.fn() };
    const BASE = 100;
    const p = postWithRetry(URL, BODY, log, { retries: 3, baseDelayMs: BASE });

    // After initial attempt, advance by less than first delay — only 1 call
    await vi.advanceTimersByTimeAsync(BASE - 1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance through 1st retry delay (100ms total)
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Before second retry delay (200ms) fires — still 2 calls
    await vi.advanceTimersByTimeAsync(BASE * 2 - 1);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // After second retry delay
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Advance through remaining time
    await vi.runAllTimersAsync();
    await p;
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("respects retries=0 — only one attempt, immediate warning on failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 0, baseDelayMs: 100 });
    await vi.runAllTimersAsync();
    await p;
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("429"));
  });

  it("uses default retries (3) and baseDelayMs (1000) when options omitted", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log);
    await vi.runAllTimersAsync();
    await p;
    // 1 + 3 retries = 4 calls with default retries=3
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("includes attempt count in the warning message", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const log = { warn: vi.fn() };
    const p = postWithRetry(URL, BODY, log, { retries: 2, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    await p;
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("3 attempt(s)"));
  });
});
