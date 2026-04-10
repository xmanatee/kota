import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "#core/tools/index.js";
import { createRetryMiddleware, getRetryStats, RETRY_POLICIES, resetRetryStats } from "./tool-retry.js";

// --- Shell retry policy ---

describe("RETRY_POLICIES.shell", () => {
  const { shouldRetry, adjustInput } = RETRY_POLICIES.shell;

  it("retries on 'timed out' message", () => {
    expect(shouldRetry("Command timed out after 120000ms", {})).toBe(true);
  });

  it("retries on 'timeout after' with output", () => {
    expect(shouldRetry("some output\n\n(killed: timeout after 120000ms)", {})).toBe(true);
  });

  it("does not retry non-timeout errors", () => {
    expect(shouldRetry("Command failed with exit code 1", {})).toBe(false);
    expect(shouldRetry("Permission denied", {})).toBe(false);
    expect(shouldRetry("Error: ENOENT: no such file", {})).toBe(false);
  });

  it("does not retry when doubled timeout exceeds 300s", () => {
    expect(shouldRetry("timeout", { timeout_ms: 200_000 })).toBe(false);
  });

  it("retries when doubled timeout fits within 300s", () => {
    expect(shouldRetry("timeout", { timeout_ms: 150_000 })).toBe(true);
    expect(shouldRetry("timeout", { timeout_ms: 120_000 })).toBe(true);
  });

  it("doubles the default timeout (120s → 240s)", () => {
    const result = adjustInput!({});
    expect(result.timeout_ms).toBe(240_000);
  });

  it("doubles a custom timeout", () => {
    const result = adjustInput!({ command: "npm test", timeout_ms: 60_000 });
    expect(result.timeout_ms).toBe(120_000);
    expect(result.command).toBe("npm test"); // preserves other fields
  });
});

// --- Web fetch retry policy ---

describe("RETRY_POLICIES.web_fetch", () => {
  const { shouldRetry } = RETRY_POLICIES.web_fetch;

  it("retries on transient network errors", () => {
    expect(shouldRetry("Fetch error: ECONNRESET", {})).toBe(true);
    expect(shouldRetry("Fetch error: ETIMEDOUT", {})).toBe(true);
    expect(shouldRetry("Fetch error: ECONNREFUSED", {})).toBe(true);
    expect(shouldRetry("Fetch error: socket hang up", {})).toBe(true);
  });

  it("retries on transient HTTP errors", () => {
    expect(shouldRetry("HTTP 429 Too Many Requests", {})).toBe(true);
    expect(shouldRetry("HTTP 502 Bad Gateway", {})).toBe(true);
    expect(shouldRetry("HTTP 503 Service Unavailable", {})).toBe(true);
  });

  it("does not retry on permanent HTTP errors", () => {
    expect(shouldRetry("HTTP 404 Not Found", {})).toBe(false);
    expect(shouldRetry("HTTP 403 Forbidden", {})).toBe(false);
    expect(shouldRetry("HTTP 401 Unauthorized", {})).toBe(false);
  });

  it("does not retry on non-network errors", () => {
    expect(shouldRetry("Error: url is required", {})).toBe(false);
    expect(shouldRetry("Error: url must start with http://", {})).toBe(false);
  });
});

// --- Web search retry policy ---

describe("RETRY_POLICIES.web_search", () => {
  const { shouldRetry } = RETRY_POLICIES.web_search;

  it("retries on transient errors", () => {
    expect(shouldRetry("Fetch error: ECONNRESET", {})).toBe(true);
    expect(shouldRetry("HTTP 500 Internal Server Error", {})).toBe(true);
  });

  it("does not retry on permanent errors", () => {
    expect(shouldRetry("Error: query is required", {})).toBe(false);
  });
});

// --- createRetryMiddleware ---

describe("createRetryMiddleware", () => {
  const noSleep = () => Promise.resolve();
  let callCount: number;

  beforeEach(() => {
    resetRetryStats();
    callCount = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRetryStats();
  });

  it("passes through for tools without retry policy", async () => {
    const mw = createRetryMiddleware(noSleep);
    const result = await mw(
      { name: "file_read", input: { path: "/a.txt" } },
      async () => ({ content: "File not found", is_error: true }),
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toBe("File not found");
    expect(getRetryStats().totalRetries).toBe(0);
  });

  it("passes through on success (no retry needed)", async () => {
    const mw = createRetryMiddleware(noSleep);
    const result = await mw(
      { name: "web_fetch", input: { url: "https://ok.com" } },
      async () => ({ content: "<html>ok</html>" }),
    );
    expect(result.content).toBe("<html>ok</html>");
    expect(result.is_error).toBeUndefined();
    expect(getRetryStats().totalRetries).toBe(0);
  });

  it("retries web_fetch on transient network error and succeeds", async () => {
    const mw = createRetryMiddleware(noSleep);
    const next = async () => {
      callCount++;
      if (callCount === 1) return { content: "ECONNRESET", is_error: true } as ToolResult;
      return { content: "<html>page</html>" } as ToolResult;
    };
    const result = await mw({ name: "web_fetch", input: { url: "https://x.com" } }, next);
    expect(result.content).toContain("<html>page</html>");
    expect(result.content).toContain("auto-retry");
    expect(callCount).toBe(2);
    expect(getRetryStats().totalRetries).toBe(1);
    expect(getRetryStats().successAfterRetry).toBe(1);
  });

  it("retries shell timeout with adjusted input", async () => {
    const mw = createRetryMiddleware(noSleep);
    const call = { name: "shell", input: { command: "npm test", timeout_ms: 120_000 } };
    const next = async () => {
      callCount++;
      if (callCount === 1) return { content: "Command timed out after 120s", is_error: true } as ToolResult;
      return { content: "tests pass" } as ToolResult;
    };
    const result = await mw(call, next);
    expect(result.content).toContain("tests pass");
    expect(result.content).toContain("auto-retry");
    expect(result.content).toContain("240s");
    // Middleware should have mutated call.input for baseFn
    expect(call.input.timeout_ms).toBe(240_000);
  });

  it("does not retry shell on non-timeout errors", async () => {
    const mw = createRetryMiddleware(noSleep);
    const result = await mw(
      { name: "shell", input: { command: "bad" } },
      async () => ({ content: "exit code 1", is_error: true }),
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toBe("exit code 1");
    expect(getRetryStats().totalRetries).toBe(0);
  });

  it("does not retry shell when doubled timeout exceeds max", async () => {
    const mw = createRetryMiddleware(noSleep);
    const result = await mw(
      { name: "shell", input: { command: "slow", timeout_ms: 200_000 } },
      async () => ({ content: "timed out", is_error: true }),
    );
    expect(result.is_error).toBe(true);
    expect(getRetryStats().totalRetries).toBe(0);
  });

  it("returns combined error when retry also fails", async () => {
    const mw = createRetryMiddleware(noSleep);
    const next = async () => {
      callCount++;
      if (callCount === 1) return { content: "HTTP 502 Bad Gateway", is_error: true } as ToolResult;
      return { content: "HTTP 503 Service Unavailable", is_error: true } as ToolResult;
    };
    const result = await mw({ name: "http_request", input: { url: "https://down.com" } }, next);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("503");
    expect(result.content).toContain("Auto-retry also failed");
    expect(result.content).toContain("502");
    expect(getRetryStats().totalRetries).toBe(1);
    expect(getRetryStats().exhausted).toBe(1);
  });

  it("does not retry web_fetch on permanent errors (404)", async () => {
    const mw = createRetryMiddleware(noSleep);
    const result = await mw(
      { name: "web_fetch", input: { url: "https://x.com/missing" } },
      async () => ({ content: "Error: HTTP 404 Not Found", is_error: true }),
    );
    expect(result.is_error).toBe(true);
    expect(getRetryStats().totalRetries).toBe(0);
  });

  it("calls sleepFn with policy.delayMs before retry", async () => {
    const delays: number[] = [];
    const trackingSleep = async (ms: number) => { delays.push(ms); };
    const mw = createRetryMiddleware(trackingSleep);
    const next = async () => {
      callCount++;
      if (callCount === 1) return { content: "ETIMEDOUT", is_error: true } as ToolResult;
      return { content: "ok" } as ToolResult;
    };
    await mw({ name: "web_fetch", input: { url: "https://slow.com" } }, next);
    expect(delays).toEqual([1500]); // web_fetch policy.delayMs = 1500
  });

  it("does not call sleepFn for policies without delayMs (shell)", async () => {
    const delays: number[] = [];
    const trackingSleep = async (ms: number) => { delays.push(ms); };
    const mw = createRetryMiddleware(trackingSleep);
    const next = async () => {
      callCount++;
      if (callCount === 1) return { content: "timed out", is_error: true } as ToolResult;
      return { content: "ok" } as ToolResult;
    };
    await mw({ name: "shell", input: { command: "npm test" } }, next);
    expect(delays).toEqual([]); // shell has no delayMs
  });

  it("stats accumulate across multiple calls", async () => {
    const mw = createRetryMiddleware(noSleep);
    // Two successful retries
    for (let i = 0; i < 2; i++) {
      let c = 0;
      await mw(
        { name: "web_fetch", input: { url: "https://x.com" } },
        async () => {
          c++;
          if (c === 1) return { content: "ECONNRESET", is_error: true } as ToolResult;
          return { content: "ok" } as ToolResult;
        },
      );
    }
    expect(getRetryStats().totalRetries).toBe(2);
    expect(getRetryStats().successAfterRetry).toBe(2);
    expect(getRetryStats().exhausted).toBe(0);
  });
});
