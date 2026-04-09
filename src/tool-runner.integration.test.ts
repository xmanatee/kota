/**
 * Cross-module integration tests: tool-runner × tool-retry middleware
 *
 * These tests use the REAL retry middleware (not mocked) with a mocked executeTool.
 * They verify that retry policies fire correctly through executeToolCalls —
 * the actual integration boundary between these two modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRetryMiddleware, resetRetryStats } from "./modules/tool-retry/tool-retry.js";
import { getToolMiddleware, resetToolMiddleware } from "./tool-middleware.js";
import { executeToolCalls } from "./tool-runner.js";

// Mock executeTool and truncateToolResult, but NOT tool-retry
vi.mock("./tools/index.js", () => ({
  executeTool: vi.fn(),
}));
vi.mock("./context.js", () => ({
  truncateToolResult: vi.fn((text: string) => text),
}));

import { executeTool } from "./tools/index.js";

const mockExecuteTool = vi.mocked(executeTool);

function toolBlock(
  name: string,
  input: Record<string, unknown> = {},
  id = "t1",
) {
  return { type: "tool_use" as const, id, name, input };
}

describe("tool-runner × tool-retry middleware integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Register retry middleware (normally done by module loader)
    resetToolMiddleware();
    resetRetryStats();
    getToolMiddleware().add("tool-retry", createRetryMiddleware(), { priority: 20 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetToolMiddleware();
    resetRetryStats();
  });

  it("retries shell timeout with doubled timeout_ms", async () => {
    let callCount = 0;
    mockExecuteTool.mockImplementation(async (_name, input) => {
      callCount++;
      if (callCount === 1) {
        return { content: "Error: command timed out after 120s", is_error: true };
      }
      return { content: `done with timeout=${(input as Record<string, unknown>).timeout_ms}` };
    });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "npm test", timeout_ms: 120_000 })],
      50_000,
      false,
    );

    expect(callCount).toBe(2);
    expect(results[0].content).toContain("done with timeout=240000");
    expect(results[0].content).toContain("auto-retry");
    expect(results[0].is_error).toBeUndefined();
  });

  it("does not retry shell when doubled timeout exceeds max (300s)", async () => {
    mockExecuteTool.mockResolvedValue({
      content: "command timed out",
      is_error: true,
    });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "slow", timeout_ms: 200_000 })],
      50_000,
      false,
    );

    // 200000 * 2 = 400000 > 300000 max → no retry
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(results[0].is_error).toBe(true);
  });

  it("retries web_fetch on ECONNRESET and succeeds", async () => {
    let callCount = 0;
    mockExecuteTool.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { content: "Error: ECONNRESET", is_error: true };
      }
      return { content: "fetched content" };
    });

    const results = await executeToolCalls(
      [toolBlock("web_fetch", { url: "https://example.com" })],
      50_000,
      false,
    );

    expect(callCount).toBe(2);
    expect(results[0].content).toContain("fetched content");
    expect(results[0].content).toContain("auto-retry");
    expect(results[0].is_error).toBeUndefined();
  }, 10_000);

  it("returns combined error when web_search retry also fails", async () => {
    mockExecuteTool.mockResolvedValue({
      content: "HTTP 502 Bad Gateway",
      is_error: true,
    });

    const results = await executeToolCalls(
      [toolBlock("web_search", { query: "test" })],
      50_000,
      false,
    );

    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    expect(results[0].content).toContain("Auto-retry also failed");
    expect(results[0].content).toContain("HTTP 502");
    expect(results[0].is_error).toBe(true);
  }, 10_000);

  it("does not retry tools without a retry policy (file_read)", async () => {
    mockExecuteTool.mockResolvedValue({
      content: "Error: file not found",
      is_error: true,
    });

    const results = await executeToolCalls(
      [toolBlock("file_read", { path: "/nope" })],
      50_000,
      false,
    );

    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(results[0].content).toBe("Error: file not found");
    expect(results[0].is_error).toBe(true);
  });

  it("retries http_request on transient HTTP 503", async () => {
    let callCount = 0;
    mockExecuteTool.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { content: "HTTP 503 Service Unavailable", is_error: true };
      }
      return { content: '{"status":"ok"}' };
    });

    const results = await executeToolCalls(
      [toolBlock("http_request", { url: "https://api.example.com" })],
      50_000,
      false,
    );

    expect(callCount).toBe(2);
    expect(results[0].content).toContain('{"status":"ok"}');
    expect(results[0].is_error).toBeUndefined();
  }, 10_000);

  it("does not retry shell on non-timeout errors", async () => {
    mockExecuteTool.mockResolvedValue({
      content: "Error: command not found: foobar",
      is_error: true,
    });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "foobar" })],
      50_000,
      false,
    );

    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(results[0].is_error).toBe(true);
  });

  it("does not retry web_fetch on non-transient errors (404)", async () => {
    mockExecuteTool.mockResolvedValue({
      content: "Error: HTTP 404 Not Found",
      is_error: true,
    });

    const results = await executeToolCalls(
      [toolBlock("web_fetch", { url: "https://example.com/missing" })],
      50_000,
      false,
    );

    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(results[0].is_error).toBe(true);
  });
});
