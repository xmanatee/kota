/**
 * Owner-questions namespace daemon-side handler test.
 *
 * The ownerQuestions namespace migrated out of
 * `buildCoreStubDaemonClientHandlers` into `daemonClient(link)` on the
 * owner-questions module. This test pins the invariants the migration
 * relies on:
 *
 *  1. The owner-questions module exposes a `daemonClient(link)` factory and
 *     the factory returns a handler for the `ownerQuestions` namespace.
 *  2. `list(filter?)` is wired through `requestStrict<T>` — calling `list`
 *     issues `GET /owner-questions` with the optional `?status=`
 *     query string byte-for-byte identical to today's
 *     `listOwnerQuestionsHttp` (no query when `filter?.status` is absent).
 *  3. `answer(id, answer)` issues `POST /owner-questions/:id/answer` with
 *     URL-encoded id segment and the JSON body `{ answer }`.
 *  4. `dismiss(id, reason?)` issues `POST /owner-questions/:id/dismiss`
 *     with URL-encoded id segment and a conditional JSON body — `{}` when
 *     `reason` is absent and `{ reason }` when present.
 *  5. A 404 from the route surfaces as `{ ok: false, reason: "not_found" }`
 *     for both mutations. Other non-OK statuses (5xx, 400) throw rather
 *     than silently coercing into `not_found`.
 *  6. A 200 response with body `{ question }` decodes to
 *     `{ ok: true, question }`.
 *  7. Removing the owner-questions module's daemonClient contribution
 *     makes the assembled client fail loudly with a clear "ownerQuestions"
 *     missing-handler error. This is the failure mode the namespace
 *     migration replaces: no silent fallback, no core-side stub.
 *  8. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { OwnerQuestionsListResult } from "./client.js";
import ownerQuestionsModule from "./index.js";

type RecordedRequestStrict = {
  kind: "requestStrict";
  method: string;
  path: string;
  body: unknown;
};

type RecordedFetchRaw = {
  kind: "fetchRaw";
  path: string;
  init: RequestInit | undefined;
};

type RecordedCall = RecordedRequestStrict | RecordedFetchRaw;

function makeRecordingTransport(options: {
  requestStrictResponder?: (
    method: string,
    path: string,
    body: unknown,
  ) => unknown;
  fetchRawResponder?: (path: string, init: RequestInit | undefined) => Response;
}): { transport: DaemonTransport; calls: RecordedCall[] } {
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
      calls.push({ kind: "requestStrict", method, path, body });
      if (!options.requestStrictResponder) {
        throw new Error("unexpected requestStrict call");
      }
      return options.requestStrictResponder(method, path, body) as T;
    },
    fetchRaw: async (path: string, init?: RequestInit): Promise<Response> => {
      calls.push({ kind: "fetchRaw", path, init });
      if (!options.fetchRawResponder) {
        throw new Error("unexpected fetchRaw call");
      }
      return options.fetchRawResponder(path, init);
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

function makeQuestion(id: string, status: PendingOwnerQuestion["status"] = "answered"): PendingOwnerQuestion {
  const base: PendingOwnerQuestion = {
    id,
    seq: 0,
    question: "Q?",
    context: "ctx",
    reason: "because",
    source: "agent",
    answerBehavior: "record-only",
    origin: { kind: "manual", source: "agent" },
    createdAt: "2026-05-03T00:00:00.000Z",
    status,
    resolvedAt: "2026-05-03T01:00:00.000Z",
    resolutionSource: "http",
  };
  if (status === "answered") base.answer = "A";
  if (status === "dismissed") base.dismissalReason = "no";
  return base;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("owner-questions module daemonClient(link)", () => {
  it("contributes an ownerQuestions namespace handler", () => {
    expect(ownerQuestionsModule.daemonClient).toBeTypeOf("function");
    const { transport } = makeRecordingTransport({});
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    expect(contributed.ownerQuestions).toBeDefined();
    expect(typeof contributed.ownerQuestions!.list).toBe("function");
    expect(typeof contributed.ownerQuestions!.answer).toBe("function");
    expect(typeof contributed.ownerQuestions!.dismiss).toBe("function");
  });

  it("routes list through GET /owner-questions with no query string when filter is absent", async () => {
    const expected: OwnerQuestionsListResult = { questions: [] };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    const result = await contributed.ownerQuestions!.list();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      { kind: "requestStrict", method: "GET", path: "/owner-questions", body: undefined },
    ]);
  });

  it("routes list through GET /owner-questions with ?status= when filter.status is present", async () => {
    const expected: OwnerQuestionsListResult = { questions: [] };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    await contributed.ownerQuestions!.list({ status: "all" });
    await contributed.ownerQuestions!.list({ status: "answered" });
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "GET",
        path: "/owner-questions?status=all",
        body: undefined,
      },
      {
        kind: "requestStrict",
        method: "GET",
        path: "/owner-questions?status=answered",
        body: undefined,
      },
    ]);
  });

  it("routes answer through POST /owner-questions/:id/answer with the typed body and URL-encoded id", async () => {
    const question = makeQuestion("q-7", "answered");
    const { transport, calls } = makeRecordingTransport({
      fetchRawResponder: () => jsonResponse(200, { question }),
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    const result = await contributed.ownerQuestions!.answer("q with/special", "the answer");
    expect(result).toEqual({ ok: true, question });
    expect(calls).toEqual([
      {
        kind: "fetchRaw",
        path: "/owner-questions/q%20with%2Fspecial/answer",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: "the answer" }),
        },
      },
    ]);
  });

  it("routes dismiss through POST /owner-questions/:id/dismiss with empty body when reason is absent", async () => {
    const question = makeQuestion("q-7", "dismissed");
    const { transport, calls } = makeRecordingTransport({
      fetchRawResponder: () => jsonResponse(200, { question }),
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    const result = await contributed.ownerQuestions!.dismiss("q-7");
    expect(result).toEqual({ ok: true, question });
    expect(calls).toEqual([
      {
        kind: "fetchRaw",
        path: "/owner-questions/q-7/dismiss",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      },
    ]);
  });

  it("routes dismiss with the conditional reason body when reason is present", async () => {
    const question = makeQuestion("q-7", "dismissed");
    const { transport, calls } = makeRecordingTransport({
      fetchRawResponder: () => jsonResponse(200, { question }),
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    await contributed.ownerQuestions!.dismiss("q with/special", "stale");
    expect(calls).toEqual([
      {
        kind: "fetchRaw",
        path: "/owner-questions/q%20with%2Fspecial/dismiss",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "stale" }),
        },
      },
    ]);
  });

  it("threads projectId through list, answer, and dismiss when provided", async () => {
    const question = makeQuestion("q-7", "answered");
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => ({ questions: [] }),
      fetchRawResponder: () => jsonResponse(200, { question }),
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    await contributed.ownerQuestions!.list({ status: "pending", projectId: "project-b" });
    await contributed.ownerQuestions!.answer("q-7", "yes", { projectId: "project-b" });
    await contributed.ownerQuestions!.dismiss("q-7", "done", { projectId: "project-b" });
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "GET",
        path: "/owner-questions?status=pending&projectId=project-b",
        body: undefined,
      },
      {
        kind: "fetchRaw",
        path: "/owner-questions/q-7/answer?projectId=project-b",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: "yes" }),
        },
      },
      {
        kind: "fetchRaw",
        path: "/owner-questions/q-7/dismiss?projectId=project-b",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "done" }),
        },
      },
    ]);
  });

  it("transforms a 404 from answer into { ok: false, reason: 'not_found' }", async () => {
    const { transport } = makeRecordingTransport({
      fetchRawResponder: () =>
        jsonResponse(404, { error: "Owner question not found or already resolved" }),
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    const result = await contributed.ownerQuestions!.answer("missing", "x");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("throws the typed unknown-project error from answer instead of returning not_found", async () => {
    const { transport } = makeRecordingTransport({
      fetchRawResponder: () =>
        jsonResponse(404, {
          error: "Unknown project",
          reason: "unknown_project",
          projectId: "missing-project",
        }),
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    await expect(
      contributed.ownerQuestions!.answer("q-7", "x", {
        projectId: "missing-project",
      }),
    ).rejects.toThrow(/Unknown project: missing-project/);
  });

  it("transforms a 404 from dismiss into { ok: false, reason: 'not_found' }", async () => {
    const { transport } = makeRecordingTransport({
      fetchRawResponder: () =>
        jsonResponse(404, { error: "Owner question not found or already resolved" }),
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    const result = await contributed.ownerQuestions!.dismiss("missing");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("throws on a 500 from answer rather than masquerading as not_found", async () => {
    const { transport } = makeRecordingTransport({
      fetchRawResponder: () => jsonResponse(500, { error: "boom" }),
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    await expect(contributed.ownerQuestions!.answer("id", "x")).rejects.toThrow(
      /boom/,
    );
  });

  it("throws on a 400 from dismiss rather than masquerading as not_found", async () => {
    const { transport } = makeRecordingTransport({
      fetchRawResponder: () => jsonResponse(400, { error: "bad input" }),
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    await expect(contributed.ownerQuestions!.dismiss("id")).rejects.toThrow(
      /bad input/,
    );
  });

  it("propagates list HTTP failures rather than silently returning an empty list", async () => {
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => {
        throw new Error("boom");
      },
    });
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    await expect(contributed.ownerQuestions!.list()).rejects.toThrow(/boom/);
  });

  it("the assembly path fails loudly when the owner-questions module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport({});
    const others = buildMigratedNamespaceTestStubs();
    delete others.ownerQuestions;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /ownerQuestions/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the owner-questions module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport({});
    const contributed = ownerQuestionsModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.ownerQuestions;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
