import { describe, it, expect, vi } from "vitest";
import { RETRY_POLICIES, maybeRetry } from "./tool-retry.js";
import type { ToolResult } from "./tools/index.js";

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

// --- maybeRetry integration ---

describe("maybeRetry", () => {
  const failed: ToolResult = { content: "Command timed out after 120000ms", is_error: true };

  it("returns null for tools with no retry policy", async () => {
    const runner = vi.fn();
    const result = await maybeRetry("file_read", {}, failed, runner);
    expect(result).toBeNull();
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns null when error does not match policy", async () => {
    const runner = vi.fn();
    const nonTimeout: ToolResult = { content: "exit code 1", is_error: true };
    const result = await maybeRetry("shell", { command: "ls" }, nonTimeout, runner);
    expect(result).toBeNull();
    expect(runner).not.toHaveBeenCalled();
  });

  it("retries shell timeout and returns success", async () => {
    const runner = vi.fn().mockResolvedValue({ content: "all tests pass" });
    const result = await maybeRetry("shell", { command: "npm test" }, failed, runner);

    expect(result).not.toBeNull();
    expect(result!.is_error).toBeUndefined();
    expect(result!.content).toContain("all tests pass");
    expect(result!.content).toContain("auto-retry");
    expect(runner).toHaveBeenCalledWith("shell", { command: "npm test", timeout_ms: 240_000 });
  });

  it("returns combined error on double failure", async () => {
    const retryFail: ToolResult = { content: "timed out again at 240s", is_error: true };
    const runner = vi.fn().mockResolvedValue(retryFail);
    const result = await maybeRetry("shell", { command: "npm test" }, failed, runner);

    expect(result).not.toBeNull();
    expect(result!.is_error).toBe(true);
    expect(result!.content).toContain("Auto-retry also failed");
    expect(result!.content).toContain("timed out again");
    expect(result!.content).toContain("Original error");
  });

  it("retries web_fetch with delay", async () => {
    vi.useFakeTimers();
    const runner = vi.fn().mockResolvedValue({ content: "<html>page</html>" });
    const webFail: ToolResult = { content: "Fetch error: ECONNRESET", is_error: true };

    const promise = maybeRetry("web_fetch", { url: "https://example.com" }, webFail, runner);
    // Advance past the 1500ms delay
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(result).not.toBeNull();
    expect(result!.content).toContain("<html>page</html>");
    expect(runner).toHaveBeenCalledWith("web_fetch", { url: "https://example.com" });
    vi.useRealTimers();
  });

  it("does not adjust input for web tools (no adjustInput)", async () => {
    const runner = vi.fn().mockResolvedValue({ content: "results" });
    const webFail: ToolResult = { content: "HTTP 502 Bad Gateway", is_error: true };

    // Use real timers for simplicity — the 1.5s delay runs but test is fine
    vi.useFakeTimers();
    const promise = maybeRetry("web_search", { query: "test" }, webFail, runner);
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(runner).toHaveBeenCalledWith("web_search", { query: "test" });
    expect(result!.content).toContain("results");
    vi.useRealTimers();
  });
});
