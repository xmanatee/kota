/**
 * Cross-module integration test for the recall + cited-answer + answer-history
 * pipeline.
 *
 * Boots a thin in-process daemon-control surface that wires the same
 * `createRecallRouteHandler`, `createAnswerRouteHandler`, and
 * `createAnswerHistoryRouteHandler` factories the production daemon mounts,
 * then drives the pipeline through the production `DaemonControlClient` so
 * the test asserts the same wire shapes Telegram, web, macOS, and mobile
 * surfaces consume through `KotaClient.recall` / `KotaClient.answer`.
 *
 * The recall side is fed by hand-crafted `RecallContributor`s — one per
 * `RecallSource` literal — with native scores designed so the global merge
 * pulls one hit from every source at the top tie and tie-breaks by
 * `RECALL_SOURCE_ORDER` then id. The answer side is fed by a deterministic
 * in-process synthesizer stub that switches behavior on the query string so
 * one test exercises both the success path and the retry-then-
 * `synthesis_failed` failure path without calling a real model.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import { daemonTransportFromAddress } from "#core/server/daemon-transport.js";
import {
  type AnswerHistorySink,
  answerHistoryRootForProject,
  DiskAnswerHistoryStore,
} from "#modules/answer/answer-history-store.js";
import { AnswerProviderImpl } from "#modules/answer/answer-provider.js";
import {
  ANSWER_MAX_CITATIONS,
  type AnswerRecallSeam,
  type SynthesisInput,
  type Synthesizer,
} from "#modules/answer/answer-types.js";
import type {
  AnswerHistoryRecord,
  AnswerResult,
} from "#modules/answer/client.js";
import answerModule from "#modules/answer/index.js";
import { createAnswerHistoryRouteHandler, createAnswerRouteHandler } from "#modules/answer/routes.js";
import type {
  RecallHit,
  RecallResult,
  RecallSource,
} from "#modules/recall/client.js";
import recallModule from "#modules/recall/index.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import {
  type RawRecallEntry,
  RECALL_SOURCE_ORDER,
  type RecallContributor,
} from "#modules/recall/recall-types.js";
import { createRecallRouteHandler } from "#modules/recall/routes.js";

/**
 * Hit pile per source. Native scores are picked so per-source min-max
 * normalization rescales them into `[0, 1]` and the top-ranked hit from each
 * source ties at `normalized === 1`. The deterministic tie-break then
 * follows `RECALL_SOURCE_ORDER` (knowledge → memory → tasks → history)
 * before falling through to id ASCII compare.
 */
const SEED_ENTRIES: RawRecallEntry[] = [
  {
    source: "knowledge",
    id: "k1",
    nativeScore: 10,
    payload: {
      title: "Recall design",
      preview: "Cross-store recall normalizes per-source scores once.",
      updated: "2026-04-26",
    },
  },
  {
    source: "knowledge",
    id: "k2",
    nativeScore: 4,
    payload: {
      title: "Recall fallback",
      preview: "Keyword fallback when semantic backends are unreachable.",
      updated: "2026-04-25",
    },
  },
  {
    source: "memory",
    id: "m1",
    nativeScore: 8,
    payload: {
      preview: "Owner asked the recall seam to surface every source literal.",
      created: "2026-04-24",
    },
  },
  {
    source: "history",
    id: "h1",
    nativeScore: 6,
    payload: {
      title: "Recall design review",
      cwd: "/work/kota",
      updatedAt: "2026-04-23",
    },
  },
  {
    source: "tasks",
    id: "task-recall-design",
    nativeScore: 12,
    payload: {
      title: "Build the recall seam",
      state: "done",
      priority: "p1",
      updatedAt: "2026-04-22",
    },
  },
  {
    source: "answer",
    id: "ans-recall-2026-04-21",
    nativeScore: 5,
    payload: {
      query: "How does the recall seam rank cross-store hits?",
      preview:
        "Recall normalizes each source's native scores once, merges contributors, and tie-breaks deterministically.",
      citationCount: 4,
      createdAt: "2026-04-21T00:00:00.000Z",
      result: { ok: true },
    },
  },
];

function seededContributor(source: RecallSource): RecallContributor {
  return {
    source,
    async recall(_query, { topK }) {
      const entries = SEED_ENTRIES.filter((entry) => entry.source === source);
      return entries.slice(0, topK);
    },
  };
}

const SUCCESS_QUERY = "How does the recall seam work across stores?";
const FAILURE_QUERY = "What does the citation parser ignore?";

const SUCCESS_ANSWER =
  "Recall normalizes each source's native scores once, merges every contributor, and tie-breaks deterministically [knowledge:k1] [memory:m1] [tasks:task-recall-design] [history:h1].";

/**
 * Deterministic synthesizer stand-in. Branches on the query string so one
 * test instance can exercise both the success path and the malformed-citation
 * retry path without rewiring the provider mid-test.
 */
function buildStubSynthesizer(): { synthesizer: Synthesizer; calls: SynthesisInput[] } {
  const calls: SynthesisInput[] = [];
  const synthesizer: Synthesizer = async (input) => {
    calls.push(input);
    if (input.query === FAILURE_QUERY) {
      // First call mixes a valid marker with an unresolvable one. The seam
      // must reject this — silently dropping unknown-marker tracking would
      // cause the answer to surface ok:true with the partial citation set
      // instead of triggering the documented retry.
      return input.retry
        ? "Still nothing useful here [knowledge:also-bogus]."
        : "Recall layout [knowledge:k1] plus a marker the parser must reject [knowledge:bogus].";
    }
    return SUCCESS_ANSWER;
  };
  return { synthesizer, calls };
}

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

type RouteSpec = {
  method: string;
  match: (path: string) => boolean;
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    captures: { id?: string },
  ) => Promise<void> | void;
};

function buildRouteSpecs(specs: {
  recall: RouteHandler;
  answer: RouteHandler;
  answerList: RouteHandler;
  answerShow: (id: string, res: ServerResponse) => Promise<void>;
}): RouteSpec[] {
  const showPattern = /^\/answers\/([^/]+)$/;
  return [
    { method: "POST", match: (p) => p === "/recall", handler: specs.recall },
    { method: "POST", match: (p) => p === "/answer", handler: specs.answer },
    { method: "GET", match: (p) => p === "/answers" || p.startsWith("/answers?"), handler: specs.answerList },
    {
      method: "GET",
      match: (p) => showPattern.test(p),
      handler: async (_req, res, captures) => {
        await specs.answerShow(decodeURIComponent(captures.id ?? ""), res);
      },
    },
  ];
}

function createPipelineServer(specs: RouteSpec[]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = req.url ?? "/";
      const pathname = url.split("?")[0] ?? "/";
      const showMatch = /^\/answers\/([^/]+)$/.exec(pathname);
      const captures: { id?: string } = showMatch ? { id: showMatch[1] } : {};
      for (const spec of specs) {
        if (spec.method !== req.method) continue;
        if (!spec.match(url) && !spec.match(pathname)) continue;
        try {
          await spec.handler(req, res, captures);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          }
        }
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

describe("recall + cited-answer + answer-history pipeline (HTTP)", () => {
  let projectStateRoot: string;
  let server: Server;
  let client: DaemonControlClient;
  let history: DiskAnswerHistoryStore;
  let synthesisCalls: SynthesisInput[];

  beforeAll(async () => {
    projectStateRoot = mkdtempSync(join(tmpdir(), "kota-recall-answer-"));
    history = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForProject(projectStateRoot),
    });

    const recallProvider = new RecallProviderImpl({
      onContributorError: () => {},
    });
    for (const source of RECALL_SOURCE_ORDER) {
      recallProvider.register(seededContributor(source));
    }

    const recallSeam: AnswerRecallSeam = {
      async recall(query, filter) {
        const hits = await recallProvider.recall(query, filter);
        return { ok: true, hits };
      },
    };

    const stub = buildStubSynthesizer();
    synthesisCalls = stub.calls;

    const answerProvider = new AnswerProviderImpl({
      recall: recallSeam,
      synthesizer: stub.synthesizer,
      history: history satisfies AnswerHistorySink,
    });

    const recallHandler = createRecallRouteHandler(() => recallProvider);
    const answerHandler = createAnswerRouteHandler(() => answerProvider);
    const historyHandlers = createAnswerHistoryRouteHandler(() => history);

    const routeSpecs = buildRouteSpecs({
      recall: recallHandler,
      answer: answerHandler,
      answerList: historyHandlers.list,
      answerShow: historyHandlers.showById,
    });

    const started = await createPipelineServer(routeSpecs);
    server = started.server;
    const transport = daemonTransportFromAddress({
      port: started.port,
      pid: 0,
      startedAt: new Date().toISOString(),
      token: "",
    });
    // Migrated namespaces normally land on the assembled client through their
    // owning module's `daemonClient(link)` factory. The pipeline test does not
    // load modules, so build the answer namespace handler against the test
    // transport explicitly and stub the rest.
    const otherMigratedStubs = buildMigratedNamespaceTestStubs();
    delete otherMigratedStubs.answer;
    delete otherMigratedStubs.recall;
    const answerDaemonHandler = answerModule.daemonClient!(transport);
    const recallDaemonHandler = recallModule.daemonClient!(transport);
    client = DaemonControlClient.fromTransport(transport, {
      ...otherMigratedStubs,
      ...answerDaemonHandler,
      ...recallDaemonHandler,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(projectStateRoot, { recursive: true, force: true });
  });

  it("recalls ranked, source-tagged hits with normalized scores and deterministic tie-break", async () => {
    const result = await client.recall.recall(SUCCESS_QUERY);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    const hits = result.hits;

    expect(hits.length).toBeGreaterThanOrEqual(RECALL_SOURCE_ORDER.length);

    const sources = new Set(hits.map((h) => h.source));
    for (const source of RECALL_SOURCE_ORDER) {
      expect(sources.has(source)).toBe(true);
    }

    for (const hit of hits) {
      expect(hit.score).toBeGreaterThanOrEqual(0);
      expect(hit.score).toBeLessThanOrEqual(1);
    }

    const topPerSource = new Map<RecallSource, RecallHit>();
    for (const hit of hits) {
      if (!topPerSource.has(hit.source)) topPerSource.set(hit.source, hit);
    }
    for (const source of RECALL_SOURCE_ORDER) {
      expect(topPerSource.get(source)?.score).toBe(1);
    }

    const topSourceOrder = hits.slice(0, RECALL_SOURCE_ORDER.length).map((h) => h.source);
    expect(topSourceOrder).toEqual([...RECALL_SOURCE_ORDER]);

    const knowledgeHit = hits.find((h) => h.source === "knowledge" && h.id === "k1");
    expect(knowledgeHit).toMatchObject({
      source: "knowledge",
      id: "k1",
      title: "Recall design",
    });
  });

  it("answers with cited synthesis, persists exactly one history record, and exposes it through KotaClient.answer.log/show", async () => {
    const beforeList = await client.answer.log();
    const startCount = beforeList.entries.length;

    const result = await client.answer.answer(SUCCESS_QUERY);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");

    expect(result.answer).toContain("[knowledge:k1]");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.length).toBeLessThanOrEqual(ANSWER_MAX_CITATIONS);

    const recallSourcePool = new Set<string>();
    const seenInResult = new Set<string>();
    for (const hit of result.hits) seenInResult.add(`${hit.source}:${hit.id}`);

    const recallEcho = await client.recall.recall(SUCCESS_QUERY);
    if (!recallEcho.ok) throw new Error("expected recall ok:true");
    for (const hit of recallEcho.hits) recallSourcePool.add(`${hit.source}:${hit.id}`);
    for (const cited of seenInResult) expect(recallSourcePool.has(cited)).toBe(true);

    for (const citation of result.citations) {
      expect(seenInResult.has(`${citation.source}:${citation.id}`)).toBe(true);
    }

    const afterList = await client.answer.log();
    expect(afterList.entries.length).toBe(startCount + 1);
    const newest = afterList.entries[0];
    expect(newest.query).toBe(SUCCESS_QUERY);
    expect(newest.result.ok).toBe(true);
    if (!newest.result.ok) throw new Error("expected list entry ok:true");
    expect(newest.result.citationCount).toBe(result.citations.length);

    const show = await client.answer.show(newest.id);
    expect(show.ok).toBe(true);
    if (!show.ok) throw new Error("expected show ok:true");
    const record: AnswerHistoryRecord = show.record;
    expect(record.query).toBe(SUCCESS_QUERY);
    expect(record.recallHits.length).toBeGreaterThanOrEqual(RECALL_SOURCE_ORDER.length);
    expect(record.result.ok).toBe(true);
    if (!record.result.ok) throw new Error("expected record ok:true");
    expect(record.result.citations).toEqual(result.citations);
  });

  it("returns synthesis_failed on unresolvable markers after one retry and still appends the failure record with the seen recall hits", async () => {
    const beforeList = await client.answer.log();
    const beforeCount = beforeList.entries.length;
    const beforeCalls = synthesisCalls.length;

    const result: AnswerResult = await client.answer.answer(FAILURE_QUERY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("synthesis_failed");

    const newCalls = synthesisCalls.length - beforeCalls;
    expect(newCalls).toBe(2);
    expect(synthesisCalls[beforeCalls].retry).toBe(false);
    expect(synthesisCalls[beforeCalls + 1].retry).toBe(true);

    const afterList = await client.answer.log();
    expect(afterList.entries.length).toBe(beforeCount + 1);
    const newest = afterList.entries[0];
    expect(newest.query).toBe(FAILURE_QUERY);
    expect(newest.result.ok).toBe(false);
    if (newest.result.ok) throw new Error("expected list entry ok:false");
    expect(newest.result.reason).toBe("synthesis_failed");

    const show = await client.answer.show(newest.id);
    expect(show.ok).toBe(true);
    if (!show.ok) throw new Error("expected show ok:true");
    const record = show.record;
    expect(record.query).toBe(FAILURE_QUERY);
    expect(record.result.ok).toBe(false);
    if (record.result.ok) throw new Error("expected record ok:false");
    expect(record.result.reason).toBe("synthesis_failed");
    expect(record.recallHits.length).toBeGreaterThanOrEqual(RECALL_SOURCE_ORDER.length);
    const seenSources = new Set(record.recallHits.map((h) => h.source));
    for (const source of RECALL_SOURCE_ORDER) {
      expect(seenSources.has(source)).toBe(true);
    }
  });

  it("returns ok:false reason:semantic_unavailable verbatim when no contributors are registered", async () => {
    const emptyProvider = new RecallProviderImpl({ onContributorError: () => {} });
    const handler = createRecallRouteHandler(() => emptyProvider);

    const oneShot = await new Promise<{ port: number; close: () => Promise<void> }>(
      (resolve) => {
        const srv = createServer((req, res) => {
          if (req.method === "POST" && (req.url ?? "") === "/recall") {
            void handler(req, res);
            return;
          }
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        });
        srv.listen(0, "127.0.0.1", () => {
          const addr = srv.address() as { port: number };
          resolve({
            port: addr.port,
            close: () => new Promise<void>((r) => srv.close(() => r())),
          });
        });
      },
    );

    try {
      const localClient = DaemonControlClient.fromAddress(
        {
          port: oneShot.port,
          pid: 0,
          startedAt: new Date().toISOString(),
          token: "",
        },
        buildMigratedNamespaceTestStubs(),
      );
      const result: RecallResult = await localClient.recall.recall("anything");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected ok:false");
      expect(result.reason).toBe("semantic_unavailable");
    } finally {
      await oneShot.close();
    }
  });
});
