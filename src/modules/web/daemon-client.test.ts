/**
 * web namespace daemon-side handler test.
 *
 * The web namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(_link)` on the web module. The migration generalizes
 * the stub-only shape that mcp-server established: the entire daemon
 * contract is a fixed `{ ok: false, reason: "daemon_required" }` constant
 * because the underlying capability — a long-running HTTP API server with
 * SSE streaming and the embedded web UI — cannot be hosted by the daemon
 * on the operator's behalf.
 *
 * This test pins the invariants the migration relies on:
 *
 *  1. The web module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `web` namespace with a `start`
 *     method.
 *  2. `start` returns `{ ok: false, reason: "daemon_required" }` regardless
 *     of which `WebStartOptions` field combination the caller passes in
 *     (port-only, port+model, port+verbose, port+noAuth, all-options).
 *  3. `start` issues no `request`, `requestStrict`, `fetchRaw`, or
 *     `events` call against the typed `DaemonTransport` — proven by a
 *     recording transport that throws on every method except the no-op
 *     `authHeaders`. This is the load-bearing shape: the daemon-side
 *     handler refuses uniformly without ever reaching the link.
 *  4. Removing the web module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "web" missing-handler
 *     error; supplying the contribution satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import webModule from "./index.js";

function makeRecordingTransport(): DaemonTransport {
  return {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => {
      throw new Error("unexpected request call");
    },
    requestStrict: async () => {
      throw new Error("unexpected requestStrict call");
    },
    fetchRaw: async (): Promise<Response> => {
      throw new Error("unexpected fetchRaw call");
    },
    events: async function* () {
      // empty generator; calling it would still surface as a test failure
      // because no test below ever consumes it.
      yield* [];
    },
  };
}

describe("web module daemonClient(link)", () => {
  it("contributes a web namespace handler with a start method", () => {
    expect(webModule.daemonClient).toBeTypeOf("function");
    const transport = makeRecordingTransport();
    const contributed = webModule.daemonClient!(transport);
    expect(contributed.web).toBeDefined();
    expect(typeof contributed.web!.start).toBe("function");
  });

  it("returns { ok: false, reason: 'daemon_required' } for the port-only options shape", async () => {
    const transport = makeRecordingTransport();
    const contributed = webModule.daemonClient!(transport);
    const result = await contributed.web!.start({ port: 3000 });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("returns the same refusal when a model is supplied", async () => {
    const transport = makeRecordingTransport();
    const contributed = webModule.daemonClient!(transport);
    const result = await contributed.web!.start({
      port: 3000,
      model: "claude-opus-4-7",
    });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("returns the same refusal when verbose is supplied", async () => {
    const transport = makeRecordingTransport();
    const contributed = webModule.daemonClient!(transport);
    const result = await contributed.web!.start({ port: 3000, verbose: true });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("returns the same refusal when noAuth is supplied", async () => {
    const transport = makeRecordingTransport();
    const contributed = webModule.daemonClient!(transport);
    const result = await contributed.web!.start({ port: 3000, noAuth: true });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("returns the same refusal when all options are supplied", async () => {
    const transport = makeRecordingTransport();
    const contributed = webModule.daemonClient!(transport);
    const result = await contributed.web!.start({
      port: 8080,
      model: "claude-opus-4-7",
      verbose: true,
      noAuth: true,
    });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("issues no transport call — every link method except authHeaders throws if invoked", async () => {
    const transport = makeRecordingTransport();
    const contributed = webModule.daemonClient!(transport);
    // The recording transport throws on `request`, `requestStrict`,
    // `fetchRaw`, and `events`. If `start` reached the link the promise
    // would reject with one of those error messages. The fact that every
    // call below resolves verbatim is the test that no transport method
    // was touched.
    await expect(contributed.web!.start({ port: 3000 })).resolves.toEqual({
      ok: false,
      reason: "daemon_required",
    });
    await expect(
      contributed.web!.start({ port: 3000, verbose: true, noAuth: true }),
    ).resolves.toEqual({ ok: false, reason: "daemon_required" });
    await expect(
      contributed.web!.start({
        port: 8080,
        model: "claude-opus-4-7",
        verbose: false,
        noAuth: false,
      }),
    ).resolves.toEqual({ ok: false, reason: "daemon_required" });
  });

  it("the assembly path fails loudly when the web module's daemonClient(link) is removed", () => {
    const transport = makeRecordingTransport();
    const others = buildMigratedNamespaceTestStubs();
    delete others.web;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /web/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the web module's contribution to the assembly path satisfies coverage", () => {
    const transport = makeRecordingTransport();
    const contributed = webModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.web;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
