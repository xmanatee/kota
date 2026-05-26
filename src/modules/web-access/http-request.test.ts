import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHttpRequest } from "./http-request.js";
import { formatTabularJson } from "./http-request-utils.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

describe("runHttpRequest", () => {
  const originalFetch = globalThis.fetch;
  const mockLookup = vi.mocked(lookup);

  beforeEach(() => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockLookup.mockReset();
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

  async function makeProjectTempDir(prefix: string): Promise<string> {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const baseDir = path.join(process.cwd(), ".kota", "test-tmp");
    fs.mkdirSync(baseDir, { recursive: true });
    return fs.mkdtempSync(path.join(baseDir, prefix));
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

  it("rejects loopback targets before fetching", async () => {
    globalThis.fetch = vi.fn();
    const result = await runHttpRequest({
      url: "http://127.0.0.1:8765/api/secrets/OPENAI_API_KEY",
      headers: { Authorization: "Bearer daemon-token" },
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("loopback/private-network");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects private-network targets before fetching", async () => {
    globalThis.fetch = vi.fn();
    const result = await runHttpRequest({ url: "http://10.0.0.5/status" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("loopback/private-network");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects IPv6-mapped loopback targets before fetching", async () => {
    globalThis.fetch = vi.fn();
    const result = await runHttpRequest({ url: "http://[::ffff:127.0.0.1]:8765/status" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("loopback/private-network");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to loopback before fetching", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    globalThis.fetch = vi.fn();
    const result = await runHttpRequest({ url: "http://lvh.me:8765/status" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("loopback/private-network");
    expect(result.content).toContain("127.0.0.1");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects DNS rebinding at the connection-time lookup before fetching", async () => {
    const publicAddress = [{ address: "93.184.216.34", family: 4 }];
    mockLookup
      .mockResolvedValueOnce(publicAddress as never)
      .mockResolvedValueOnce(publicAddress as never)
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    globalThis.fetch = vi.fn();

    const result = await runHttpRequest({ url: "https://rebind.example/status" });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("loopback/private-network");
    expect(result.content).toContain("127.0.0.1");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects redirects to loopback targets before following them", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 302,
      statusText: "Found",
      headers: new Headers({ location: "http://127.0.0.1:8765/status" }),
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    });

    const result = await runHttpRequest({ url: "https://api.example.com/start" });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("loopback/private-network");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
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

  it("rejects outside-project save_to before fetching", async () => {
    globalThis.fetch = vi.fn();
    const result = await runHttpRequest({
      url: "https://api.example.com/export",
      save_to: "/tmp/kota-http-outside.txt",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("project directory");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects dangling save_to symlinks before fetching", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const projectDir = await makeProjectTempDir("kota-http-link-");
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-http-outside-"));
    const outsideTarget = path.join(outsideDir, "response.txt");
    const link = path.join(projectDir, "response.txt");
    fs.symlinkSync(outsideTarget, link);
    globalThis.fetch = vi.fn();

    try {
      const result = await runHttpRequest({
        url: "https://api.example.com/export",
        save_to: link,
      });

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("project directory");
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(fs.existsSync(outsideTarget)).toBe(false);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("saves text response to file", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = await makeProjectTempDir("kota-http-");
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
    const dir = await makeProjectTempDir("kota-http-");
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
    const dir = await makeProjectTempDir("kota-http-");
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
      save_to: "src",
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

  // --- Error paths: numeric parameter edge cases ---

  it("timeout_ms=0 uses default (not immediate abort)", async () => {
    mockFetch({ body: "ok" });
    const result = await runHttpRequest({ url: "https://api.example.com", timeout_ms: 0 });
    // Should succeed — 0 falls back to default 30s, not instant abort
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("HTTP 200 OK");
  });

  it("negative timeout_ms uses default", async () => {
    mockFetch({ body: "ok" });
    const result = await runHttpRequest({ url: "https://api.example.com", timeout_ms: -5000 });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("HTTP 200 OK");
  });

  it("NaN timeout_ms uses default", async () => {
    mockFetch({ body: "ok" });
    const result = await runHttpRequest({ url: "https://api.example.com", timeout_ms: "not-a-number" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("HTTP 200 OK");
  });

  it("Infinity timeout_ms is clamped to 120s max", async () => {
    mockFetch({ body: "ok" });
    const result = await runHttpRequest({ url: "https://api.example.com", timeout_ms: Infinity });
    // Infinity is not finite → falls back to default 30s
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("HTTP 200 OK");
  });

  it("max_response_length=0 uses default (not empty truncation)", async () => {
    mockFetch({ body: "some response body" });
    const result = await runHttpRequest({ url: "https://api.example.com", max_response_length: 0 });
    expect(result.content).toContain("some response body");
    expect(result.content).not.toContain("[Truncated");
  });

  it("negative max_response_length uses default", async () => {
    mockFetch({ body: "some response body" });
    const result = await runHttpRequest({ url: "https://api.example.com", max_response_length: -100 });
    expect(result.content).toContain("some response body");
  });

  it("explicit small max_response_length truncates correctly", async () => {
    const body = "x".repeat(500);
    mockFetch({ body });
    const result = await runHttpRequest({ url: "https://api.example.com", max_response_length: 100 });
    expect(result.content).toContain("[Truncated");
    expect(result.content).toContain("500 chars total");
    expect(result.content).toContain("showing first 100");
  });

  // --- Error paths: abort/timeout detection ---

  it("detects DOMException AbortError as timeout", async () => {
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("request timed out");
    expect(result.content).toContain("30s");
  });

  it("detects Error with name=AbortError as timeout", async () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(err);
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("request timed out");
  });

  it("does NOT misclassify non-abort errors containing 'abort' text", async () => {
    const err = new Error("Transaction aborted by user");
    globalThis.fetch = vi.fn().mockRejectedValue(err);
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.is_error).toBe(true);
    // Should show as a request error, NOT a timeout
    expect(result.content).toContain("Request error:");
    expect(result.content).toContain("Transaction aborted by user");
    expect(result.content).not.toContain("timed out");
  });

  it("timeout message includes custom timeout_ms value", async () => {
    const abortErr = new DOMException("aborted", "AbortError");
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);
    const result = await runHttpRequest({ url: "https://api.example.com", timeout_ms: 5000 });
    expect(result.content).toContain("timed out (5s)");
  });

  // --- Error paths: body read failures ---

  it("handles body read failure with clear error", async () => {
    const responseHeaders = new Map<string, string>([["content-type", "text/plain"]]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      headers: { get: (name: string) => responseHeaders.get(name.toLowerCase()) ?? null },
      text: () => Promise.reject(new Error("network connection lost")),
    });
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("network connection lost");
  });

  it("handles body read abort (timeout during body download)", async () => {
    const responseHeaders = new Map<string, string>([["content-type", "text/plain"]]);
    const abortErr = new DOMException("body download aborted", "AbortError");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      headers: { get: (name: string) => responseHeaders.get(name.toLowerCase()) ?? null },
      text: () => Promise.reject(abortErr),
    });
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("timed out");
  });

  it("handles save_to with body read abort as timeout", async () => {
    const responseHeaders = new Map<string, string>([["content-type", "text/plain"]]);
    const abortErr = new DOMException("aborted", "AbortError");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      headers: { get: (name: string) => responseHeaders.get(name.toLowerCase()) ?? null },
      text: () => Promise.reject(abortErr),
    });
    const result = await runHttpRequest({
      url: "https://api.example.com",
      save_to: "data/kota-test-save.txt",
    });
    expect(result.is_error).toBe(true);
    // Body read abort during save_to should bubble up as timeout
    expect(result.content).toContain("timed out");
  });

  // --- Error paths: non-Error thrown ---

  it("handles non-Error thrown values", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue("raw string error");
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Request error: raw string error");
  });

  it("handles null thrown", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(null);
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Request error:");
  });

  // --- Redirect visibility ---

  it("shows redirect note when response was redirected", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        status: 302,
        statusText: "Found",
        headers: new Headers({ location: "https://api.example.com/v2/users" }),
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve("ok"),
      });
    const result = await runHttpRequest({ url: "https://api.example.com/v1/users" });
    expect(result.content).toContain("[Redirected → https://api.example.com/v2/users]");
    expect(result.content).toContain("HTTP 200 OK");
  });

  it("strips credential headers when a redirect changes origin", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        status: 302,
        statusText: "Found",
        headers: new Headers({ location: "https://uploads.example.net/final" }),
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve("ok"),
      });

    const result = await runHttpRequest({
      url: "https://api.example.com/start",
      headers: {
        Authorization: "Bearer secret-token",
        Cookie: "session=secret",
        "Proxy-Authorization": "Basic secret",
        "X-Custom": "value",
      },
    });

    expect(result.is_error).toBeUndefined();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = fetchMock.mock.calls[1]?.[1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(secondRequest.headers.Authorization).toBeUndefined();
    expect(secondRequest.headers.Cookie).toBeUndefined();
    expect(secondRequest.headers["Proxy-Authorization"]).toBeUndefined();
    expect(secondRequest.headers["X-Custom"]).toBe("value");
    expect(secondRequest.headers["User-Agent"]).toBe("KOTA/0.1");
  });

  it("shows redirect note on HEAD request", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        status: 302,
        statusText: "Found",
        headers: new Headers({ location: "https://example.com/final" }),
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
      });
    const result = await runHttpRequest({ url: "http://example.com/start", method: "HEAD" });
    expect(result.content).toContain("[Redirected → https://example.com/final]");
    expect(result.content).toContain("(HEAD — no body)");
  });

  it("does not show redirect note when not redirected", async () => {
    mockFetch({ body: "ok" });
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.content).not.toContain("[Redirected");
  });

  it("does not show redirect note when url matches (no real redirect)", async () => {
    const responseHeaders = new Map<string, string>([["content-type", "text/plain"]]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      redirected: false,
      url: "https://api.example.com",
      headers: { get: (name: string) => responseHeaders.get(name.toLowerCase()) ?? null },
      text: () => Promise.resolve("ok"),
    });
    const result = await runHttpRequest({ url: "https://api.example.com" });
    expect(result.content).not.toContain("[Redirected");
  });

  // --- API headers: link and x-ratelimit-reset ---

  it("shows link header for pagination", async () => {
    mockFetch({
      body: "[]",
      contentType: "application/json",
      headers: { link: '<https://api.example.com/repos?page=2>; rel="next"' },
    });
    const result = await runHttpRequest({ url: "https://api.example.com/repos" });
    expect(result.content).toContain("link: <https://api.example.com/repos?page=2>");
  });

  it("shows x-ratelimit-reset header", async () => {
    mockFetch({
      body: "[]",
      contentType: "application/json",
      headers: { "x-ratelimit-reset": "1700000000" },
    });
    const result = await runHttpRequest({ url: "https://api.example.com/data" });
    expect(result.content).toContain("x-ratelimit-reset: 1700000000");
  });

  // --- save_to auto-mkdir ---

  it("auto-creates parent directories for save_to", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = await makeProjectTempDir("kota-http-");
    const savePath = path.join(dir, "nested", "deep", "data.json");

    mockFetch({ body: '{"saved":true}', contentType: "application/json" });
    const result = await runHttpRequest({
      url: "https://api.example.com/export",
      save_to: savePath,
    });
    expect(result.content).toContain("[Saved to");
    expect(result.is_error).toBeUndefined();
    expect(fs.existsSync(savePath)).toBe(true);
    expect(fs.readFileSync(savePath, "utf-8")).toBe('{"saved":true}');
    fs.rmSync(dir, { recursive: true });
  });

  it("auto-creates parent directories for binary save_to", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = await makeProjectTempDir("kota-http-");
    const savePath = path.join(dir, "sub", "image.bin");

    const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const responseHeaders = new Map<string, string>([["content-type", "image/png"]]);
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
    expect(fs.existsSync(savePath)).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it("shows redirect note with save_to", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = await makeProjectTempDir("kota-http-");
    const savePath = path.join(dir, "data.txt");

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        status: 302,
        statusText: "Found",
        headers: new Headers({ location: "https://cdn.example.com/data.txt" }),
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve("data"),
      });
    const result = await runHttpRequest({
      url: "https://api.example.com/download",
      save_to: savePath,
    });
    expect(result.content).toContain("[Redirected → https://cdn.example.com/data.txt]");
    expect(result.content).toContain("[Saved to");
    fs.rmSync(dir, { recursive: true });
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
