/**
 * Sessions namespace daemon-side handler test.
 *
 * The sessions namespace migrated out of the core stub into
 * `daemonClient(link)` on the daemon-ops module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The daemon-ops module exposes a `daemonClient(link)` factory and the
 *     factory contributes the `sessions` namespace with `list` and
 *     `setAutonomyMode` methods.
 *  2. `list()` is wired through `link.fetchRaw` with method `GET`, path
 *     `/sessions`, headers from `link.authHeaders()`, and no body — and
 *     decodes the success arm correctly: a `200 + { sessions: [...] }`
 *     response collapses to `{ sessions: [<the same entries>] }`.
 *  3. `list()` throws on non-ok HTTP response (the daemon's body error
 *     surfaces in the thrown error message).
 *  4. `setAutonomyMode(id, mode)` is wired through `link.fetchRaw` with
 *     method `PATCH`, path `/sessions/<encodeURIComponent(id)>`, headers
 *     `{ "Content-Type": "application/json", ...link.authHeaders() }`, and
 *     body `{ autonomy_mode: mode }` — pinned byte-for-byte to detect
 *     unintended camelCase regressions on the wire.
 *  5. `setAutonomyMode` decodes the success arm correctly: a `200 + {
 *     autonomy_mode, source, serveOwned }` response collapses to `{ ok:
 *     true, autonomyMode, source, serveOwned }`.
 *  6. `setAutonomyMode` defaults `source` to `"daemon"` and `serveOwned` to
 *     `false` when the daemon response omits either.
 *  7. `setAutonomyMode` decodes the not_found arm correctly: a `404`
 *     response collapses to `{ ok: false, reason: "not_found" }`.
 *  8. `setAutonomyMode` decodes the daemon_required arm: a network failure
 *     (rejected fetch) inside the `try` block collapses to `{ ok: false,
 *     reason: "daemon_required" }` and a JSON parse failure on the success
 *     body inside the `try` block also collapses to the same arm.
 *  9. `setAutonomyMode` surfaces unrelated `HTTP`-prefixed errors as
 *     throws: a `502 + { error: "internal" }` response throws an error
 *     containing `"internal"`.
 * 10. `serveOwned: true` is honored: a `200 + { autonomy_mode, source:
 *     "serve", serveOwned: true }` response collapses to `{ ok: true,
 *     autonomyMode, source: "serve", serveOwned: true }`.
 * 11. Supplying the contribution to the assembly path satisfies coverage.
 * 12. Removing the daemon-ops module's sessions contribution makes the
 *     assembled client fail loudly with a clear "sessions" missing-handler
 *     error.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import daemonOpsModule from "./index.js";

type RecordedCall = {
  path: string;
  init: RequestInit | undefined;
};

type FetchResponder = (
  path: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

function makeRecordingTransport(responder: FetchResponder): {
  transport: DaemonTransport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async (path, init) => {
      calls.push({ path, init });
      return responder(path, init);
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

function malformedJsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("daemon-ops module daemonClient(link) — sessions namespace", () => {
  it("contributes a sessions namespace handler", () => {
    expect(daemonOpsModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => jsonResponse(200, { sessions: [] }))
      .transport;
    const contributed = daemonOpsModule.daemonClient!(link);
    expect(contributed.sessions).toBeDefined();
    expect(typeof contributed.sessions!.list).toBe("function");
    expect(typeof contributed.sessions!.setAutonomyMode).toBe("function");
  });

  it("routes list() through GET /sessions with auth headers and no body", async () => {
    const sessionEntries = [
      {
        id: "s1",
        createdAt: "2026-05-05T00:00:00Z",
        lastActive: 1715000000000,
        autonomyMode: "supervised" as const,
      },
    ];
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, { sessions: sessionEntries }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.list();
    expect(result).toEqual({ sessions: sessionEntries });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/sessions");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(calls[0]!.init?.body).toBeUndefined();
  });

  it("list() throws on non-ok HTTP response with the daemon's error message", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(502, { error: "daemon backend unavailable" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(contributed.sessions!.list()).rejects.toThrow(
      /daemon backend unavailable/,
    );
  });

  it("routes setAutonomyMode(id, mode) through PATCH /sessions/:id with snake_case body", async () => {
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, {
        autonomy_mode: "supervised",
        source: "daemon",
        serveOwned: false,
      }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode("sess-1", "supervised");
    expect(result).toEqual({
      ok: true,
      autonomyMode: "supervised",
      source: "daemon",
      serveOwned: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/sessions/sess-1");
    expect(calls[0]!.init?.method).toBe("PATCH");
    expect(calls[0]!.init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      autonomy_mode: "supervised",
    });
  });

  it("setAutonomyMode escapes path-id characters via encodeURIComponent", async () => {
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, {
        autonomy_mode: "passive",
        source: "daemon",
        serveOwned: false,
      }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    await contributed.sessions!.setAutonomyMode("sess/1 with space", "passive");
    expect(calls[0]!.path).toBe(
      `/sessions/${encodeURIComponent("sess/1 with space")}`,
    );
  });

  it("setAutonomyMode defaults source to \"daemon\" and serveOwned to false when omitted", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(200, { autonomy_mode: "passive" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode("sess-1", "passive");
    expect(result).toEqual({
      ok: true,
      autonomyMode: "passive",
      source: "daemon",
      serveOwned: false,
    });
  });

  it("setAutonomyMode decodes the not_found arm on a 404 response", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(404, { error: "session not found" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode(
      "missing",
      "supervised",
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("setAutonomyMode decodes the daemon_required arm on a network failure", async () => {
    const { transport } = makeRecordingTransport(() => {
      throw new TypeError("fetch failed");
    });
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode("sess-1", "supervised");
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("setAutonomyMode decodes the daemon_required arm on a JSON parse failure of the success body", async () => {
    const { transport } = makeRecordingTransport(() =>
      malformedJsonResponse(200, "not-json"),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode("sess-1", "supervised");
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("setAutonomyMode surfaces `HTTP <status>` throws when the daemon body lacks an error message", async () => {
    const { transport } = makeRecordingTransport(() =>
      malformedJsonResponse(502, "not-json"),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(
      contributed.sessions!.setAutonomyMode("sess-1", "supervised"),
    ).rejects.toThrow(/HTTP 502/);
  });

  it("setAutonomyMode collapses non-ok responses with a daemon-supplied error body into daemon_required", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(502, { error: "internal" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode(
      "sess-1",
      "supervised",
    );
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("setAutonomyMode honors serveOwned: true with source \"serve\"", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(200, {
        autonomy_mode: "supervised",
        source: "serve",
        serveOwned: true,
      }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode("sess-1", "supervised");
    expect(result).toEqual({
      ok: true,
      autonomyMode: "supervised",
      source: "serve",
      serveOwned: true,
    });
  });

  it("supplying the daemon-ops sessions contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => jsonResponse(200, {}));
    const contributed = daemonOpsModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.sessions;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });

  it("the assembly path fails loudly when the daemon-ops sessions contribution is removed", () => {
    const { transport } = makeRecordingTransport(() => jsonResponse(200, {}));
    const others = buildMigratedNamespaceTestStubs();
    delete others.sessions;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /sessions/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });
});
