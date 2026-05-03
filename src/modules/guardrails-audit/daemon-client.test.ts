/**
 * Audit namespace daemon-side handler test.
 *
 * The audit namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the guardrails-audit module. This test pins
 * the invariants the migration relies on:
 *
 *  1. The guardrails-audit module exposes a `daemonClient(link)` factory and
 *     the factory returns a handler for the `audit` namespace.
 *  2. `list` is wired through the typed `DaemonTransport.requestStrict<T>`
 *     shape — calling `list` issues `GET /audit`.
 *  3. Filter fields thread into the query string in the same order and
 *     encoding the daemon's `parseFilter` already accepts.
 *  4. Removing the guardrails-audit module's daemonClient contribution makes
 *     the assembled client fail loudly with a clear "audit"
 *     missing-handler error. This is the failure mode the namespace
 *     migration replaces: no silent fallback, no core-side stub.
 *  5. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import guardrailsAuditModule from "./index.js";

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

describe("guardrails-audit module daemonClient(link)", () => {
  it("contributes an audit namespace handler", () => {
    expect(guardrailsAuditModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport({}).transport;
    const contributed = guardrailsAuditModule.daemonClient!(link);
    expect(contributed.audit).toBeDefined();
    expect(typeof contributed.audit!.list).toBe("function");
  });

  it("routes list without filter through GET /audit with no query", async () => {
    const { transport, calls } = makeRecordingTransport({
      "GET /audit": {
        entries: [
          {
            ts: "2026-05-03T07:00:00.000Z",
            tool: "shell",
            risk: "moderate",
            policy: "allow",
            reason: "ok",
          },
        ],
      },
    });
    const contributed = guardrailsAuditModule.daemonClient!(transport);
    const result = await contributed.audit!.list();
    expect(result).toEqual({
      entries: [
        {
          ts: "2026-05-03T07:00:00.000Z",
          tool: "shell",
          risk: "moderate",
          policy: "allow",
          reason: "ok",
        },
      ],
    });
    expect(calls).toEqual([{ method: "GET", path: "/audit" }]);
  });

  it("threads every filter field into the query string", async () => {
    const { transport, calls } = makeRecordingTransport({
      "GET /audit?limit=5&tool=shell&risk=dangerous&policy=confirm&since=2026-05-01T00%3A00%3A00.000Z&session=sess-1":
        { entries: [] },
    });
    const contributed = guardrailsAuditModule.daemonClient!(transport);
    const result = await contributed.audit!.list({
      limit: 5,
      tool: "shell",
      risk: "dangerous",
      policy: "confirm",
      since: "2026-05-01T00:00:00.000Z",
      session: "sess-1",
    });
    expect(result).toEqual({ entries: [] });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/audit?limit=5&tool=shell&risk=dangerous&policy=confirm&since=2026-05-01T00%3A00%3A00.000Z&session=sess-1",
      },
    ]);
  });

  it("the assembly path fails loudly when the guardrails-audit module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport({});
    // Other migrated namespaces are stubbed via the shared helper so the
    // only coverage gap is the audit namespace itself.
    const others = buildMigratedNamespaceTestStubs();
    delete others.audit;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /audit/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the guardrails-audit module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport({});
    const contributed = guardrailsAuditModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.audit;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
