/**
 * Doctor namespace daemon-side handler test.
 *
 * The doctor namespace pilot migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the doctor module. This test pins three
 * invariants the migration relies on:
 *
 *  1. The doctor module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `doctor` namespace.
 *  2. The factory's handler is wired through the typed `DaemonTransport`'s
 *     `requestStrict<T>` shape — calling `run` issues `GET /doctor/run`
 *     and `fix` issues `POST /doctor/fix`.
 *  3. Removing the doctor module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "doctor" missing-handler
 *     error. This is the failure mode the namespace migration replaces:
 *     no silent fallback, no core-side stub.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import doctorModule from "./index.js";

type RecordedCall = { method: string; path: string };

function makeRecordingTransport(
  responses: Record<string, unknown>,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async <T>(method: string, path: string): Promise<T> => {
      calls.push({ method, path });
      const key = `${method} ${path}`;
      if (!(key in responses)) {
        throw new Error(`No fake response registered for ${key}`);
      }
      return responses[key] as T;
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

describe("doctor module daemonClient(link)", () => {
  it("contributes a doctor namespace handler", () => {
    expect(doctorModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport({}).transport;
    const contributed = doctorModule.daemonClient!(link);
    expect(contributed.doctor).toBeDefined();
    expect(typeof contributed.doctor!.run).toBe("function");
    expect(typeof contributed.doctor!.fix).toBe("function");
  });

  it("routes run through GET /doctor/run with skipConnectivity threaded into the query", async () => {
    const { transport, calls } = makeRecordingTransport({
      "GET /doctor/run?skipConnectivity=true": {
        checks: [{ label: "Daemon", status: "pass" }],
      },
    });
    const contributed = doctorModule.daemonClient!(transport);
    const result = await contributed.doctor!.run({ skipConnectivity: true });
    expect(result).toEqual({ checks: [{ label: "Daemon", status: "pass" }] });
    expect(calls).toEqual([
      { method: "GET", path: "/doctor/run?skipConnectivity=true" },
    ]);
  });

  it("routes run without options through GET /doctor/run with no query", async () => {
    const { transport, calls } = makeRecordingTransport({
      "GET /doctor/run": { checks: [] },
    });
    const contributed = doctorModule.daemonClient!(transport);
    const result = await contributed.doctor!.run();
    expect(result).toEqual({ checks: [] });
    expect(calls).toEqual([{ method: "GET", path: "/doctor/run" }]);
  });

  it("routes fix through POST /doctor/fix", async () => {
    const { transport, calls } = makeRecordingTransport({
      "POST /doctor/fix": {
        repairs: [{ item: "Daemon lock file", action: "skipped" }],
      },
    });
    const contributed = doctorModule.daemonClient!(transport);
    const result = await contributed.doctor!.fix();
    expect(result).toEqual({
      repairs: [{ item: "Daemon lock file", action: "skipped" }],
    });
    expect(calls).toEqual([{ method: "POST", path: "/doctor/fix" }]);
  });

  it("the assembly path fails loudly when the doctor module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport({});
    // Simulate the loader having no doctor contribution. The core stub no
    // longer covers this namespace, so assembly must throw and name doctor
    // explicitly — there is intentionally no silent fallback.
    expect(() => assembleDaemonClientHandlers(transport)).toThrow(
      /doctor/,
    );
    expect(() => assembleDaemonClientHandlers(transport)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the doctor module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport({});
    const contributed = doctorModule.daemonClient!(transport);
    expect(() => assembleDaemonClientHandlers(transport, contributed)).not.toThrow();
  });
});
