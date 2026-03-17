import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToolMiddleware, resetToolMiddleware } from "./tool-middleware.js";
import { createRetryMiddleware, resetRetryStats } from "./tool-retry.js";
import { executeToolCalls } from "./tool-runner.js";
import { executeTool } from "./tools/index.js";

// Mock only the leaf tool executor — let real retry middleware and truncateToolResult run
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

describe("executeToolCalls × tool-retry middleware integration", () => {
  beforeEach(() => {
    mockExec.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Register retry middleware (normally done by module loader)
    resetToolMiddleware();
    resetRetryStats();
    getToolMiddleware().add("tool-retry", createRetryMiddleware(), { priority: 20 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetToolMiddleware();
    resetRetryStats();
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

  it("preserves image-only blocks without truncation", async () => {
    const richBlocks = [
      { type: "image" as const, source: { type: "base64" as const, data: "abc", media_type: "image/png" as const } },
    ];
    mockExec.mockResolvedValueOnce({ content: "Image loaded", blocks: richBlocks });

    const results = await executeToolCalls(
      [block("file_read", { path: "photo.png" })],
      10, // tiny limit — image blocks have no text to truncate
      false,
    );

    expect(results[0].blocks![0]).toEqual(richBlocks[0]);
    // Content is truncated (limit=10), but image block preserved untouched
    expect(results[0].content).toContain("Image");
  });

  it("truncates text blocks in rich results (code_exec + plots path)", async () => {
    // Simulates code_exec returning large text output + matplotlib plot
    const largeText = "x".repeat(10_000);
    const richBlocks = [
      { type: "text" as const, text: largeText },
      { type: "image" as const, source: { type: "base64" as const, data: "plotdata", media_type: "image/png" as const } },
    ];
    mockExec.mockResolvedValueOnce({ content: largeText, blocks: richBlocks });

    const results = await executeToolCalls(
      [block("code_exec", { code: "import matplotlib" })],
      500, // tight context budget limit
      false,
    );

    // Text block should be truncated
    expect(results[0].blocks![0].type).toBe("text");
    const textBlock = results[0].blocks![0] as { type: "text"; text: string };
    expect(textBlock.text.length).toBeLessThan(largeText.length);
    expect(textBlock.text).toContain("chars omitted");

    // Image block should be preserved untouched
    expect(results[0].blocks![1]).toEqual(richBlocks[1]);

    // Content field also truncated
    expect(results[0].content.length).toBeLessThan(largeText.length);
  });

  it("does not truncate small text blocks in rich results", async () => {
    const smallText = "Result: 42";
    const richBlocks = [
      { type: "text" as const, text: smallText },
      { type: "image" as const, source: { type: "base64" as const, data: "img", media_type: "image/png" as const } },
    ];
    mockExec.mockResolvedValueOnce({ content: smallText, blocks: richBlocks });

    const results = await executeToolCalls(
      [block("code_exec", { code: "2+2" })],
      50_000, // generous limit
      false,
    );

    // Small text block passes through unchanged
    const textBlock = results[0].blocks![0] as { type: "text"; text: string };
    expect(textBlock.text).toBe(smallText);
    expect(results[0].content).toBe(smallText);
  });

  it("handles mixed parallel results: rich blocks + plain text", async () => {
    const largeText = "y".repeat(8_000);
    const richBlocks = [
      { type: "text" as const, text: largeText },
      { type: "image" as const, source: { type: "base64" as const, data: "chart", media_type: "image/png" as const } },
    ];
    mockExec
      .mockResolvedValueOnce({ content: largeText, blocks: richBlocks }) // code_exec with plot
      .mockResolvedValueOnce({ content: "z".repeat(8_000) }); // plain file_read

    const results = await executeToolCalls(
      [
        block("code_exec", { code: "plot()" }),
        block("file_read", { path: "data.csv" }),
      ],
      500,
      false,
    );

    // Both results should be truncated
    const codeResult = results[0];
    const fileResult = results[1];

    const codeTextBlock = codeResult.blocks![0] as { type: "text"; text: string };
    expect(codeTextBlock.text.length).toBeLessThan(8_000);
    expect(codeTextBlock.text).toContain("chars omitted");

    expect(fileResult.content.length).toBeLessThan(8_000);
    expect(fileResult.content).toContain("chars omitted");
    expect(fileResult.blocks).toBeUndefined();
  });

  it("truncates content field for rich results (FailureTracker consistency)", async () => {
    // When is_error is true with blocks, content is used by FailureTracker for signature
    const largeError = `Traceback: ${"e".repeat(5_000)}`;
    const richBlocks = [
      { type: "text" as const, text: largeError },
    ];
    mockExec.mockResolvedValueOnce({ content: largeError, blocks: richBlocks, is_error: true });

    const results = await executeToolCalls(
      [block("code_exec", { code: "crash()" })],
      500,
      false,
    );

    // Content field truncated so FailureTracker signatures are bounded
    expect(results[0].content.length).toBeLessThan(largeError.length);
    expect(results[0].is_error).toBe(true);
  });
});
