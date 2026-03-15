import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runHttpRequest, formatTabularJson } from "./http-request.js";

describe("runHttpRequest", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(opts: {
    status?: number;
    statusText?: string;
    body?: string;
    contentType?: string;
    headers?: Record<string, string>;
  }) {
    const { status = 200, statusText = "OK", body = "", contentType = "text/plain", headers = {} } = opts;
    const responseHeaders = new Map<string, string>([
      ["content-type", contentType],
      ...Object.entries(headers),
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 400,
      status,
      statusText,
      headers: {
        get: (name: string) => responseHeaders.get(name.toLowerCase()) ?? null,
      },
      text: () => Promise.resolve(body),
    });
  }

  // --- Input validation ---

  it("rejects missing url", async () => {
    const result = await runHttpRequest({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("url is required");
  });

  it("rejects non-http url", async () => {
    const result = await runHttpRequest({ url: "ftp://example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("http://");
  });

  it("rejects unsupported method", async () => {
    const result = await runHttpRequest({ url: "https://api.example.com", method: "TRACE" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("unsupported method");
  });

  it("rejects body on GET", async () => {
    const result = await runHttpRequest({ url: "https://api.example.com", method: "GET", body: '{"x":1}' });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("cannot have a body");
  });

  it("rejects body on HEAD", async () => {
    const result = await runHttpRequest({ url: "https://api.example.com", method: "HEAD", body: "test" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("cannot have a body");
  });

  // --- Successful requests ---

  it("makes a simple GET request", async () => {
    mockFetch({ body: "Hello, World!" });
    const result = await runHttpRequest({ url: "https://api.example.com/data" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("HTTP 200 OK");
    expect(result.content).toContain("Hello, World!");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("defaults to GET when no method specified", async () => {
    mockFetch({ body: "ok" });
    await runHttpRequest({ url: "https://api.example.com" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("makes a POST request with body", async () => {
    mockFetch({ status: 201, statusText: "Created", body: '{"id": 42}', contentType: "application/json" });
    const result = await runHttpRequest({
      url: "https://api.example.com/items",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"name": "test"}',
    });
    expect(result.content).toContain("HTTP 201 Created");
    expect(result.content).toContain('"id": 42');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/items",
      expect.objectContaining({
        method: "POST",
        body: '{"name": "test"}',
      }),
    );
  });

  it("makes a DELETE request", async () => {
    mockFetch({ status: 204, statusText: "No Content", body: "" });
    const result = await runHttpRequest({ url: "https://api.example.com/items/42", method: "DELETE" });
    expect(result.content).toContain("HTTP 204 No Content");
  });

  it("handles HEAD requests (no body read)", async () => {
    mockFetch({
      body: "should not appear",
      headers: { "content-length": "1234" },
    });
    const result = await runHttpRequest({ url: "https://api.example.com", method: "HEAD" });
    expect(result.content).toContain("HTTP 200 OK");
    expect(result.content).toContain("(HEAD — no body)");
    expect(result.content).not.toContain("should not appear");
  });

  it("includes custom headers in request", async () => {
    mockFetch({ body: "ok" });
    await runHttpRequest({
      url: "https://api.example.com",
      headers: { Authorization: "Bearer secret-token", "X-Custom": "value" },
    });
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(callArgs.headers.Authorization).toBe("Bearer secret-token");
    expect(callArgs.headers["X-Custom"]).toBe("value");
    expect(callArgs.headers["User-Agent"]).toBe("KOTA/0.1");
  });

  // --- Response formatting ---

  it("pretty-prints JSON responses", async () => {
    mockFetch({
      body: '{"key":"value","nested":{"a":1}}',
      contentType: "application/json",
    });
    const result = await runHttpRequest({ url: "https://api.example.com/data" });
    expect(result.content).toContain('"key": "value"');
    expect(result.content).toContain('"nested": {');
  });

  it("auto-detects JSON even without json content-type", async () => {
    mockFetch({
      body: '{"auto":"detected"}',
      contentType: "text/plain",
    });
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.content).toContain('"auto": "detected"');
  });

  it("includes selected response headers", async () => {
    mockFetch({
      body: "ok",
      contentType: "application/json",
      headers: { "x-request-id": "abc-123" },
    });
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.content).toContain("content-type: application/json");
    expect(result.content).toContain("x-request-id: abc-123");
  });

  it("marks 4xx/5xx responses as errors", async () => {
    mockFetch({ status: 404, statusText: "Not Found", body: '{"error":"not found"}', contentType: "application/json" });
    const result = await runHttpRequest({ url: "https://api.example.com/missing" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("HTTP 404 Not Found");
  });

  it("marks 500 responses as errors", async () => {
    mockFetch({ status: 500, statusText: "Internal Server Error", body: "oops" });
    const result = await runHttpRequest({ url: "https://api.example.com/broken" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("HTTP 500");
  });

  // --- Truncation ---

  it("truncates large responses", async () => {
    const bigBody = "x".repeat(25000);
    mockFetch({ body: bigBody });
    const result = await runHttpRequest({ url: "https://api.example.com", max_response_length: 20000 });
    expect(result.content).toContain("[Truncated");
    expect(result.content).toContain("25000 chars total");
  });

  // --- Binary handling ---

  it("rejects binary responses with a helpful message", async () => {
    mockFetch({
      contentType: "image/png",
      body: "binary data",
      headers: { "content-length": "52428" },
    });
    const result = await runHttpRequest({ url: "https://api.example.com/image.png" });
    expect(result.content).toContain("[Binary response: image/png");
    expect(result.content).toContain("51.2KB");
    expect(result.content).toContain("save_to");
  });

  // --- Error handling ---

  it("handles network errors", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("ECONNREFUSED");
  });

  it("normalizes method to uppercase", async () => {
    mockFetch({ body: "ok" });
    await runHttpRequest({ url: "https://api.example.com", method: "post", body: "data" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("allows PATCH requests with body", async () => {
    mockFetch({ status: 200, statusText: "OK", body: '{"updated":true}', contentType: "application/json" });
    const result = await runHttpRequest({
      url: "https://api.example.com/items/1",
      method: "PATCH",
      body: '{"name":"updated"}',
    });
    expect(result.content).toContain("HTTP 200 OK");
    expect(result.content).toContain('"updated": true');
  });

  it("allows OPTIONS requests", async () => {
    mockFetch({
      status: 204, statusText: "No Content", body: "",
      headers: { allow: "GET, POST, OPTIONS" },
    });
    const result = await runHttpRequest({ url: "https://api.example.com", method: "OPTIONS" });
    expect(result.content).toContain("allow: GET, POST, OPTIONS");
  });

  // --- save_to ---

  it("saves text response to file", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-http-"));
    const savePath = path.join(dir, "data.json");

    mockFetch({ body: '{"records":[1,2,3]}', contentType: "application/json" });
    const result = await runHttpRequest({
      url: "https://api.example.com/export",
      save_to: savePath,
    });
    expect(result.content).toContain("HTTP 200 OK");
    expect(result.content).toContain("[Saved to");
    expect(result.content).not.toContain('"records"');
    expect(fs.readFileSync(savePath, "utf-8")).toBe('{"records":[1,2,3]}');
    fs.rmSync(dir, { recursive: true });
  });

  it("saves binary response to file instead of rejecting", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-http-"));
    const savePath = path.join(dir, "image.bin");

    const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const responseHeaders = new Map<string, string>([
      ["content-type", "image/png"],
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      headers: { get: (name: string) => responseHeaders.get(name.toLowerCase()) ?? null },
      arrayBuffer: () => Promise.resolve(binaryData.buffer),
    });
    const result = await runHttpRequest({
      url: "https://api.example.com/image.png",
      save_to: savePath,
    });
    expect(result.content).toContain("[Saved to");
    expect(result.content).not.toContain("curl");
    expect(fs.readFileSync(savePath)[0]).toBe(0x89);
    fs.rmSync(dir, { recursive: true });
  });

  it("marks saved 4xx response as error", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-http-"));
    const savePath = path.join(dir, "error.txt");

    mockFetch({ status: 404, statusText: "Not Found", body: "not found" });
    const result = await runHttpRequest({
      url: "https://api.example.com/missing",
      save_to: savePath,
    });
    expect(result.content).toContain("[Saved to");
    expect(result.is_error).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it("returns error when save_to write fails", async () => {
    mockFetch({ body: "data" });
    const result = await runHttpRequest({
      url: "https://api.example.com/data",
      save_to: "/nonexistent_kota_test_path/file.txt",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Error saving response");
  });

  // --- Binary message suggests save_to ---

  it("binary response suggests save_to instead of curl", async () => {
    mockFetch({
      contentType: "image/png",
      body: "binary data",
      headers: { "content-length": "52428" },
    });
    const result = await runHttpRequest({ url: "https://api.example.com/image.png" });
    expect(result.content).toContain("save_to");
    expect(result.content).not.toContain("curl");
  });

  // --- Truncation message suggests save_to ---

  it("truncation notice suggests save_to", async () => {
    const bigBody = "x".repeat(25000);
    mockFetch({ body: bigBody });
    const result = await runHttpRequest({ url: "https://api.example.com", max_response_length: 20000 });
    expect(result.content).toContain("save_to");
    expect(result.content).toContain("[Truncated");
  });

  // --- Tabular JSON formatting ---

  it("formats array-of-objects JSON as table", async () => {
    const data = [
      { name: "Alice", score: 95 },
      { name: "Bob", score: 87 },
    ];
    mockFetch({ body: JSON.stringify(data), contentType: "application/json" });
    const result = await runHttpRequest({ url: "https://api.example.com/scores" });
    expect(result.content).toContain("| name");
    expect(result.content).toContain("| Alice");
    expect(result.content).toContain("| Bob");
    // Should not contain raw JSON braces
    expect(result.content).not.toContain("{");
  });

  it("falls back to pretty JSON for non-tabular arrays", async () => {
    const data = [1, 2, 3];
    mockFetch({ body: JSON.stringify(data), contentType: "application/json" });
    const result = await runHttpRequest({ url: "https://api.example.com/nums" });
    // Primitive array → standard JSON
    expect(result.content).toContain("1");
    expect(result.content).not.toContain("| ");
  });
});

describe("formatTabularJson", () => {
  it("formats simple array of objects", () => {
    const result = formatTabularJson([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    expect(result).toContain("| id");
    expect(result).toContain("| name");
    expect(result).toContain("| 1");
    expect(result).toContain("| Alice");
  });

  it("returns null for empty array", () => {
    expect(formatTabularJson([])).toBeNull();
  });

  it("returns null for non-array", () => {
    expect(formatTabularJson({ key: "value" })).toBeNull();
  });

  it("returns null for arrays with nested objects", () => {
    expect(formatTabularJson([{ a: { nested: true } }])).toBeNull();
  });

  it("handles missing keys across rows", () => {
    const result = formatTabularJson([
      { a: 1, b: 2 },
      { a: 3, c: 4 },
    ]);
    expect(result).toContain("| a");
    expect(result).toContain("| b");
    expect(result).toContain("| c");
    // Missing values show empty
    expect(result).toBeTruthy();
  });

  it("truncates rows beyond limit", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: i }));
    const result = formatTabularJson(rows);
    expect(result).toContain("showing 50 of 60 rows");
  });

  it("escapes pipe characters in values", () => {
    const result = formatTabularJson([
      { cmd: "a | b", status: "ok" },
      { cmd: "x|y|z", status: "fail" },
    ]);
    expect(result).not.toBeNull();
    // Pipes in values should be escaped so table structure is preserved
    expect(result).toContain("a \\| b");
    expect(result).toContain("x\\|y\\|z");
    // Table structure pipes should still be unescaped
    const lines = result!.split("\n");
    // Header + separator + 2 data rows = 4 lines
    expect(lines.length).toBe(4);
  });

  it("replaces newlines in values with spaces", () => {
    const result = formatTabularJson([
      { id: 1, note: "line1\nline2" },
    ]);
    expect(result).not.toBeNull();
    expect(result).toContain("line1 line2");
    expect(result).not.toContain("\n" + "line2");
  });

  it("truncates columns beyond limit", () => {
    const row: Record<string, number> = {};
    for (let i = 0; i < 15; i++) row[`col${i}`] = i;
    const result = formatTabularJson([row]);
    expect(result).toContain("showing 10 of 15 columns");
    expect(result).toContain("col0");
    expect(result).toContain("col9");
    expect(result).not.toContain("col10");
  });

  it("handles exactly 50 rows without truncation note", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const result = formatTabularJson(rows);
    expect(result).not.toBeNull();
    expect(result).not.toContain("showing");
    // All 50 rows + header + separator = 52 lines
    expect(result!.split("\n").length).toBe(52);
  });

  it("returns null for array of empty objects", () => {
    expect(formatTabularJson([{}, {}])).toBeNull();
  });

  it("handles boolean and null values", () => {
    const result = formatTabularJson([
      { flag: true, value: null, name: "test" },
      { flag: false, value: 42, name: "ok" },
    ]);
    expect(result).not.toBeNull();
    expect(result).toContain("true");
    expect(result).toContain("false");
    expect(result).toContain("42");
  });

  it("returns null when array has mixed objects and primitives", () => {
    expect(formatTabularJson([{ a: 1 }, "string" as any])).toBeNull();
  });
});
