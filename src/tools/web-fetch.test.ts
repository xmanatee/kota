import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatJsonResponse, isBinaryContentType, runWebFetch } from "./web-fetch.js";

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// --- Unit tests for helpers ---

describe("isBinaryContentType", () => {
  it("detects image types as binary", () => {
    expect(isBinaryContentType("image/png")).toBe(true);
    expect(isBinaryContentType("image/jpeg")).toBe(true);
    expect(isBinaryContentType("image/gif")).toBe(true);
    expect(isBinaryContentType("image/webp")).toBe(true);
  });

  it("treats SVG as text (not binary)", () => {
    expect(isBinaryContentType("image/svg+xml")).toBe(false);
    expect(isBinaryContentType("image/svg+xml; charset=utf-8")).toBe(false);
  });

  it("detects audio/video/font as binary", () => {
    expect(isBinaryContentType("audio/mpeg")).toBe(true);
    expect(isBinaryContentType("video/mp4")).toBe(true);
    expect(isBinaryContentType("font/woff2")).toBe(true);
  });

  it("detects binary application subtypes", () => {
    expect(isBinaryContentType("application/pdf")).toBe(true);
    expect(isBinaryContentType("application/zip")).toBe(true);
    expect(isBinaryContentType("application/gzip")).toBe(true);
    expect(isBinaryContentType("application/octet-stream")).toBe(true);
    expect(isBinaryContentType("application/wasm")).toBe(true);
  });

  it("returns false for text-based types", () => {
    expect(isBinaryContentType("text/html")).toBe(false);
    expect(isBinaryContentType("text/plain")).toBe(false);
    expect(isBinaryContentType("application/json")).toBe(false);
    expect(isBinaryContentType("application/xml")).toBe(false);
    expect(isBinaryContentType("text/css")).toBe(false);
  });

  it("handles content-type with charset parameter", () => {
    expect(isBinaryContentType("application/pdf; charset=binary")).toBe(true);
    expect(isBinaryContentType("text/html; charset=utf-8")).toBe(false);
  });
});

describe("formatJsonResponse", () => {
  it("formats JSON object with key count hint", () => {
    const json = JSON.stringify({ name: "Alice", age: 30 });
    const result = formatJsonResponse(json, 10000);
    expect(result).toContain("[JSON object — 2 keys: name, age]");
    expect(result).toContain('"name": "Alice"');
  });

  it("formats JSON array with length hint", () => {
    const json = JSON.stringify([1, 2, 3]);
    const result = formatJsonResponse(json, 10000);
    expect(result).toContain("[JSON array — 3 items]");
  });

  it("truncates keys list for large objects", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 15; i++) obj[`key${i}`] = i;
    const result = formatJsonResponse(JSON.stringify(obj), 10000);
    expect(result).toContain("15 keys:");
    expect(result).toContain(", ...");
  });

  it("handles primitive JSON values without hint", () => {
    expect(formatJsonResponse('"hello"', 10000)).toBe('"hello"');
    expect(formatJsonResponse("42", 10000)).toBe("42");
    expect(formatJsonResponse("true", 10000)).toBe("true");
    expect(formatJsonResponse("null", 10000)).toBe("null");
  });

  it("truncates long JSON output", () => {
    const big = JSON.stringify({ data: "x".repeat(500) });
    const result = formatJsonResponse(big, 100);
    expect(result).toContain("[Truncated");
    expect(result.length).toBeLessThan(200); // truncated + notice
  });

  it("returns raw text when JSON parse fails", () => {
    const result = formatJsonResponse("not valid json {", 10000);
    expect(result).toBe("not valid json {");
  });

  it("truncates raw text when JSON parse fails and text is long", () => {
    const long = "x".repeat(500);
    const result = formatJsonResponse(long, 100);
    expect(result).toContain("[Truncated");
  });
});

// --- Integration tests for runWebFetch ---

describe("runWebFetch", () => {
  const originalFetch = global.fetch;

  function mockResponse(
    body: string,
    opts: { status?: number; headers?: Record<string, string>; statusText?: string } = {},
  ) {
    const { status = 200, headers = {}, statusText = "OK" } = opts;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: new Headers(headers),
      text: () => Promise.resolve(body),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
      body: { cancel: () => Promise.resolve() },
    };
  }

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns error for missing URL", async () => {
    const result = await runWebFetch({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("url is required");
  });

  it("returns error for invalid protocol", async () => {
    const result = await runWebFetch({ url: "ftp://example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("http://");
  });

  it("returns error for HTTP error status", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse("", { status: 404, statusText: "Not Found" }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/missing" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("404");
  });

  it("handles JSON content type with pretty-printing", async () => {
    const json = JSON.stringify({ users: [{ id: 1 }], total: 1 });
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(json, { headers: { "content-type": "application/json; charset=utf-8" } }) as never,
    );
    const result = await runWebFetch({ url: "https://api.example.com/users" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("[JSON object — 2 keys: users, total]");
    expect(result.content).toContain('"id": 1');
  });

  it("handles binary content type without reading body", async () => {
    const cancelFn = vi.fn().mockResolvedValue(undefined);
    const resp = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "application/pdf",
        "content-length": "1048576",
      }),
      text: vi.fn(),
      body: { cancel: cancelFn },
    };
    vi.mocked(global.fetch).mockResolvedValue(resp as never);
    const result = await runWebFetch({ url: "https://example.com/doc.pdf" });
    expect(result.content).toContain("Binary content: application/pdf");
    expect(result.content).toContain("1.0 MB");
    expect(result.content).toContain("save_to");
    expect(resp.text).not.toHaveBeenCalled();
    expect(cancelFn).toHaveBeenCalled();
  });

  it("handles plain text content", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse("Hello world", { headers: { "content-type": "text/plain" } }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/file.txt" });
    expect(result.content).toBe("Hello world");
  });

  it("truncates long text responses", async () => {
    const long = "x".repeat(25000);
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(long, { headers: { "content-type": "text/plain" } }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/big.txt", max_length: 1000 });
    expect(result.content).toContain("[Truncated");
    expect(result.content).toContain("25000 chars total");
  });

  it("handles fetch errors gracefully", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await runWebFetch({ url: "https://example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("ECONNREFUSED");
  });

  it("handles timeout (AbortError via DOMException)", async () => {
    vi.mocked(global.fetch).mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );
    const result = await runWebFetch({ url: "https://example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("timed out");
  });

  it("does not misidentify generic errors mentioning 'abort'", async () => {
    vi.mocked(global.fetch).mockRejectedValue(
      new Error("Connection aborted by remote host"),
    );
    const result = await runWebFetch({ url: "https://example.com" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Fetch error:");
    expect(result.content).toContain("Connection aborted by remote host");
  });

  it("returns (empty response) for empty body", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse("", { headers: { "content-type": "text/plain" } }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/empty" });
    expect(result.content).toBe("(empty response)");
  });

  it("saves text content to file with save_to", async () => {
    const { writeFile: wf, mkdir: mk } = await import("node:fs/promises");
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse("Hello world content here", {
        headers: { "content-type": "text/plain" },
      }) as never,
    );
    const result = await runWebFetch({
      url: "https://example.com/data.txt",
      save_to: "/tmp/test-data.txt",
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Saved to");
    expect(result.content).toContain("text/plain");
    expect(result.content).toContain("Preview:");
    expect(result.content).toContain("Hello world content here");
    expect(mk).toHaveBeenCalledWith("/tmp", { recursive: true });
    expect(wf).toHaveBeenCalledWith("/tmp/test-data.txt", "Hello world content here", "utf-8");
  });

  it("saves binary content to file with save_to", async () => {
    const { writeFile: wf } = await import("node:fs/promises");
    const resp = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "application/pdf",
      }),
      text: vi.fn(),
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      body: { cancel: () => Promise.resolve() },
    };
    vi.mocked(global.fetch).mockResolvedValue(resp as never);
    const result = await runWebFetch({
      url: "https://example.com/doc.pdf",
      save_to: "/tmp/doc.pdf",
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Downloaded application/pdf");
    expect(result.content).toContain("3 B");
    expect(wf).toHaveBeenCalled();
    expect(resp.text).not.toHaveBeenCalled();
  });

  it("truncates preview for large text in save_to mode", async () => {
    const longText = "x".repeat(1000);
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(longText, {
        headers: { "content-type": "text/csv" },
      }) as never,
    );
    const result = await runWebFetch({
      url: "https://example.com/data.csv",
      save_to: "/tmp/data.csv",
    });
    expect(result.content).toContain("Preview:");
    expect(result.content).toContain("...");
  });

  it("returns error when save_to write fails", async () => {
    const { writeFile: wf } = await import("node:fs/promises");
    vi.mocked(wf).mockRejectedValueOnce(new Error("EACCES: permission denied"));
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse("data", {
        headers: { "content-type": "text/plain" },
      }) as never,
    );
    const result = await runWebFetch({
      url: "https://example.com/file.txt",
      save_to: "/readonly/file.txt",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("EACCES");
  });

  it("updates binary message to mention save_to", async () => {
    const resp = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "image/png" }),
      text: vi.fn(),
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    };
    vi.mocked(global.fetch).mockResolvedValue(resp as never);
    const result = await runWebFetch({ url: "https://example.com/img.png" });
    expect(result.content).toContain("save_to");
  });
});

// --- Cross-module: web_fetch → html-extract (extractContent) ---

describe("runWebFetch — HTML extraction (cross-module: web-fetch → html-extract)", () => {
  const originalFetch = global.fetch;

  function mockResponse(
    body: string,
    opts: { status?: number; headers?: Record<string, string>; statusText?: string } = {},
  ) {
    const { status = 200, headers = {}, statusText = "OK" } = opts;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: new Headers(headers),
      text: () => Promise.resolve(body),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
      body: { cancel: () => Promise.resolve() },
    };
  }

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("extracts article content and strips boilerplate", async () => {
    const html = `<html><head><title>Changelog</title></head><body>
      <nav><a href="/">Home</a><a href="/about">About</a></nav>
      <main>
        <h1>v3.0 Release Notes</h1>
        <p>This release includes <strong>breaking changes</strong> to the API.</p>
        <h2>New Features</h2>
        <p>Added support for streaming responses.</p>
      </main>
      <footer><p>Copyright 2026 Example Corp</p></footer>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/changelog" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("# v3.0 Release Notes");
    expect(result.content).toContain("**breaking changes**");
    expect(result.content).toContain("## New Features");
    expect(result.content).toContain("streaming responses");
    // Boilerplate stripped
    expect(result.content).not.toContain("Copyright 2026");
    expect(result.content).not.toContain("About");
  });

  it("returns (empty response) when HTML is all boilerplate", async () => {
    const html = `<html><head><script>analytics()</script><style>.x{}</style></head><body>
      <nav><a href="/">Home</a></nav>
      <footer><p>Footer text</p></footer>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(html, { headers: { "content-type": "text/html" } }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/empty" });
    expect(result.content).toBe("(empty response)");
  });

  it("preserves code blocks as markdown fenced blocks", async () => {
    const html = `<html><body>
      <h2>Usage</h2>
      <pre><code class="language-python">def greet(name):
    return f"Hello, {name}"</code></pre>
      <p>Call it with any string argument.</p>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(html, { headers: { "content-type": "text/html" } }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/docs" });
    expect(result.content).toContain("```python");
    expect(result.content).toContain("def greet(name):");
    expect(result.content).toContain("## Usage");
    expect(result.content).toContain("string argument");
  });

  it("truncates large HTML extraction output at max_length", async () => {
    const paragraphs = Array.from({ length: 100 }, (_, i) =>
      `<p>Paragraph ${i}: some content to fill space in this document.</p>`
    ).join("\n");
    const html = `<html><body><article>${paragraphs}</article></body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(html, { headers: { "content-type": "text/html" } }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/long", max_length: 500 });
    expect(result.content).toContain("[Truncated");
    expect(result.content).toContain("showing first 500");
  });

  it("converts links and formatting to markdown", async () => {
    const html = `<html><body>
      <p>See <a href="https://docs.example.com">the docs</a> for <em>detailed</em> info.</p>
      <ul><li>First item</li><li>Second item</li></ul>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(html, { headers: { "content-type": "text/html" } }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/page" });
    expect(result.content).toContain("[the docs](https://docs.example.com)");
    expect(result.content).toContain("*detailed*");
    expect(result.content).toContain("- First item");
    expect(result.content).toContain("- Second item");
  });
});
