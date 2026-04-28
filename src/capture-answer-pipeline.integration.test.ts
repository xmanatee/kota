/**
 * Cross-module integration test for the full
 * capture → recall → answer → answer-history chain.
 *
 * Boots one in-process HTTP host that mounts the production
 * `createCaptureRouteHandler`, `createRecallRouteHandler`,
 * `createAnswerRouteHandler`, and `createAnswerHistoryRouteHandler`
 * factories against shared real `MemoryStore`, `KnowledgeStore`,
 * `RepoTasksDefaultStore`, a temp inbox directory, and a temp
 * answer-history root. Drives the chain through the production
 * `DaemonControlClient` so the test asserts the same wire shapes
 * Telegram, web, macOS, mobile, and Slack surfaces consume through
 * `KotaClient.{capture,recall,answer,answerHistory}`.
 *
 * The capture side is built from the four real first-party contributors
 * (memory, knowledge, tasks, inbox); the recall side is built from the
 * four real recall contributors against the same backing stores plus a
 * minimal in-process history provider stub. Both providers run with
 * `supportsSemanticSearch() === false` so the test stays offline and
 * exercises every contributor's keyword-fallback path. The answer
 * provider's `AnswerRecallSeam` calls the recall route over the same
 * in-process HTTP host, so a drift between recall's response shape and
 * the answer seam's recall consumption fails this test. The
 * answer-history side uses the production `DiskAnswerHistoryStore`.
 * The classifier and synthesizer are deterministic in-process stubs.
 *
 * The chain assertions:
 *
 * - For `memory`, `knowledge`, `tasks`: capture writes content, then a
 *   content-derived `client.answer.answer(...)` returns `ok: true` whose
 *   citations include the just-written record under the matching source,
 *   and `client.answer.show(...)` returns a record whose citations match
 *   `AnswerResult.citations` exactly (same source, same id, same order).
 * - For `inbox`: capture writes the file but the same content is *not*
 *   citable; the answer call returns `no_hits` (no `inbox` source exists
 *   in `RecallSource`), and no prior history record carries the inbox
 *   token in any recall hit or any citation.
 * - The classifier `AMBIGUOUS` arm flows through unchanged on the
 *   capture wire and writes nothing to answer-history (no answer asked).
 * - The synthesizer failure arm produces `synthesis_failed` after one
 *   retry and appends exactly one failure history record.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ConversationData,
  ConversationMessage,
  ConversationRecord,
  HistoryProvider,
  ReindexResult,
} from "#core/modules/provider-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import type { RecallHit } from "#core/server/kota-client.js";
import {
  type AnswerHistorySink,
  answerHistoryRootForProject,
  DiskAnswerHistoryStore,
} from "#modules/answer/answer-history-store.js";
import { AnswerProviderImpl } from "#modules/answer/answer-provider.js";
import type {
  AnswerRecallSeam,
  Synthesizer,
} from "#modules/answer/answer-types.js";
import {
  createAnswerHistoryRouteHandler,
  createAnswerRouteHandler,
} from "#modules/answer/routes.js";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import type {
  CaptureClassification,
  CaptureClassifier,
} from "#modules/capture/capture-types.js";
import {
  createInboxContributor,
  createKnowledgeContributor as createKnowledgeCaptureContributor,
  createMemoryContributor as createMemoryCaptureContributor,
  createTasksContributor as createTasksCaptureContributor,
} from "#modules/capture/contributors.js";
import { createCaptureRouteHandler } from "#modules/capture/routes.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import {
  createHistoryContributor,
  createKnowledgeContributor as createKnowledgeRecallContributor,
  createMemoryContributor as createMemoryRecallContributor,
  createTasksContributor as createTasksRecallContributor,
} from "#modules/recall/contributors.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import { createRecallRouteHandler } from "#modules/recall/routes.js";
import { RepoTasksDefaultStore } from "#modules/repo-tasks/repo-tasks-store.js";

/**
 * Per-target text fixtures. Each text carries one distinctive nonsense
 * token (`xhighmnemo`, `kfallbacku`, `tunafishaudit`, `capybarainbox`)
 * that appears in exactly one captured payload. The recall queries
 * below use those tokens directly, so a content-derived recall query
 * surfaces only the just-captured record under exactly one source.
 */
const MEMORY_TEXT =
  "Operator pinned xhighmnemo as the autonomy decomposer default.";
const MEMORY_QUERY = "xhighmnemo";

const KNOWLEDGE_TITLE = "Capture-answer round-trip notes";
const KNOWLEDGE_TEXT = `${KNOWLEDGE_TITLE}\nDocuments how kfallbacku flows across the seams end to end.`;
const KNOWLEDGE_QUERY = "kfallbacku";

const TASKS_TEXT = "Audit tunafishaudit pipeline coverage";
const TASKS_QUERY = "tunafishaudit";
const TASKS_EXPECTED_ID = "task-audit-tunafishaudit-pipeline-coverage";

const INBOX_TEXT = "Random capybarainbox note about telemetry";
const INBOX_QUERY = "capybarainbox";
const INBOX_EXPECTED_ID = "note-random-capybarainbox-note-about-telemetry";

const AMBIGUOUS_TEXT = "Schroedinger placeholder content awaiting routing";
const SYNTHESIS_FAILURE_QUERY = "xhighmnemo synthesis failure path probe";

function createEmptyHistoryProvider(): HistoryProvider {
  const unused = (name: string): never => {
    throw new Error(`history provider ${name}() is not used in this test`);
  };
  return {
    create: (_model: string, _cwd: string): string => unused("create"),
    save: (
      _id: string,
      _messages: ConversationMessage[],
      _compactionCount: number,
      _lastInputTokens: number,
    ): void => unused("save"),
    load: (_id: string): ConversationData | null => null,
    list: (_opts?: {
      search?: string;
      limit?: number;
      cwd?: string;
      source?: "user" | "action";
    }): ConversationRecord[] => [],
    getMostRecent: (_cwd?: string): ConversationRecord | null => null,
    findByPrefix: (_idOrPrefix: string): ConversationRecord | null => null,
    remove: (_id: string): boolean => false,
    cleanup: (): number => 0,
    supportsSemanticSearch: (): boolean => false,
    semanticSearch: async (): Promise<ConversationRecord[]> =>
      unused("semanticSearch"),
    reindex: async (): Promise<ReindexResult> => ({
      indexed: 0,
      failed: 0,
      skipped: true,
    }),
  };
}

type RouteSpec = {
  method: string;
  match: (path: string) => boolean;
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    params: { id?: string },
  ) => Promise<void> | void;
};

function startServer(
  specs: RouteSpec[],
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const showRe = /^\/answers\/([^/]+)$/;
    const server = createServer(async (req, res) => {
      const url = req.url ?? "/";
      const pathname = url.split("?")[0] ?? "/";
      const showMatch = showRe.exec(pathname);
      const params: { id?: string } = showMatch
        ? { id: decodeURIComponent(showMatch[1] ?? "") }
        : {};
      for (const spec of specs) {
        if (spec.method !== req.method) continue;
        if (!spec.match(pathname)) continue;
        try {
          await spec.handler(req, res, params);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            );
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

function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-capture-answer-"));
  // git init so the tasks contributor's `git add` does not throw against
  // a non-repo (the contributor swallows that failure either way, but a
  // clean env keeps the surface honest).
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  mkdirSync(join(dir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  return dir;
}

describe("capture → recall → answer → answer-history pipeline (HTTP)", () => {
  let projectRoot: string;
  let server: Server;
  let client: DaemonControlClient;
  let history: DiskAnswerHistoryStore;
  let synthesisCalls: Array<{ query: string; retry: boolean; hitsCount: number }>;

  beforeAll(async () => {
    projectRoot = makeProjectRoot();
    const memoryStore = new MemoryStore(join(projectRoot, ".kota"));
    const knowledgeStore = new KnowledgeStore(
      projectRoot,
      join(projectRoot, ".kota-global", "data"),
    );
    const tasksProvider = new RepoTasksDefaultStore(projectRoot);
    const historyProvider = createEmptyHistoryProvider();
    history = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForProject(projectRoot),
    });

    const classifier: CaptureClassifier = {
      async classify(): Promise<CaptureClassification> {
        // Always ambiguous — the success captures use explicit `target`
        // and bypass the classifier; the unguided test asserts the
        // ambiguous envelope.
        return { kind: "ambiguous" };
      },
    };
    const captureProvider = new CaptureProviderImpl({ classifier });
    captureProvider.register(createMemoryCaptureContributor(memoryStore));
    captureProvider.register(createKnowledgeCaptureContributor(knowledgeStore));
    captureProvider.register(createTasksCaptureContributor(projectRoot));
    captureProvider.register(createInboxContributor(projectRoot));

    const recallProvider = new RecallProviderImpl({
      onContributorError: () => {},
    });
    recallProvider.register(createKnowledgeRecallContributor(knowledgeStore));
    recallProvider.register(createMemoryRecallContributor(memoryStore));
    recallProvider.register(createTasksRecallContributor(tasksProvider));
    recallProvider.register(createHistoryContributor(historyProvider));

    synthesisCalls = [];
    const synthesizer: Synthesizer = async ({ query, hits, retry }) => {
      synthesisCalls.push({ query, retry, hitsCount: hits.length });
      if (query === SYNTHESIS_FAILURE_QUERY) {
        return retry
          ? "Retry still has [knowledge:never-existed]."
          : "Marker pretender [knowledge:bogus].";
      }
      if (hits.length === 0) {
        throw new Error("synthesizer reached without hits");
      }
      // Cite the top hit verbatim — the content-derived query pins the
      // top hit to the just-captured record because each query token
      // appears in exactly one captured payload. A drift in the chain
      // surfaces here as either a wrong top hit or a citation parser
      // mismatch against the recall hit's `{source, id}`.
      const top = hits[0];
      return `Composed answer for "${query}" cites [${top.source}:${top.id}].`;
    };

    // The answer recall seam reuses the production daemon client so the
    // recall response shape round-trips through HTTP. A drift in the
    // recall route's wire shape immediately breaks the chain.
    let recallSeam: AnswerRecallSeam | null = null;
    const answerProvider = new AnswerProviderImpl({
      recall: {
        async recall(query, filter) {
          if (!recallSeam) throw new Error("recall seam not yet wired");
          return recallSeam.recall(query, filter);
        },
      },
      synthesizer,
      history: history satisfies AnswerHistorySink,
    });

    const captureHandler = createCaptureRouteHandler(() => captureProvider);
    const recallHandler = createRecallRouteHandler(() => recallProvider);
    const answerHandler = createAnswerRouteHandler(() => answerProvider);
    const historyHandlers = createAnswerHistoryRouteHandler(() => history);

    const showRe = /^\/answers\/([^/]+)$/;
    const started = await startServer([
      { method: "POST", match: (p) => p === "/capture", handler: captureHandler },
      { method: "POST", match: (p) => p === "/recall", handler: recallHandler },
      { method: "POST", match: (p) => p === "/answer", handler: answerHandler },
      {
        method: "GET",
        match: (p) => p === "/answers",
        handler: (req, res) => historyHandlers.list(req, res),
      },
      {
        method: "GET",
        match: (p) => showRe.test(p),
        handler: async (_req, res, params) =>
          historyHandlers.showById(params.id ?? "", res),
      },
    ]);
    server = started.server;
    client = DaemonControlClient.fromAddress({
      port: started.port,
      pid: 0,
      startedAt: new Date().toISOString(),
      token: "",
    });
    recallSeam = {
      async recall(query, filter) {
        return client.recall.recall(query, filter);
      },
    };
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("memory: capture writes through MemoryStore and a content-derived answer cites the just-written memory record; the answer-history record matches", async () => {
    const beforeCount = (await client.answer.log({ limit: 200 })).entries.length;
    const captureResult = await client.capture.capture(MEMORY_TEXT, {
      target: "memory",
    });
    expect(captureResult.ok).toBe(true);
    if (!captureResult.ok) throw new Error("expected ok:true");
    if (captureResult.record.target !== "memory") throw new Error("unreachable");
    const memoryId = captureResult.record.recordId;

    await assertCitedAnswer({
      query: MEMORY_QUERY,
      expected: { source: "memory", id: memoryId },
      beforeCount,
    });
  });

  it("knowledge: capture writes through KnowledgeStore and a content-derived answer cites the just-written knowledge record; the answer-history record matches", async () => {
    const beforeCount = (await client.answer.log({ limit: 200 })).entries.length;
    const captureResult = await client.capture.capture(KNOWLEDGE_TEXT, {
      target: "knowledge",
    });
    expect(captureResult.ok).toBe(true);
    if (!captureResult.ok) throw new Error("expected ok:true");
    if (captureResult.record.target !== "knowledge") throw new Error("unreachable");
    const knowledgeId = captureResult.record.recordId;

    await assertCitedAnswer({
      query: KNOWLEDGE_QUERY,
      expected: { source: "knowledge", id: knowledgeId },
      beforeCount,
    });
  });

  it("tasks: capture mints a backlog task and a content-derived answer cites the just-written tasks record; the answer-history record matches", async () => {
    const beforeCount = (await client.answer.log({ limit: 200 })).entries.length;
    const captureResult = await client.capture.capture(TASKS_TEXT, {
      target: "tasks",
    });
    expect(captureResult.ok).toBe(true);
    if (!captureResult.ok) throw new Error("expected ok:true");
    if (captureResult.record.target !== "tasks") throw new Error("unreachable");
    expect(captureResult.record.recordId).toBe(TASKS_EXPECTED_ID);

    await assertCitedAnswer({
      query: TASKS_QUERY,
      expected: { source: "tasks", id: TASKS_EXPECTED_ID },
      beforeCount,
    });
  });

  it("inbox: capture writes the file, but a content-derived answer returns no_hits and no prior citation surfaces the inbox token (capture-superset-of-recall propagates into the cited-answer seam)", async () => {
    const captureResult = await client.capture.capture(INBOX_TEXT, {
      target: "inbox",
    });
    expect(captureResult.ok).toBe(true);
    if (!captureResult.ok) throw new Error("expected ok:true");
    if (captureResult.record.target !== "inbox") throw new Error("unreachable");
    expect(captureResult.record.recordId).toBe(INBOX_EXPECTED_ID);
    expect(
      existsSync(
        join(projectRoot, "data", "inbox", `${INBOX_EXPECTED_ID}.md`),
      ),
    ).toBe(true);

    const result = await client.answer.answer(INBOX_QUERY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("no_hits");

    // Sweep every prior history record. No recall hit's renderable text
    // and no citation may carry the inbox token under any source — a
    // citation that did would be the exact drift this anchor catches.
    const log = await client.answer.log({ limit: 200 });
    for (const entry of log.entries) {
      const show = await client.answer.show(entry.id);
      if (!show.ok) continue;
      const record = show.record;
      for (const hit of record.recallHits) {
        expect(renderableText(hit).toLowerCase()).not.toContain(INBOX_QUERY);
        expect(hit.id).not.toBe(INBOX_EXPECTED_ID);
      }
      if (record.result.ok) {
        for (const citation of record.result.citations) {
          expect(citation.id).not.toBe(INBOX_EXPECTED_ID);
        }
      }
    }
  });

  it("classifier AMBIGUOUS arm: capture surfaces the typed ambiguous envelope and writes nothing to answer-history (no answer is asked)", async () => {
    const before = await client.answer.log({ limit: 200 });
    const result = await client.capture.capture(AMBIGUOUS_TEXT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("ambiguous");

    const after = await client.answer.log({ limit: 200 });
    expect(after.entries.length).toBe(before.entries.length);
  });

  it("synthesizer failure arm: malformed citations after one retry surface synthesis_failed and append exactly one failure history record", async () => {
    const before = await client.answer.log({ limit: 200 });
    const beforeSynth = synthesisCalls.length;
    const result = await client.answer.answer(SYNTHESIS_FAILURE_QUERY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("synthesis_failed");

    const newSynth = synthesisCalls.slice(beforeSynth);
    expect(newSynth).toHaveLength(2);
    expect(newSynth[0]?.retry).toBe(false);
    expect(newSynth[1]?.retry).toBe(true);

    const after = await client.answer.log({ limit: 200 });
    expect(after.entries.length).toBe(before.entries.length + 1);
    const newest = after.entries[0];
    expect(newest?.query).toBe(SYNTHESIS_FAILURE_QUERY);
    if (!newest || newest.result.ok) {
      throw new Error("expected newest list entry ok:false");
    }
    expect(newest.result.reason).toBe("synthesis_failed");
  });

  async function assertCitedAnswer(args: {
    query: string;
    expected: { source: RecallHit["source"]; id: string };
    beforeCount: number;
  }): Promise<void> {
    const result = await client.answer.answer(args.query);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.citations.length).toBeGreaterThan(0);

    const cited = result.citations.find(
      (c) => c.source === args.expected.source && c.id === args.expected.id,
    );
    expect(cited).toBeDefined();

    const hit = result.hits.find(
      (h) => h.source === args.expected.source && h.id === args.expected.id,
    );
    expect(hit).toBeDefined();

    const after = await client.answer.log({ limit: 200 });
    expect(after.entries.length).toBe(args.beforeCount + 1);
    const newest = after.entries[0];
    expect(newest?.query).toBe(args.query);
    if (!newest?.result.ok) throw new Error("expected newest list entry ok:true");
    expect(newest.result.citationCount).toBe(result.citations.length);

    const show = await client.answer.show(newest.id);
    expect(show.ok).toBe(true);
    if (!show.ok) throw new Error("expected show ok:true");
    const record = show.record;
    expect(record.query).toBe(args.query);
    if (!record.result.ok) throw new Error("expected record ok:true");
    // Citations match exactly: same source, same id, same ordering.
    expect(record.result.citations).toEqual(result.citations);
  }
});

function renderableText(hit: RecallHit): string {
  switch (hit.source) {
    case "knowledge":
      return `${hit.title} ${hit.preview}`;
    case "memory":
      return hit.preview;
    case "history":
      return `${hit.title} ${hit.cwd}`;
    case "tasks":
      return hit.title;
    case "answer":
      return `${hit.query} ${hit.preview}`;
  }
}
