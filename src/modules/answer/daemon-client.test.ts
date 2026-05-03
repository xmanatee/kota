/**
 * Answer namespace daemon-side handler test.
 *
 * The answer namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the answer module. This test pins the
 * invariants the migration relies on:
 *
 *  1. The answer module exposes a `daemonClient(link)` factory and the
 *     factory returns a handler for the `answer` namespace.
 *  2. `answer(query, filter?)` is wired through `DaemonTransport.requestStrict<T>` —
 *     calling `answer` issues `POST /answer` with the JSON body
 *     `{ query, ...(filter && { filter }) }` byte-for-byte.
 *  3. `log(filter?)` is wired through `requestStrict<T>` — calling `log`
 *     issues `GET /answers` with the URLSearchParams encoding for `limit`
 *     and `beforeId`. The empty-filter case omits the query string.
 *  4. `show(id)` is wired through `requestStrict<T>` — calling `show`
 *     issues `GET /answers/:id` with the id segment URL-encoded.
 *  5. `log` and `show` route the response through the migrated strict
 *     decoders — a malformed payload throws and a not_found envelope
 *     decodes correctly.
 *  6. Removing the answer module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "answer" missing-handler
 *     error. This is the failure mode the namespace migration replaces:
 *     no silent fallback, no core-side stub.
 *  7. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  AnswerHistoryListResult,
  AnswerHistoryRecord,
  AnswerResult,
} from "./client.js";
import answerModule from "./index.js";

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

describe("answer module daemonClient(link)", () => {
  it("contributes an answer namespace handler", () => {
    expect(answerModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => null).transport;
    const contributed = answerModule.daemonClient!(link);
    expect(contributed.answer).toBeDefined();
    expect(typeof contributed.answer!.answer).toBe("function");
    expect(typeof contributed.answer!.log).toBe("function");
    expect(typeof contributed.answer!.show).toBe("function");
  });

  it("routes answer through POST /answer with the typed body and no filter", async () => {
    const okResult: AnswerResult = { ok: false, reason: "no_hits" };
    const { transport, calls } = makeRecordingTransport(() => okResult);
    const contributed = answerModule.daemonClient!(transport);
    const result = await contributed.answer!.answer("what is recall?");
    expect(result).toEqual(okResult);
    expect(calls).toEqual([
      { method: "POST", path: "/answer", body: { query: "what is recall?" } },
    ]);
  });

  it("routes answer through POST /answer with filter when supplied", async () => {
    const okResult: AnswerResult = { ok: false, reason: "no_hits" };
    const { transport, calls } = makeRecordingTransport(() => okResult);
    const contributed = answerModule.daemonClient!(transport);
    const filter = { topK: 5, sources: ["memory" as const] };
    await contributed.answer!.answer("what is recall?", filter);
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/answer",
        body: { query: "what is recall?", filter },
      },
    ]);
  });

  it("routes log through GET /answers with no query string when filter is absent", async () => {
    const expected: AnswerHistoryListResult = { entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = answerModule.daemonClient!(transport);
    const result = await contributed.answer!.log();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      { method: "GET", path: "/answers", body: undefined },
    ]);
  });

  it("routes log through GET /answers with URLSearchParams for limit and beforeId", async () => {
    const expected: AnswerHistoryListResult = { entries: [] };
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = answerModule.daemonClient!(transport);
    await contributed.answer!.log({ limit: 5, beforeId: "abc" });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/answers?limit=5&beforeId=abc",
        body: undefined,
      },
    ]);
  });

  it("decodes a populated log response through the migrated decoder", async () => {
    const entry: AnswerHistoryListResult["entries"][number] = {
      id: "2026-05-03T08-00-00-000Z-aaaaaa",
      createdAt: "2026-05-03T08:00:00.000Z",
      query: "what is recall?",
      result: { ok: true, citationCount: 2 },
    };
    const expected: AnswerHistoryListResult = { entries: [entry] };
    const { transport } = makeRecordingTransport(() => expected);
    const contributed = answerModule.daemonClient!(transport);
    const result = await contributed.answer!.log();
    expect(result.entries).toEqual([entry]);
  });

  it("throws when log response is missing the entries array", async () => {
    const { transport } = makeRecordingTransport(() => ({}));
    const contributed = answerModule.daemonClient!(transport);
    await expect(contributed.answer!.log()).rejects.toThrow(
      /entries not an array/,
    );
  });

  it("throws when log entry is missing required fields", async () => {
    const malformed = { entries: [{ id: "x" }] };
    const { transport } = makeRecordingTransport(() => malformed);
    const contributed = answerModule.daemonClient!(transport);
    await expect(contributed.answer!.log()).rejects.toThrow(
      /missing createdAt/,
    );
  });

  it("URL-encodes the id segment when calling show", async () => {
    const expected = { ok: false, reason: "not_found" } as const;
    const { transport, calls } = makeRecordingTransport(() => expected);
    const contributed = answerModule.daemonClient!(transport);
    const result = await contributed.answer!.show("id with/special chars");
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/answers/id%20with%2Fspecial%20chars",
        body: undefined,
      },
    ]);
  });

  it("decodes a populated show response through the migrated decoder", async () => {
    const record: AnswerHistoryRecord = {
      id: "2026-05-03T08-00-00-000Z-aaaaaa",
      createdAt: "2026-05-03T08:00:00.000Z",
      query: "what is recall?",
      filter: {},
      recallHits: [],
      result: { ok: false, reason: "no_hits" },
    };
    const { transport } = makeRecordingTransport(() => ({
      ok: true,
      record,
    }));
    const contributed = answerModule.daemonClient!(transport);
    const result = await contributed.answer!.show(record.id);
    expect(result).toEqual({ ok: true, record });
  });

  it("throws when show payload has ok:true but missing record", async () => {
    const { transport } = makeRecordingTransport(() => ({ ok: true }));
    const contributed = answerModule.daemonClient!(transport);
    await expect(contributed.answer!.show("any")).rejects.toThrow(
      /missing record/,
    );
  });

  it("throws when show payload reason is unknown", async () => {
    const { transport } = makeRecordingTransport(() => ({
      ok: false,
      reason: "expired",
    }));
    const contributed = answerModule.daemonClient!(transport);
    await expect(contributed.answer!.show("any")).rejects.toThrow(
      /reason=expired/,
    );
  });

  it("the assembly path fails loudly when the answer module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => null);
    const others = buildMigratedNamespaceTestStubs();
    delete others.answer;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /answer/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the answer module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => null);
    const contributed = answerModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.answer;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
