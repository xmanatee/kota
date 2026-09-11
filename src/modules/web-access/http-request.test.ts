import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OutboundHttpDispatcher, OutboundHttpTransport, outboundHttp } from "#core/outbound-http/index.js";
import { runHttpRequest } from "./http-request.js";

const url = "https://api.example.com/data";
let root: string;
let scope: string;
const dispatcher = vi.fn<OutboundHttpDispatcher>();
const request = (input: Record<string, unknown> = {}) =>
  runHttpRequest({ url, ...input }, { cwd: scope, scopeId: "http-test" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kota-http-"));
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

describe("HTTP request adapter", () => {
  it.each([
    [{ url: "" }, "url is required"],
    [{ method: "TRACE" }, "unsupported method"],
    [{ method: "GET", body: "data" }, "cannot have a body"],
    [{ method: "HEAD", body: "data" }, "cannot have a body"],
    [{ url: "ftp://example.com" }, "http://"],
  ])("rejects invalid input before dispatch: %j", async (input, message) => {
    const result = await request(input);
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining(message) });
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("selects public-target policy and returns redacted rejection", async () => {
    const result = await request({ url: "http://127.0.0.1/status#access_token=secret" });
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("loopback/private-network") });
    expect(result.content).not.toContain("secret");
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("normalizes and forwards method, body and caller headers", async () => {
    dispatcher.mockResolvedValue(new Response('{"id":42}', { status: 201, statusText: "Created" }));
    const result = await request({
      method: "post",
      body: "payload",
      headers: { Authorization: "Bearer token", "X-Custom": "value" },
    });
    const [target, init] = dispatcher.mock.calls[0];
    expect(target.toString()).toBe(url);
    expect(init).toMatchObject({ method: "POST", body: "payload" });
    expect(Object.fromEntries(new Headers(init.headers))).toMatchObject({
      authorization: "Bearer token",
      "x-custom": "value",
      "user-agent": "KOTA/0.1",
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("HTTP 201 Created");
    expect(result.content).toContain('"id": 42');
  });

  it.each([
    ["GET", 200, "ok"],
    ["DELETE", 204, ""],
    ["OPTIONS", 204, ""],
    ["HEAD", 200, "(HEAD — no body)"],
  ])("preserves %s response semantics", async (method, status, body) => {
    dispatcher.mockResolvedValue(
      new Response(status === 204 ? null : "ok", { status, headers: { allow: "GET, HEAD" } }),
    );
    const result = await request({ method });
    expect(dispatcher.mock.calls[0][1].method).toBe(method);
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain(`HTTP ${status}`);
    expect(result.content).toContain("allow: GET, HEAD");
    expect(result.content).toContain(body);
    if (method === "HEAD") expect(result.content).not.toContain("ok");
  });

  it.each([
    ['{"nested":{"a":1}}', "application/json", '"nested": {'],
    ['{"auto":true}', "text/plain", '"auto": true'],
    ['[{"name":"Alice"}]', "application/json", "| Alice |"],
    ["[1,2]", "application/json", "[\n  1,\n  2\n]"],
    ["broken {", "application/json", "broken {"],
  ])("renders response bodies: %s", async (body, contentType, expected) => {
    dispatcher.mockResolvedValue(new Response(body, { headers: { "content-type": contentType } }));
    const result = await request();
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain(expected);
    expect(result.content).not.toContain("[Redirected");
  });

  it.each([404, 500])("retains HTTP %i errors and useful response headers", async (status) => {
    dispatcher.mockResolvedValue(
      new Response("failure", {
        status,
        headers: {
          "x-request-id": "request-id",
          link: '<https://api.example.com/next>; rel="next"',
          "x-ratelimit-reset": "1700000000",
        },
      }),
    );
    const result = await request();
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining(`HTTP ${status}`) });
    expect(result.content).toContain("failure");
    expect(result.content).toContain("x-request-id: request-id");
    expect(result.content).toContain("link: <https://api.example.com/next>");
    expect(result.content).toContain("x-ratelimit-reset: 1700000000");
  });

  it.each(["GET", "HEAD", "save"])("reports redirects for %s", async (mode) => {
    dispatcher
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://cdn.example.com/final" } }),
      )
      .mockResolvedValueOnce(new Response("data"));
    const result = await request(mode === "save" ? { save_to: "download.txt" } : { method: mode });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("[Redirected → https://cdn.example.com/final]");
    if (mode === "save") expect(readFileSync(join(scope, "download.txt"), "utf8")).toBe("data");
  });

  it("reports a denied redirect without contacting the private destination", async () => {
    dispatcher.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://10.0.0.5/private" } }),
    );
    const result = await request();
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("loopback/private-network");
    expect(dispatcher.mock.calls.map(([target]) => target.toString())).toEqual([url]);
  });

  it("bounds inline output and preserves complete rows of truncated JSON", async () => {
    const body = '[{"name":"Alice"},{"name":"Bob"},{"name":"truncated"}]';
    dispatcher.mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } }));
    const result = await request({ max_response_length: 40 });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Alice");
    expect(result.content).toContain("Bob");
    expect(result.content).toContain("response exceeded 40 bytes");
    expect(result.content).toContain("save_to");
  });

  it("propagates numeric fallback and caps to the transport", async () => {
    await request({ timeout_ms: 0, max_response_length: -1 });
    expect(outboundHttp.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ limits: expect.objectContaining({ timeoutMs: 30_000 }) }),
    );
    dispatcher.mockResolvedValue(new Response("data"));
    await request({ timeout_ms: 200_000, max_response_length: "4", save_to: "bounded.txt" });
    expect(outboundHttp.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ limits: { timeoutMs: 120_000, responseBytes: 4 } }),
    );
    expect(readFileSync(join(scope, "bounded.txt"), "utf8")).toBe("data");
  });

  it("describes binary data and offers a file download", async () => {
    dispatcher.mockResolvedValue(
      new Response(new Uint8Array(1024), { headers: { "content-type": "image/png", "content-length": "1024" } }),
    );
    const result = await request();
    expect(result.content).toContain("[Binary response: image/png (1.0KB)");
    expect(result.content).toContain("save_to");
  });

  it.each(["../outside.txt", "dangling.txt"])("rejects escaped save paths before dispatch: %s", async (saveTo) => {
    const outside = join(root, "outside.txt");
    symlinkSync(outside, join(scope, "dangling.txt"));
    const result = await request({ save_to: saveTo });
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("scope directory") });
    expect(dispatcher).not.toHaveBeenCalled();
    expect(existsSync(outside)).toBe(false);
  });

  it.each([
    ["application/json", new TextEncoder().encode('{"saved":true}'), 200],
    ["image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 200],
    ["text/plain", new TextEncoder().encode("not found"), 404],
  ])("saves exact bytes in the selected scope: %s", async (contentType, bytes, status) => {
    dispatcher.mockResolvedValue(new Response(bytes, { status, headers: { "content-type": contentType } }));
    const result = await request({ save_to: "nested/deep/result" });
    expect(result.content).toContain("[Saved to");
    expect(result.is_error).toBe(status >= 400 ? true : undefined);
    expect(readFileSync(join(scope, "nested/deep/result"))).toEqual(Buffer.from(bytes));
  });

  it.each([
    "text/plain",
    "image/png",
  ])("rejects oversized %s downloads without replacing an existing file", async (contentType) => {
    const saved = join(scope, "saved");
    writeFileSync(saved, "original");
    dispatcher.mockResolvedValue(
      new Response("oversized", { headers: { "content-type": contentType, "content-length": "9" } }),
    );
    const result = await request({ save_to: "saved", max_response_length: 4 });
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("max_response_length") });
    expect(readFileSync(saved, "utf8")).toBe("original");
  });

  it("reports an unwritable destination", async () => {
    const result = await request({ save_to: "." });
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("Error saving response") });
  });

  it.each([
    new Error("connection lost"),
    new DOMException("aborted", "AbortError"),
    "raw error",
    null,
  ])("reports network failure without inventing a timeout: %s", async (error) => {
    dispatcher.mockRejectedValue(error);
    const result = await request({ timeout_ms: 5_000 });
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("Request error: network:") });
    expect(result.content).not.toContain("timed out");
  });

  it("reports body-read failure before writing", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error("body lost"));
      },
    });
    dispatcher.mockResolvedValue(new Response(body));
    const result = await request({ save_to: "failed.txt" });
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("body lost") });
    expect(existsSync(join(scope, "failed.txt"))).toBe(false);
  });

  it("reports the configured timeout when the transport deadline actually fires", async () => {
    vi.useFakeTimers();
    dispatcher.mockImplementation(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    const result = request({ timeout_ms: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual({ is_error: true, content: "Error: request timed out (1s)" });
  });
});
