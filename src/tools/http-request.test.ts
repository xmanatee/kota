import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runHttpRequest } from "./http-request.js";

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
    expect(result.content).toContain("curl");
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
});
