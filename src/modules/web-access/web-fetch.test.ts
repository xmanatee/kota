import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OutboundHttpDispatcher, OutboundHttpTransport, outboundHttp } from "#core/outbound-http/index.js";
import { runWebFetch } from "./web-fetch.js";

const dispatcher = vi.fn<OutboundHttpDispatcher>();
let root: string;
let scope: string;
const request = (input: Record<string, unknown> = {}) =>
  runWebFetch({ url: "https://example.com", ...input }, { cwd: scope, scopeId: "fetch-test" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kota-web-fetch-"));
  scope = join(root, "scope");
  mkdirSync(scope);
  dispatcher.mockReset().mockResolvedValue(new Response("ok"));
  const transport = new OutboundHttpTransport({
    dispatcher,
    resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  vi.spyOn(outboundHttp, "request").mockImplementation((input) => transport.request(input));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("web page fetch", () => {
  it.each([
    ["", "url is required"],
    ["ftp://example.com", "http://"],
    ["http://127.0.0.1/private", "loopback/private-network"],
  ])("rejects invalid and private targets: %s", async (url, reason) => {
    expect(await request({ url })).toMatchObject({ is_error: true, content: expect.stringContaining(reason) });
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it.each(["../outside", "dangling"])("rejects escaped save paths: %s", async (saveTo) => {
    symlinkSync(join(root, "outside"), join(scope, "dangling"));
    expect(await request({ save_to: saveTo })).toMatchObject({
      is_error: true,
      content: expect.stringContaining("scope directory"),
    });
    expect(dispatcher).not.toHaveBeenCalled();
    expect(existsSync(join(root, "outside"))).toBe(false);
  });

  it("renders HTML metadata and Markdown through the page extractor", async () => {
    dispatcher.mockResolvedValue(
      new Response(
        "<title>Guide</title><nav>Discard</nav><article><h1>Usage</h1>" +
          '<pre><code class="language-ts">const value = 42;</code></pre><p>' +
          "Explanation of the code. ".repeat(8) +
          "</p></article>",
        { headers: { "content-type": "text/html" } },
      ),
    );
    const result = await request();
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("**Guide**");
    expect(result.content).toContain("# Usage");
    expect(result.content).toContain("```ts\nconst value = 42;\n```");
    expect(result.content).not.toContain("Discard");
  });

  it.each([
    ['{"name":"Alice","age":30}', "application/json", "[JSON object — 2 keys: name, age]"],
    ["[1,2,3]", "application/json", "[JSON array — 3 items]"],
    ["true", "application/json", "true"],
    ["null", "application/json", "null"],
    ["broken {", "application/json", "broken {"],
    ["text", "text/plain", "text"],
    ["<svg>text</svg>", "image/svg+xml; charset=utf-8", "<svg>text</svg>"],
  ])("renders %s as %s", async (body, contentType, expected) => {
    dispatcher.mockResolvedValue(new Response(body, { headers: { "content-type": contentType } }));
    expect(await request()).toMatchObject({ content: expect.stringContaining(expected) });
  });

  it("bounds the JSON structure hint", async () => {
    const data = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`key${i}`, i]));
    dispatcher.mockResolvedValue(
      new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }),
    );
    const result = await request();
    expect(result.content).toContain("15 keys:");
    expect(result.content).toContain(", ...]");
  });

  it.each([
    "image/png",
    "audio/mpeg",
    "video/mp4",
    "font/woff2",
    "application/pdf; charset=binary",
    "application/wasm",
  ])("describes binary %s without returning garbled data", async (contentType) => {
    dispatcher.mockResolvedValue(
      new Response(new Uint8Array(1024), { headers: { "content-type": contentType, "content-length": "1024" } }),
    );
    const result = await request();
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Binary content:");
    expect(result.content).toContain("1.0 KB");
    expect(result.content).toContain("save_to");
  });

  it.each(["text/plain", "application/json", "text/html"])("bounds inline %s output", async (contentType) => {
    dispatcher.mockResolvedValue(new Response("x".repeat(100), { headers: { "content-type": contentType } }));
    const result = await request({ max_length: 20 });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("x".repeat(20));
    expect(result.content).not.toContain("x".repeat(21));
    expect(result.content).toContain("[Truncated");
  });

  it.each([
    "text/plain",
    "application/pdf",
  ])("saves exact %s bytes with scoped parent creation", async (contentType) => {
    const bytes = new TextEncoder().encode("é".repeat(600));
    dispatcher.mockResolvedValue(new Response(bytes, { headers: { "content-type": contentType } }));
    const result = await request({ save_to: "nested/file" });
    expect(result.is_error).toBeUndefined();
    expect(readFileSync(join(scope, "nested/file"))).toEqual(Buffer.from(bytes));
    expect(result.content).toContain(contentType);
    if (contentType === "text/plain") {
      expect(result.content).toContain("Preview:");
      expect(result.content).toContain("é".repeat(500));
      expect(result.content).not.toContain("é".repeat(501));
      expect(result.content).toContain("...");
    } else expect(result.content).toContain("Downloaded");
  });

  it.each([
    "text/plain",
    "application/pdf",
  ])("rejects oversized %s saves without replacing data", async (contentType) => {
    writeFileSync(join(scope, "saved"), "original");
    dispatcher.mockResolvedValue(
      new Response("oversized", { headers: { "content-type": contentType, "content-length": "9" } }),
    );
    expect(await request({ save_to: "saved", max_length: 4 })).toMatchObject({
      is_error: true,
      content: expect.stringContaining("max_length"),
    });
    expect(readFileSync(join(scope, "saved"), "utf8")).toBe("original");
  });

  it("reports HTTP and disk errors without a successful download", async () => {
    dispatcher.mockResolvedValueOnce(new Response("missing", { status: 404, statusText: "Not Found" }));
    expect(await request({ save_to: "missing" })).toEqual({ is_error: true, content: "HTTP 404 Not Found" });
    expect(existsSync(join(scope, "missing"))).toBe(false);
    expect(await request({ save_to: "." })).toMatchObject({
      is_error: true,
      content: expect.stringContaining("Error saving file"),
    });
  });

  it.each([
    new Error("Connection aborted by remote host"),
    new DOMException("aborted", "AbortError"),
  ])("reports adapter errors without inventing a timeout: %s", async (error) => {
    dispatcher.mockRejectedValue(error);
    const result = await request();
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("Fetch error: network:") });
    expect(result.content).not.toContain("timed out");
  });

  it("keeps the deadline active during body reads and leaves the destination untouched", async () => {
    vi.useFakeTimers();
    dispatcher.mockImplementation(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
            },
          }),
        ),
    );
    const result = request({ save_to: "slow" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual({ is_error: true, content: "Error: request timed out (30s)" });
    expect(existsSync(join(scope, "slow"))).toBe(false);
  });
});

  it.each([
    '<body><article><p>Article evidence survives optional head closure.</p></article></body>',
    '<article><p>Article evidence survives optional head closure.</p></article>',
    'Article evidence survives optional head closure.',
  ])("retains content when the head end tag is omitted: %s", async (body) => {
    const html = `<html><head><title>Research title</title><style>.layout{}</style>${body}</html>`;
    dispatcher.mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );
    const result = await runWebFetch({ url: "https://example.com/research" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Article evidence survives optional head closure.");
    expect(result.content).toContain("Research title");
    expect(result.content).not.toContain(".layout");
  });

  it.each(["script", "style", "head", "title", "template", "nav"])(
    "ignores a commented %s opening tag before the article",
    async (tag) => {
      const html = `<html><head><title>Research title</title></head><body><!-- example: <${tag}> -->
        <article><p>Readable article evidence.</p></article></body></html>`;
      dispatcher.mockResolvedValue(
        new Response(html, { headers: { "content-type": "text/html" } }),
      );
      const result = await runWebFetch({ url: "https://example.com/research" });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Readable article evidence.");
      expect(result.content).not.toContain("example:");
    },
  );

  it.each([
    '<html><head><title>Metadata only</title>',
    '<html><head><title>Metadata only</title><script>unfinished layout',
    '<html><head><title>Metadata only</title></head><!-- example: <script> -->',
    '<html><head><title>Metadata only</title></head><!-- unfinished comment',
  ])("rejects metadata and unfinished non-content markup: %s", async (html) => {
    dispatcher.mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );
    const result = await runWebFetch({ url: "https://example.com/research" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("no readable source content");
  });

  it("ignores commented metadata and content regions while preserving script boundaries", async () => {
    const html = `<html><!-- <title>False title</title><article>${"False evidence. ".repeat(20)}</article> -->
      <head><title>Research title</title><script>const marker = '<!--';</script></head>
      <body><article><p>Readable article evidence.</p></article></body></html>`;
    dispatcher.mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );
    const result = await runWebFetch({ url: "https://example.com/research" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Readable article evidence.");
    expect(result.content).toContain("Research title");
    expect(result.content).not.toContain("False");
    expect(result.content).not.toContain("const marker");
  });

  it("rejects HTML with only boilerplate", async () => {
    const html = `<html><head><script>analytics()</script><style>.x{}</style></head><body>
      <nav><a href="/">Home</a></nav>
      <footer><p>Footer text</p></footer>
    </body></html>`;
    dispatcher.mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );
    const result = await runWebFetch({ url: "https://example.com/empty" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("no readable source content");
  });

  it("spends the bounded HTML output on article content before metadata", async () => {
    const paragraphs = Array.from(
      { length: 100 },
      (_, i) => `<p>Paragraph ${i}: some content to fill space in this document.</p>`,
    ).join("\n");
    const html = `<html><head><meta name="description" content="${"Page metadata. ".repeat(100)}"></head><body><article>${paragraphs}</article></body></html>`;
    dispatcher.mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );
    const result = await runWebFetch({
      url: "https://example.com/long",
      max_length: 500,
    });
    expect(result.content).toContain("[Truncated");
    expect(result.content).toContain("chars total, showing first 500");
    expect(result.content.split("\n\n[Truncated")[0]).toHaveLength(500);
    expect(result.content).toContain("Paragraph 0:");
    expect(result.content).not.toContain("Page metadata.");
  });

  it("cancels an in-flight request when the calling workflow aborts", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    dispatcher.mockImplementation(async (_url, init) => {
      requestSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
        controller.abort(new Error("Workflow cancelled"));
      });
    });
    const result = await runWebFetch({ url: "https://example.com" }, { signal: controller.signal });
    expect(requestSignal?.aborted).toBe(true);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("aborted");
  });


it("rejects empty source content", async () => {
  dispatcher.mockResolvedValue(new Response(""));
  expect(await request()).toMatchObject({ is_error: true, content: expect.stringContaining("no readable source content") });
});

it("formats complete JSON before applying the output budget", async () => {
  dispatcher.mockResolvedValue(new Response('{"data":"xxxxxxxx"}', { headers: { "content-type": "application/json" } }));
  const result = await request({ max_length: 8 });
  expect(result.is_error).toBeUndefined();
  expect(result.content.startsWith("[JSON ob")).toBe(true);
  expect(result.content).toContain("[Truncated");
});

it("rejects oversized page responses independently of the output budget", async () => {
  dispatcher.mockResolvedValue(new Response("body", { headers: { "content-type": "text/plain", "content-length": "1048577" } }));
  expect(await request({ max_length: 8 })).toMatchObject({ is_error: true, content: expect.stringContaining("response-too-large") });
});
