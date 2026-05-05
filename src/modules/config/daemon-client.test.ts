/**
 * Config namespace daemon-side handler test.
 *
 * The config namespace migrated out of the core stub into `daemonClient(link)`
 * on the config module. This test pins the invariants the migration relies
 * on:
 *
 *  1. The config module exposes a `daemonClient(link)` factory that
 *     contributes `config` with `validate`, `get`, `set`, `schemaPath`, and
 *     `schemaContent` methods.
 *  2. `validate()` routes through `link.request("GET", "/config/validate")`
 *     and decodes the success arm correctly: a `200 + { sources, warnings,
 *     resolved }` response collapses verbatim.
 *  3. `validate()` throws on `null` (transport failure or non-ok response)
 *     with a message containing `"Daemon unreachable"`.
 *  4. `get(key)` routes through `link.fetchRaw` with method `GET`, path
 *     `/config/value?key=<encodeURIComponent(key)>` (encoding pinned
 *     byte-for-byte: `kota.x.y` → `kota.x.y`, `weird key` → `weird%20key`).
 *  5. `get(key)` decodes the success arm correctly: a `200 + { found: true,
 *     value }` response collapses to `{ found: true, value }`.
 *  6. `get(key)` decodes the not_found arm correctly: a `404` response
 *     collapses to `{ found: false, reason: "not_found" }`.
 *  7. `set(key, rawValue)` routes through `link.fetchRaw` with method `PUT`,
 *     path `/config/value`, headers including `"Content-Type":
 *     "application/json"` plus `link.authHeaders()`, and body
 *     `{ key, rawValue }` pinned byte-for-byte.
 *  8. `set` decodes the success arm correctly: a `200 + { ok: true,
 *     unknownKey, topKey, value }` response collapses verbatim.
 *  9. `set` throws on a `400 + { error: "invalid value" }` response with
 *     a message containing `"invalid value"`.
 * 10. `schemaPath()` routes through `link.request("GET",
 *     "/config/schema-path")` and decodes the success arm; throws on `null`
 *     with `"Daemon unreachable"`.
 * 11. `schemaContent()` routes through `link.request("GET",
 *     "/config/schema")` and decodes the success arm; throws on `null` with
 *     `"Daemon unreachable"`.
 * 12. Supplying the contribution to the assembly path satisfies coverage.
 * 13. Removing the config module's contribution makes the assembled client
 *     fail loudly with a clear "config" missing-handler error.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import configModule from "./index.js";

type RecordedRequest = {
  kind: "request";
  method: string;
  path: string;
  body: unknown;
};

type RecordedFetchRaw = {
  kind: "fetchRaw";
  path: string;
  init: RequestInit | undefined;
};

type RecordedCall = RecordedRequest | RecordedFetchRaw;

type RequestResponder = (
  method: string,
  path: string,
  body: unknown,
) => unknown;

type FetchResponder = (
  path: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

function makeRecordingTransport(opts: {
  request?: RequestResponder;
  fetchRaw?: FetchResponder;
}): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async <T>(method: string, path: string, body?: unknown) => {
      calls.push({ kind: "request", method, path, body });
      if (!opts.request) return null;
      return opts.request(method, path, body) as T | null;
    },
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async (path, init) => {
      calls.push({ kind: "fetchRaw", path, init });
      if (!opts.fetchRaw) {
        throw new Error("fetchRaw responder not configured");
      }
      return opts.fetchRaw(path, init);
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_VALIDATE_BODY = {
  sources: [{ label: "project" as const, path: "/p/.kota/config.json" }],
  warnings: [],
  resolved: { foo: 1 },
};

describe("config module daemonClient(link) — config namespace", () => {
  it("contributes a config namespace handler with five methods", () => {
    expect(configModule.daemonClient).toBeTypeOf("function");
    const { transport } = makeRecordingTransport({});
    const contributed = configModule.daemonClient!(transport);
    expect(contributed.config).toBeDefined();
    expect(typeof contributed.config!.validate).toBe("function");
    expect(typeof contributed.config!.get).toBe("function");
    expect(typeof contributed.config!.set).toBe("function");
    expect(typeof contributed.config!.schemaPath).toBe("function");
    expect(typeof contributed.config!.schemaContent).toBe("function");
  });

  it("routes validate() through GET /config/validate and decodes the success arm", async () => {
    const { transport, calls } = makeRecordingTransport({
      request: (method, path) =>
        method === "GET" && path === "/config/validate" ? SAMPLE_VALIDATE_BODY : null,
    });
    const contributed = configModule.daemonClient!(transport);
    const result = await contributed.config!.validate();
    expect(result).toEqual(SAMPLE_VALIDATE_BODY);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.kind).toBe("request");
    if (call.kind === "request") {
      expect(call.method).toBe("GET");
      expect(call.path).toBe("/config/validate");
      expect(call.body).toBeUndefined();
    }
  });

  it("validate() throws on null with a message containing \"Daemon unreachable\"", async () => {
    const { transport } = makeRecordingTransport({ request: () => null });
    const contributed = configModule.daemonClient!(transport);
    await expect(contributed.config!.validate()).rejects.toThrow(
      /Daemon unreachable/,
    );
  });

  it("routes get(key) through fetchRaw GET /config/value?key=<encodeURIComponent(key)>", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { found: true, value: "x" }),
    });
    const contributed = configModule.daemonClient!(transport);
    await contributed.config!.get("kota.x.y");
    await contributed.config!.get("weird key");
    expect(calls).toHaveLength(2);
    const first = calls[0]!;
    const second = calls[1]!;
    expect(first.kind).toBe("fetchRaw");
    expect(second.kind).toBe("fetchRaw");
    if (first.kind === "fetchRaw") {
      expect(first.path).toBe("/config/value?key=kota.x.y");
      expect(first.init?.method).toBe("GET");
    }
    if (second.kind === "fetchRaw") {
      expect(second.path).toBe("/config/value?key=weird%20key");
      expect(second.init?.method).toBe("GET");
    }
  });

  it("get(key) decodes the success arm: 200 + { found: true, value } collapses verbatim", async () => {
    const { transport } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, { found: true, value: { nested: 42 } }),
    });
    const contributed = configModule.daemonClient!(transport);
    const result = await contributed.config!.get("a.b");
    expect(result).toEqual({ found: true, value: { nested: 42 } });
  });

  it("get(key) decodes the not_found arm: 404 collapses to { found: false, reason: \"not_found\" }", async () => {
    const { transport } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(404, { found: false, reason: "not_found" }),
    });
    const contributed = configModule.daemonClient!(transport);
    const result = await contributed.config!.get("missing");
    expect(result).toEqual({ found: false, reason: "not_found" });
  });

  it("routes set(key, rawValue) through fetchRaw PUT /config/value with JSON body pinned byte-for-byte", async () => {
    const { transport, calls } = makeRecordingTransport({
      fetchRaw: () =>
        jsonResponse(200, {
          ok: true,
          unknownKey: false,
          topKey: "kota",
          value: 5,
        }),
    });
    const contributed = configModule.daemonClient!(transport);
    await contributed.config!.set("kota.x", "5");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.kind).toBe("fetchRaw");
    if (call.kind === "fetchRaw") {
      expect(call.path).toBe("/config/value");
      expect(call.init?.method).toBe("PUT");
      expect(call.init?.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      });
      expect(JSON.parse(String(call.init?.body))).toEqual({
        key: "kota.x",
        rawValue: "5",
      });
    }
  });

  it("set decodes the success arm: 200 + { ok, unknownKey, topKey, value } collapses verbatim", async () => {
    const successBody = {
      ok: true as const,
      unknownKey: false,
      topKey: "kota",
      value: 5,
    };
    const { transport } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(200, successBody),
    });
    const contributed = configModule.daemonClient!(transport);
    const result = await contributed.config!.set("kota.x", "5");
    expect(result).toEqual(successBody);
  });

  it("set throws on 400 + { error: \"invalid value\" } with the daemon's error message", async () => {
    const { transport } = makeRecordingTransport({
      fetchRaw: () => jsonResponse(400, { error: "invalid value" }),
    });
    const contributed = configModule.daemonClient!(transport);
    await expect(contributed.config!.set("kota.x", "bad")).rejects.toThrow(
      /invalid value/,
    );
  });

  it("routes schemaPath() through GET /config/schema-path and throws on null", async () => {
    const { transport, calls } = makeRecordingTransport({
      request: (method, path) =>
        method === "GET" && path === "/config/schema-path"
          ? { path: "/p/.kota/schema.json" }
          : null,
    });
    const contributed = configModule.daemonClient!(transport);
    const result = await contributed.config!.schemaPath();
    expect(result).toEqual({ path: "/p/.kota/schema.json" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.kind).toBe("request");
    if (call.kind === "request") {
      expect(call.method).toBe("GET");
      expect(call.path).toBe("/config/schema-path");
    }

    const { transport: failingTransport } = makeRecordingTransport({
      request: () => null,
    });
    const failingContributed = configModule.daemonClient!(failingTransport);
    await expect(failingContributed.config!.schemaPath()).rejects.toThrow(
      /Daemon unreachable/,
    );
  });

  it("routes schemaContent() through GET /config/schema and throws on null", async () => {
    const { transport, calls } = makeRecordingTransport({
      request: (method, path) =>
        method === "GET" && path === "/config/schema"
          ? { content: "{\"k\":1}" }
          : null,
    });
    const contributed = configModule.daemonClient!(transport);
    const result = await contributed.config!.schemaContent();
    expect(result).toEqual({ content: "{\"k\":1}" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.kind).toBe("request");
    if (call.kind === "request") {
      expect(call.method).toBe("GET");
      expect(call.path).toBe("/config/schema");
    }

    const { transport: failingTransport } = makeRecordingTransport({
      request: () => null,
    });
    const failingContributed = configModule.daemonClient!(failingTransport);
    await expect(failingContributed.config!.schemaContent()).rejects.toThrow(
      /Daemon unreachable/,
    );
  });

  it("supplying the config contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport({});
    const contributed = configModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.config;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });

  it("the assembly path fails loudly when the config contribution is removed", () => {
    const { transport } = makeRecordingTransport({});
    const others = buildMigratedNamespaceTestStubs();
    delete others.config;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /config/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });
});
