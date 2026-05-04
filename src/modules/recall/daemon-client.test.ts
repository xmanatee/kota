/**
 * Recall namespace daemon-side handler test.
 *
 * The recall namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the recall module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The recall module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `recall` namespace.
 *  2. `recall` is wired through the typed `DaemonTransport.requestStrict<T>`
 *     shape — calling `recall` issues `POST /recall` with the
 *     `{ query, ...(filter && { filter }) }` JSON body the prior `recallHttp`
 *     emitted byte-for-byte.
 *  3. Every `RecallFilter` arm (no-filter, topK-only, minScore-only,
 *     sources-only, all-fields) threads through the wire body unchanged.
 *     When no filter is provided, `filter` is omitted entirely from the body
 *     so the daemon never sees a `filter: undefined` field.
 *  4. Every `RecallResult` arm decodes through `requestStrict<T>` unchanged,
 *     covering the `ok: true` arm with one `RecallHit` from each of the
 *     five `source` discriminants (knowledge / memory / history / tasks /
 *     answer — including a `RecallAnswerHit` with each of the three
 *     `ok: false` nested `result.reason` arms — `no_hits`,
 *     `semantic_unavailable`, `synthesis_failed`) plus the
 *     `ok: false; reason: "semantic_unavailable"` envelope arm.
 *  5. Removing the recall module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "recall" missing-handler
 *     error. This is the failure mode the namespace migration replaces:
 *     no silent fallback, no core-side stub.
 *  6. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { RecallResult } from "./client.js";
import recallModule from "./index.js";

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

describe("recall module daemonClient(link)", () => {
  it("contributes a recall namespace handler", () => {
    expect(recallModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = recallModule.daemonClient!(link);
    expect(contributed.recall).toBeDefined();
    expect(typeof contributed.recall!.recall).toBe("function");
  });

  it("routes through POST /recall with no filter and omits the filter field from the body", async () => {
    const expected: RecallResult = { ok: true, hits: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("query text");
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      { method: "POST", path: "/recall", body: { query: "query text" } },
    ]);
  });

  it("threads a topK-only filter through the wire body verbatim", async () => {
    const expected: RecallResult = { ok: true, hits: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("q", { topK: 5 });
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      { method: "POST", path: "/recall", body: { query: "q", filter: { topK: 5 } } },
    ]);
  });

  it("threads a minScore-only filter through the wire body verbatim", async () => {
    const expected: RecallResult = { ok: true, hits: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("q", { minScore: 0.42 });
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/recall",
        body: { query: "q", filter: { minScore: 0.42 } },
      },
    ]);
  });

  it("threads a sources-only filter through the wire body verbatim", async () => {
    const expected: RecallResult = { ok: true, hits: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("q", {
      sources: ["knowledge", "memory"],
    });
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/recall",
        body: { query: "q", filter: { sources: ["knowledge", "memory"] } },
      },
    ]);
  });

  it("threads an all-fields filter through the wire body verbatim", async () => {
    const expected: RecallResult = { ok: true, hits: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("q", {
      topK: 7,
      minScore: 0.1,
      sources: ["knowledge", "memory", "history", "tasks", "answer"],
    });
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/recall",
        body: {
          query: "q",
          filter: {
            topK: 7,
            minScore: 0.1,
            sources: ["knowledge", "memory", "history", "tasks", "answer"],
          },
        },
      },
    ]);
  });

  it("decodes an ok envelope with a knowledge RecallHit arm", async () => {
    const expected: RecallResult = {
      ok: true,
      hits: [
        {
          source: "knowledge",
          score: 0.9,
          id: "k1",
          title: "T",
          preview: "P",
          updated: "2026-05-04T00:00:00.000Z",
        },
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("knowledge probe");
    expect(result).toEqual(expected);
  });

  it("decodes an ok envelope with a memory RecallHit arm", async () => {
    const expected: RecallResult = {
      ok: true,
      hits: [
        {
          source: "memory",
          score: 0.7,
          id: "m1",
          preview: "remembered",
          created: "2026-05-04T00:00:00.000Z",
        },
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("memory probe");
    expect(result).toEqual(expected);
  });

  it("decodes an ok envelope with a history RecallHit arm", async () => {
    const expected: RecallResult = {
      ok: true,
      hits: [
        {
          source: "history",
          score: 0.5,
          id: "h1",
          title: "session",
          cwd: "/tmp",
          updatedAt: "2026-05-04T00:00:00.000Z",
        },
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("history probe");
    expect(result).toEqual(expected);
  });

  it("decodes an ok envelope with a tasks RecallHit arm", async () => {
    const expected: RecallResult = {
      ok: true,
      hits: [
        {
          source: "tasks",
          score: 0.4,
          id: "task-x",
          title: "Do the thing",
          state: "ready",
          priority: "p1",
          updatedAt: "2026-05-04T00:00:00.000Z",
        },
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("tasks probe");
    expect(result).toEqual(expected);
  });

  it("decodes an ok envelope with an answer RecallHit arm carrying ok:true result", async () => {
    const expected: RecallResult = {
      ok: true,
      hits: [
        {
          source: "answer",
          score: 0.3,
          id: "ans-1",
          query: "prior question",
          preview: "prior synthesized text",
          citationCount: 2,
          createdAt: "2026-05-04T00:00:00.000Z",
          result: { ok: true },
        },
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("answer probe");
    expect(result).toEqual(expected);
  });

  it("decodes an answer RecallHit arm with no_hits failure result", async () => {
    const expected: RecallResult = {
      ok: true,
      hits: [
        {
          source: "answer",
          score: 0.2,
          id: "ans-2",
          query: "another question",
          preview: "no_hits",
          citationCount: 0,
          createdAt: "2026-05-04T00:00:00.000Z",
          result: { ok: false, reason: "no_hits" },
        },
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("answer no_hits probe");
    expect(result).toEqual(expected);
  });

  it("decodes an answer RecallHit arm with semantic_unavailable failure result", async () => {
    const expected: RecallResult = {
      ok: true,
      hits: [
        {
          source: "answer",
          score: 0.1,
          id: "ans-3",
          query: "yet another",
          preview: "semantic_unavailable",
          citationCount: 0,
          createdAt: "2026-05-04T00:00:00.000Z",
          result: { ok: false, reason: "semantic_unavailable" },
        },
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("answer semantic_unavailable probe");
    expect(result).toEqual(expected);
  });

  it("decodes an answer RecallHit arm with synthesis_failed failure result", async () => {
    const expected: RecallResult = {
      ok: true,
      hits: [
        {
          source: "answer",
          score: 0.05,
          id: "ans-4",
          query: "fourth question",
          preview: "synthesis_failed",
          citationCount: 0,
          createdAt: "2026-05-04T00:00:00.000Z",
          result: { ok: false, reason: "synthesis_failed" },
        },
      ],
    };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("answer synthesis_failed probe");
    expect(result).toEqual(expected);
  });

  it("decodes the semantic_unavailable envelope arm", async () => {
    const expected: RecallResult = { ok: false, reason: "semantic_unavailable" };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = recallModule.daemonClient!(transport);
    const result = await contributed.recall!.recall("anything");
    expect(result).toEqual(expected);
  });

  it("the assembly path fails loudly when the recall module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.recall;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /recall/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the recall module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = recallModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.recall;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
