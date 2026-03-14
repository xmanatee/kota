import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeToolCalls } from "./tool-runner.js";
import { executeTool } from "./tools/index.js";

// Mock only the leaf tool executor — let real maybeRetry and truncateToolResult run
vi.mock("./tools/index.js", () => ({
  executeTool: vi.fn(),
}));

const mockExec = vi.mocked(executeTool);

const block = (name: string, input: Record<string, unknown> = {}) => ({
  type: "tool_use" as const,
  id: `call_${name}`,
  name,
  input,
});

describe("executeToolCalls × tool-retry integration", () => {
  beforeEach(() => {
    mockExec.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries shell timeout with doubled timeout_ms", async () => {
    mockExec
      .mockResolvedValueOnce({ content: "Command timed out after 120s", is_error: true })
      .mockResolvedValueOnce({ content: "build OK" });

    const results = await executeToolCalls(
      [block("shell", { command: "make", timeout_ms: 120_000 })],
      50_000,
      false,
    );

    expect(results[0].is_error).toBeUndefined();
    expect(results[0].content).toContain("build OK");
    expect(results[0].content).toContain("auto-retry");
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec.mock.calls[1][1]).toMatchObject({ timeout_ms: 240_000 });
  });

  it("skips retry when doubled timeout exceeds 5-minute max", async () => {
    mockExec.mockResolvedValueOnce({
      content: "Command timed out",
      is_error: true,
    });

    const results = await executeToolCalls(
      [block("shell", { command: "slow", timeout_ms: 200_000 })],
      50_000,
      false,
    );

    expect(results[0].is_error).toBe(true);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("does not retry tools without a retry policy", async () => {
    mockExec.mockResolvedValueOnce({
      content: "File not found: missing.ts",
      is_error: true,
    });

    const results = await executeToolCalls(
      [block("file_read", { path: "missing.ts" })],
      50_000,
      false,
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("File not found");
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("retries web_fetch on transient network error", async () => {
    vi.useFakeTimers();
    mockExec
      .mockResolvedValueOnce({ content: "fetch failed: ECONNRESET", is_error: true })
      .mockResolvedValueOnce({ content: "<html>page</html>" });

    const promise = executeToolCalls(
      [block("web_fetch", { url: "https://example.com" })],
      50_000,
      false,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(results[0].is_error).toBeUndefined();
    expect(results[0].content).toContain("page");
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("combines errors when retry also fails", async () => {
    vi.useFakeTimers();
    mockExec
      .mockResolvedValueOnce({ content: "HTTP 502 Bad Gateway", is_error: true })
      .mockResolvedValueOnce({ content: "HTTP 503 Service Unavailable", is_error: true });

    const promise = executeToolCalls(
      [block("http_request", { url: "https://down.com", method: "GET" })],
      50_000,
      false,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("503");
    expect(results[0].content).toContain("Original error");
    expect(results[0].content).toContain("502");
  });

  it("skips truncation for results with rich blocks", async () => {
    const richBlocks = [
      { type: "image" as const, source: { type: "base64" as const, data: "abc", media_type: "image/png" as const } },
    ];
    mockExec.mockResolvedValueOnce({ content: "Image loaded", blocks: richBlocks });

    const results = await executeToolCalls(
      [block("file_read", { path: "photo.png" })],
      10, // tiny limit — should NOT truncate because blocks are present
      false,
    );

    expect(results[0].blocks).toBe(richBlocks);
    expect(results[0].content).toBe("Image loaded");
  });
});
