/**
 * Retract namespace daemon-side handler test.
 *
 * The retract namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the retract module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The retract module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `retract` namespace.
 *  2. `retract` is wired through the typed `DaemonTransport.requestStrict<T>`
 *     shape — calling `retract` issues `POST /retract` with the
 *     `RetractRequest` discriminated union as the JSON body.
 *  3. Every per-target arm of `RetractRequest` (memory, knowledge, tasks,
 *     inbox) threads through the wire body unchanged.
 *  4. Every `RetractResult` arm (ok-record per target, no_contributors,
 *     not_found, contributor_failed) decodes through `requestStrict<T>`
 *     unchanged.
 *  5. Removing the retract module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "retract" missing-handler
 *     error. This is the failure mode the namespace migration replaces:
 *     no silent fallback, no core-side stub.
 *  6. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { RetractRequest, RetractResult } from "./client.js";
import retractModule from "./index.js";

type RecordedCall = {
  method: string;
  path: string;
  body: unknown;
};

function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: unknown,
  ) => unknown,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ method, path, body });
      return responder(method, path, body) as T;
    },
    fetchRaw: async () => new Response(null, { status: 200 }),
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

describe("retract module daemonClient(link)", () => {
  it("contributes a retract namespace handler", () => {
    expect(retractModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = retractModule.daemonClient!(link);
    expect(contributed.retract).toBeDefined();
    expect(typeof contributed.retract!.retract).toBe("function");
  });

  it("routes a memory retract through POST /retract with the typed body", async () => {
    const memoryResult: RetractResult = {
      ok: true,
      record: { target: "memory", recordId: "mem-7" },
    };
    const { transport, calls } = makeRecordingTransport(() => memoryResult);
    const contributed = retractModule.daemonClient!(transport);
    const request: RetractRequest = { target: "memory", id: "mem-7" };
    const result = await contributed.retract!.retract(request);
    expect(result).toEqual(memoryResult);
    expect(calls).toEqual([
      { method: "POST", path: "/retract", body: request },
    ]);
  });

  it("threads the knowledge arm of RetractRequest through verbatim", async () => {
    const expected: RetractResult = {
      ok: true,
      record: { target: "knowledge", recordId: "discriminated-unions" },
    };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = retractModule.daemonClient!(transport);
    const request: RetractRequest = {
      target: "knowledge",
      slug: "discriminated-unions",
    };
    const result = await contributed.retract!.retract(request);
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      { method: "POST", path: "/retract", body: request },
    ]);
  });

  it("threads the tasks arm of RetractRequest through verbatim and decodes the moved-to-dropped record", async () => {
    const expected: RetractResult = {
      ok: true,
      record: {
        target: "tasks",
        recordId: "task-x",
        previousPath: "data/tasks/backlog/task-x.md",
        path: "data/tasks/dropped/task-x.md",
        toState: "dropped",
      },
    };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = retractModule.daemonClient!(transport);
    const request: RetractRequest = { target: "tasks", id: "task-x" };
    const result = await contributed.retract!.retract(request);
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      { method: "POST", path: "/retract", body: request },
    ]);
  });

  it("threads the inbox arm of RetractRequest through verbatim and decodes the unlinked-file record", async () => {
    const expected: RetractResult = {
      ok: true,
      record: {
        target: "inbox",
        recordId: "note-x",
        path: "data/inbox/note-x.md",
      },
    };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = retractModule.daemonClient!(transport);
    const request: RetractRequest = {
      target: "inbox",
      path: "data/inbox/note-x.md",
    };
    const result = await contributed.retract!.retract(request);
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      { method: "POST", path: "/retract", body: request },
    ]);
  });

  it("decodes the no_contributors envelope arm", async () => {
    const expected: RetractResult = { ok: false, reason: "no_contributors" };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = retractModule.daemonClient!(transport);
    const result = await contributed.retract!.retract({
      target: "memory",
      id: "anything",
    });
    expect(result).toEqual(expected);
  });

  it("decodes the not_found envelope arm", async () => {
    const expected: RetractResult = {
      ok: false,
      reason: "not_found",
      target: "memory",
      identifier: "missing-mem",
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = retractModule.daemonClient!(transport);
    const result = await contributed.retract!.retract({
      target: "memory",
      id: "missing-mem",
    });
    expect(result).toEqual(expected);
  });

  it("decodes the contributor_failed envelope arm", async () => {
    const expected: RetractResult = {
      ok: false,
      reason: "contributor_failed",
      target: "inbox",
      message: "disk read-only",
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = retractModule.daemonClient!(transport);
    const result = await contributed.retract!.retract({
      target: "inbox",
      path: "data/inbox/note-x.md",
    });
    expect(result).toEqual(expected);
  });

  it("the assembly path fails loudly when the retract module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.retract;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /retract/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the retract module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = retractModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.retract;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
