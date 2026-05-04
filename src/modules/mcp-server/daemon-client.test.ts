/**
 * mcpServer namespace daemon-side handler test.
 *
 * The mcpServer namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(_link)` on the mcp-server module. The migration
 * exercises a new shape the prior pilots did not: the entire daemon
 * contract is a fixed `{ ok: false, reason: "daemon_required" }` constant
 * because the underlying capability — a long-running stdio MCP server —
 * cannot be hosted by the daemon on the operator's behalf.
 *
 * This test pins the invariants the migration relies on:
 *
 *  1. The mcp-server module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `mcpServer` namespace with a
 *     `start` method.
 *  2. `start` returns `{ ok: false, reason: "daemon_required" }` regardless
 *     of the options the caller passes in (default name, custom name,
 *     filtered tool list).
 *  3. `start` issues no `request`, `requestStrict`, or `fetchRaw` call
 *     against the typed `DaemonTransport` — proven by a recording transport
 *     that throws on every method except the no-op `authHeaders`. This is
 *     the load-bearing new shape: the daemon-side handler refuses
 *     uniformly without ever reaching the link.
 *  4. Removing the mcp-server module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "mcpServer" missing-handler
 *     error; supplying the contribution satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import mcpServerModule from "./index.js";

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
      // empty generator
    },
  };
}

describe("mcp-server module daemonClient(link)", () => {
  it("contributes an mcpServer namespace handler with a start method", () => {
    expect(mcpServerModule.daemonClient).toBeTypeOf("function");
    const transport = makeRecordingTransport();
    const contributed = mcpServerModule.daemonClient!(transport);
    expect(contributed.mcpServer).toBeDefined();
    expect(typeof contributed.mcpServer!.start).toBe("function");
  });

  it("returns { ok: false, reason: 'daemon_required' } for the default options shape", async () => {
    const transport = makeRecordingTransport();
    const contributed = mcpServerModule.daemonClient!(transport);
    const result = await contributed.mcpServer!.start({ name: "kota" });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("returns the same refusal for a custom server name", async () => {
    const transport = makeRecordingTransport();
    const contributed = mcpServerModule.daemonClient!(transport);
    const result = await contributed.mcpServer!.start({ name: "my-server" });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("returns the same refusal when a tool filter is supplied", async () => {
    const transport = makeRecordingTransport();
    const contributed = mcpServerModule.daemonClient!(transport);
    const result = await contributed.mcpServer!.start({
      name: "kota",
      toolFilter: ["read", "write", "search"],
    });
    expect(result).toEqual({ ok: false, reason: "daemon_required" });
  });

  it("issues no transport call — every link method except authHeaders throws if invoked", async () => {
    const transport = makeRecordingTransport();
    const contributed = mcpServerModule.daemonClient!(transport);
    // The recording transport throws on `request`, `requestStrict`, and
    // `fetchRaw`. If `start` reached the link the promise would reject with
    // one of those error messages. The fact that every call below resolves
    // verbatim is the test that no transport method was touched.
    await expect(
      contributed.mcpServer!.start({ name: "kota" }),
    ).resolves.toEqual({ ok: false, reason: "daemon_required" });
    await expect(
      contributed.mcpServer!.start({ name: "kota", toolFilter: [] }),
    ).resolves.toEqual({ ok: false, reason: "daemon_required" });
    await expect(
      contributed.mcpServer!.start({ name: "alt", toolFilter: ["read"] }),
    ).resolves.toEqual({ ok: false, reason: "daemon_required" });
  });

  it("the assembly path fails loudly when the mcp-server module's daemonClient(link) is removed", () => {
    const transport = makeRecordingTransport();
    const others = buildMigratedNamespaceTestStubs();
    delete others.mcpServer;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /mcpServer/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the mcp-server module's contribution to the assembly path satisfies coverage", () => {
    const transport = makeRecordingTransport();
    const contributed = mcpServerModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.mcpServer;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
