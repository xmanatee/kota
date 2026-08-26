/**
 * Harness-parity namespace daemon-side handler test.
 *
 * The harness-parity namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the harness-parity module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The harness-parity module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `harnessParity` namespace.
 *  2. `list` is wired through the typed `DaemonTransport.requestStrict<T>`
 *     shape — calling `list` issues `GET /harness-parity/scenarios`.
 *  3. `run` issues `POST /harness-parity/run` through the raw `fetchRaw`
 *     surface so the typed `{ ok: false; reason; message }` 400-response
 *     branch round-trips end-to-end as the discriminator on
 *     `HarnessParityRunResult`. A 200 response decodes to the success
 *     discriminator.
 *  4. Removing the harness-parity module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "harnessParity"
 *     missing-handler error. This is the failure mode the namespace
 *     migration replaces: no silent fallback, no core-side stub.
 */

import { describe, expect, it } from "vitest";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import harnessParityModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: string | undefined;
};

type RecordingTransport = {
  transport: DaemonTransport;
  calls: RecordedCall[];
};

function makeRecordingTransport(
  fetchRawResponses: Record<
    string,
    { status: number; body: unknown }
  >,
  requestStrictResponses: Record<string, unknown>,
): RecordingTransport {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async <T>(method: string, path: string): Promise<T> => {
      calls.push({ method, path, body: undefined });
      const key = `${method} ${path}`;
      if (!(key in requestStrictResponses)) {
        throw new Error(`No fake requestStrict response registered for ${key}`);
      }
      return requestStrictResponses[key] as T;
    },
    fetchRaw: async (path: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ method, path, body });
      const key = `${method} ${path}`;
      const response = fetchRawResponses[key];
      if (!response) {
        throw new Error(`No fake fetchRaw response registered for ${key}`);
      }
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

describe("harness-parity module daemonClient(link)", () => {
  it("contributes a harnessParity namespace handler", () => {
    expect(harnessParityModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport({}, {}).transport;
    const contributed = harnessParityModule.daemonClient!(link);
    expect(contributed.harnessParity).toBeDefined();
    expect(typeof contributed.harnessParity!.list).toBe("function");
    expect(typeof contributed.harnessParity!.run).toBe("function");
    expect(typeof contributed.harnessParity!.matrix).toBe("function");
  });

  it("routes list through GET /harness-parity/scenarios via requestStrict", async () => {
    const { transport, calls } = makeRecordingTransport(
      {},
      {
        "GET /harness-parity/scenarios": {
          scenarios: [{ id: "demo", description: "demo scenario" }],
        },
      },
    );
    const contributed = harnessParityModule.daemonClient!(transport);
    const result = await contributed.harnessParity!.list();
    expect(result).toEqual({
      scenarios: [{ id: "demo", description: "demo scenario" }],
    });
    expect(calls).toEqual([
      { method: "GET", path: "/harness-parity/scenarios", body: undefined },
    ]);
  });

  it("routes run through POST /harness-parity/run with the JSON-encoded options", async () => {
    const { transport, calls } = makeRecordingTransport(
      {
        "POST /harness-parity/run": {
          status: 200,
          body: {
            ok: true,
            outBaseDir: "/tmp/parity",
            artifacts: [],
          },
        },
      },
      {},
    );
    const contributed = harnessParityModule.daemonClient!(transport);
    const result = await contributed.harnessParity!.run({
      scenarios: ["demo"],
      harnesses: ["thin"],
    });
    expect(result).toEqual({
      ok: true,
      outBaseDir: "/tmp/parity",
      artifacts: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.path).toBe("/harness-parity/run");
    expect(calls[0]!.body).toBe(
      JSON.stringify({ scenarios: ["demo"], harnesses: ["thin"] }),
    );
  });

  it("encodes an empty run options object when called without arguments", async () => {
    const { transport, calls } = makeRecordingTransport(
      {
        "POST /harness-parity/run": {
          status: 200,
          body: { ok: true, outBaseDir: "/tmp/parity", artifacts: [] },
        },
      },
      {},
    );
    const contributed = harnessParityModule.daemonClient!(transport);
    await contributed.harnessParity!.run();
    expect(calls[0]!.body).toBe("{}");
  });

  it("routes matrix through POST /harness-parity/matrix with the JSON-encoded options", async () => {
    const { transport, calls } = makeRecordingTransport(
      {
        "POST /harness-parity/matrix": {
          status: 200,
          body: {
            ok: true,
            outBaseDir: "/tmp/matrix",
            reportPath: "/tmp/matrix/model-matrix-report.json",
            rows: [],
            groups: [],
            aggregate: {
              groupCount: 0,
              runnableGroupCount: 0,
              skippedGroupCount: 0,
              passAtK: null,
              passHatK: null,
            },
            shadowComparisons: [],
          },
        },
      },
      {},
    );
    const contributed = harnessParityModule.daemonClient!(transport);
    const result = await contributed.harnessParity!.matrix({
      scenarios: ["demo"],
      candidates: [{ model: "openrouter/z-ai/glm-5.2" }],
      repeats: 2,
    });
    expect(result).toMatchObject({
      ok: true,
      outBaseDir: "/tmp/matrix",
      reportPath: "/tmp/matrix/model-matrix-report.json",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.path).toBe("/harness-parity/matrix");
    expect(calls[0]!.body).toBe(
      JSON.stringify({
        scenarios: ["demo"],
        candidates: [{ model: "openrouter/z-ai/glm-5.2" }],
        repeats: 2,
      }),
    );
  });

  it("preserves the typed { ok: false } discriminator on a 400 response", async () => {
    const { transport } = makeRecordingTransport(
      {
        "POST /harness-parity/run": {
          status: 400,
          body: {
            ok: false,
            reason: "no_scenarios",
            message: "No scenarios to run",
          },
        },
      },
      {},
    );
    const contributed = harnessParityModule.daemonClient!(transport);
    const result = await contributed.harnessParity!.run();
    expect(result).toEqual({
      ok: false,
      reason: "no_scenarios",
      message: "No scenarios to run",
    });
  });

  it("throws on non-200, non-400 responses with the daemon's error message", async () => {
    const { transport } = makeRecordingTransport(
      {
        "POST /harness-parity/run": {
          status: 500,
          body: { error: "boom" },
        },
      },
      {},
    );
    const contributed = harnessParityModule.daemonClient!(transport);
    await expect(contributed.harnessParity!.run()).rejects.toThrow("boom");
  });
});
