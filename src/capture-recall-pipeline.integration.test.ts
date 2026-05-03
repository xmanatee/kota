/**
 * Cross-module integration test for the capture↔recall chain.
 *
 * Boots one in-process HTTP host that mounts the production
 * `createCaptureRouteHandler` and `createRecallRouteHandler` against a
 * shared `MemoryStore`, `KnowledgeStore`, repo-tasks queue root, and
 * inbox directory. Drives the full chain through the production
 * `DaemonControlClient.capture` and `DaemonControlClient.recall`, so the
 * test asserts the same wire shapes Telegram, web, macOS, mobile, and
 * Slack surfaces consume through `KotaClient.capture` /
 * `KotaClient.recall`.
 *
 * The capture side is built from the four real first-party contributors
 * (memory, knowledge, tasks, inbox); the recall side is built from the
 * four real recall contributors against the same backing stores plus a
 * minimal in-process history provider stub (history is never fed by
 * capture). Both providers run with `supportsSemanticSearch() === false`
 * so the test stays fully offline and exercises every contributor's
 * keyword-fallback path. The classifier is a deterministic in-process
 * stub.
 *
 * The chain assertions:
 *
 * - For `memory`, `knowledge`, `tasks`: capture writes a piece of
 *   content, then a content-derived recall query returns at least one
 *   hit whose `source` matches the capture target and whose typed
 *   identifier matches the just-written record.
 * - For `inbox`: capture writes the file, but the same content is *not*
 *   surfaced by recall — explicitly anchoring the
 *   capture-superset-of-recall invariant.
 * - The classifier `AMBIGUOUS` arm flows through unchanged on the same
 *   wire shape and writes nothing.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
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
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type {
  CaptureResult,
  RecallHit,
  RecallResult,
} from "#core/server/kota-client.js";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import {
  CAPTURE_TARGET_ORDER,
  type CaptureClassification,
  type CaptureClassifier,
  type CaptureProvider,
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
import {
  RECALL_SOURCE_ORDER,
  type RecallProvider,
} from "#modules/recall/recall-types.js";
import { createRecallRouteHandler } from "#modules/recall/routes.js";
import { RepoTasksDefaultStore } from "#modules/repo-tasks/repo-tasks-store.js";

/**
 * Per-target text fixtures. Each text is engineered to contain at least
 * one distinctive token (`xhighmnemo`, `kfallbacku`, `tunafishaudit`,
 * `capybarainbox`) that appears nowhere else, so a content-derived
 * recall query for that token can only match the source the text was
 * captured into. The recall queries below use those tokens directly.
 */
const MEMORY_TEXT =
  "Operator wants xhighmnemo decomposer default for autonomy steps.";
const MEMORY_QUERY = "xhighmnemo decomposer";

const KNOWLEDGE_TITLE = "Capture-recall round-trip notes";
const KNOWLEDGE_TEXT = `${KNOWLEDGE_TITLE}\nDocuments how kfallbacku flows across the seam end to end.`;
const KNOWLEDGE_QUERY = "kfallbacku seam";

const TASKS_TEXT = "Audit tunafishaudit pipeline coverage";
const TASKS_QUERY = "tunafishaudit pipeline";
const TASKS_EXPECTED_ID = "task-audit-tunafishaudit-pipeline-coverage";

const INBOX_TEXT = "Random capybarainbox note about telemetry";
const INBOX_QUERY = "capybarainbox telemetry";
const INBOX_EXPECTED_ID = "note-random-capybarainbox-note-about-telemetry";

const AMBIGUOUS_TEXT = "Schroedinger placeholder content awaiting routing";

function buildClassifier(): {
  classifier: CaptureClassifier;
  calls: Array<{ text: string }>;
} {
  const calls: Array<{ text: string }> = [];
  const classifier: CaptureClassifier = {
    async classify(input) {
      calls.push({ text: input.text });
      const result: CaptureClassification = { kind: "ambiguous" };
      return result;
    },
  };
  return { classifier, calls };
}

/**
 * Minimal in-process `HistoryProvider`. The recall pipeline only calls
 * `supportsSemanticSearch()` and `list({ search, limit })` on the history
 * provider; the rest of the interface throws so an unintended call
 * surfaces loudly rather than masquerading as empty.
 */
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
    semanticSearch: async (): Promise<ConversationRecord[]> => unused("semanticSearch"),
    reindex: async (): Promise<ReindexResult> => ({
      indexed: 0,
      failed: 0,
      skipped: true,
    }),
  };
}

type RouteSpec = {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
};

function startServer(
  specs: RouteSpec[],
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = req.url ?? "/";
      const pathname = url.split("?")[0] ?? "/";
      for (const spec of specs) {
        if (spec.method !== req.method) continue;
        if (spec.path !== pathname) continue;
        try {
          await spec.handler(req, res);
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
  const dir = mkdtempSync(join(tmpdir(), "kota-capture-recall-"));
  // git init so the tasks contributor's `git add` does not throw against a
  // non-repo (it swallows the failure either way, but keeping the env clean
  // matches the production flow).
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  mkdirSync(join(dir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  return dir;
}

type WriteSnapshot = {
  memory: number;
  knowledge: number;
  tasks: number;
  inbox: number;
};

function snapshotWrites(args: {
  memoryStore: MemoryStore;
  knowledgeStore: KnowledgeStore;
  projectRoot: string;
}): WriteSnapshot {
  const tasksDir = join(args.projectRoot, "data", "tasks", "backlog");
  const inboxDir = join(args.projectRoot, "data", "inbox");
  return {
    memory: args.memoryStore.list().length,
    knowledge: args.knowledgeStore.list().length,
    tasks: existsSync(tasksDir) ? readdirCount(tasksDir) : 0,
    inbox: existsSync(inboxDir) ? readdirCount(inboxDir) : 0,
  };
}

function readdirCount(dir: string): number {
  return readdirSync(dir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  ).length;
}

function findHit(hits: RecallHit[], source: RecallHit["source"], id: string): RecallHit | undefined {
  return hits.find((hit) => hit.source === source && hit.id === id);
}

describe("capture↔recall pipeline (HTTP)", () => {
  let projectRoot: string;
  let memoryStore: MemoryStore;
  let knowledgeStore: KnowledgeStore;
  let captureProvider: CaptureProvider;
  let recallProvider: RecallProvider;
  let classifierCalls: Array<{ text: string }>;
  let server: Server;
  let client: DaemonControlClient;

  beforeAll(async () => {
    projectRoot = makeProjectRoot();
    memoryStore = new MemoryStore(join(projectRoot, ".kota"));
    knowledgeStore = new KnowledgeStore(
      projectRoot,
      join(projectRoot, ".kota-global", "data"),
    );
    const tasksProvider = new RepoTasksDefaultStore(projectRoot);
    const historyProvider = createEmptyHistoryProvider();

    const { classifier, calls } = buildClassifier();
    classifierCalls = calls;

    const capture = new CaptureProviderImpl({ classifier });
    capture.register(createMemoryCaptureContributor(memoryStore));
    capture.register(createKnowledgeCaptureContributor(knowledgeStore));
    capture.register(createTasksCaptureContributor(projectRoot));
    capture.register(createInboxContributor(projectRoot));
    captureProvider = capture;

    // Register recall contributors in `RECALL_SOURCE_ORDER` so the
    // provider's registration-order surface lines up with the constant
    // every operator surface uses for tie-break and rendering.
    const recall = new RecallProviderImpl({ onContributorError: () => {} });
    recall.register(createKnowledgeRecallContributor(knowledgeStore));
    recall.register(createMemoryRecallContributor(memoryStore));
    recall.register(createTasksRecallContributor(tasksProvider));
    recall.register(createHistoryContributor(historyProvider));
    recallProvider = recall;

    const captureHandler = createCaptureRouteHandler(() => captureProvider);
    const recallHandler = createRecallRouteHandler(() => recallProvider);

    const started = await startServer([
      { method: "POST", path: "/capture", handler: captureHandler },
      { method: "POST", path: "/api/capture", handler: captureHandler },
      { method: "POST", path: "/recall", handler: recallHandler },
      { method: "POST", path: "/api/recall", handler: recallHandler },
    ]);
    server = started.server;
    client = DaemonControlClient.fromAddress(
      {
        port: started.port,
        pid: 0,
        startedAt: new Date().toISOString(),
        token: "",
      },
      buildMigratedNamespaceTestStubs(),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("registers all four capture contributors and the four raw-store recall contributors", () => {
    expect(captureProvider.contributors()).toEqual([...CAPTURE_TARGET_ORDER]);
    // This pipeline exercises the four raw-store recall contributors only;
    // the `answer`-source contributor is owned by the answer module and lives
    // in `RECALL_SOURCE_ORDER` for tie-break purposes but is not registered
    // by this fixture.
    expect(recallProvider.contributors()).toEqual(
      RECALL_SOURCE_ORDER.filter((s) => s !== "answer"),
    );
  });

  it("memory: capture writes through MemoryStore and recall surfaces the typed memory hit by content-derived query", async () => {
    const captureResult: CaptureResult = await client.capture.capture(
      MEMORY_TEXT,
      { target: "memory" },
    );
    expect(captureResult.ok).toBe(true);
    if (!captureResult.ok) throw new Error("expected ok:true");
    expect(captureResult.record.target).toBe("memory");
    if (captureResult.record.target !== "memory") throw new Error("unreachable");
    const memoryId = captureResult.record.recordId;

    const recallResult: RecallResult = await client.recall.recall(MEMORY_QUERY);
    expect(recallResult.ok).toBe(true);
    if (!recallResult.ok) throw new Error("expected ok:true");

    const hit = findHit(recallResult.hits, "memory", memoryId);
    expect(hit).toBeDefined();
    if (!hit || hit.source !== "memory") throw new Error("unreachable");
    expect(hit.id).toBe(memoryId);
    expect(hit.preview).toContain("xhighmnemo");
    expect(typeof hit.created).toBe("string");
  });

  it("knowledge: capture writes through KnowledgeStore and recall surfaces the typed knowledge hit by content-derived query", async () => {
    const captureResult = await client.capture.capture(KNOWLEDGE_TEXT, {
      target: "knowledge",
    });
    expect(captureResult.ok).toBe(true);
    if (!captureResult.ok) throw new Error("expected ok:true");
    expect(captureResult.record.target).toBe("knowledge");
    if (captureResult.record.target !== "knowledge") throw new Error("unreachable");
    const knowledgeId = captureResult.record.recordId;

    const recallResult = await client.recall.recall(KNOWLEDGE_QUERY);
    expect(recallResult.ok).toBe(true);
    if (!recallResult.ok) throw new Error("expected ok:true");

    const hit = findHit(recallResult.hits, "knowledge", knowledgeId);
    expect(hit).toBeDefined();
    if (!hit || hit.source !== "knowledge") throw new Error("unreachable");
    expect(hit.id).toBe(knowledgeId);
    expect(hit.title).toBe(KNOWLEDGE_TITLE);
    expect(hit.preview).toContain("kfallbacku");
  });

  it("tasks: capture mints a backlog task and recall surfaces the typed tasks hit by content-derived query", async () => {
    const captureResult = await client.capture.capture(TASKS_TEXT, {
      target: "tasks",
    });
    expect(captureResult.ok).toBe(true);
    if (!captureResult.ok) throw new Error("expected ok:true");
    expect(captureResult.record.target).toBe("tasks");
    if (captureResult.record.target !== "tasks") throw new Error("unreachable");
    expect(captureResult.record.recordId).toBe(TASKS_EXPECTED_ID);

    const recallResult = await client.recall.recall(TASKS_QUERY);
    expect(recallResult.ok).toBe(true);
    if (!recallResult.ok) throw new Error("expected ok:true");

    const hit = findHit(recallResult.hits, "tasks", TASKS_EXPECTED_ID);
    expect(hit).toBeDefined();
    if (!hit || hit.source !== "tasks") throw new Error("unreachable");
    expect(hit.id).toBe(TASKS_EXPECTED_ID);
    expect(hit.title).toBe(TASKS_TEXT);
    expect(hit.state).toBe("backlog");
  });

  it("inbox: capture writes the file, but the same content does not surface in any recall hit (capture-superset-of-recall invariant)", async () => {
    const captureResult = await client.capture.capture(INBOX_TEXT, {
      target: "inbox",
    });
    expect(captureResult.ok).toBe(true);
    if (!captureResult.ok) throw new Error("expected ok:true");
    expect(captureResult.record.target).toBe("inbox");
    if (captureResult.record.target !== "inbox") throw new Error("unreachable");
    expect(captureResult.record.recordId).toBe(INBOX_EXPECTED_ID);
    expect(
      existsSync(
        join(projectRoot, "data", "inbox", `${INBOX_EXPECTED_ID}.md`),
      ),
    ).toBe(true);

    const recallResult = await client.recall.recall(INBOX_QUERY);
    expect(recallResult.ok).toBe(true);
    if (!recallResult.ok) throw new Error("expected ok:true");

    // No recall hit may carry the inbox identifier (no `inbox` source
    // exists at all in `RecallSource`), and no hit's renderable text
    // (title/preview) may carry the distinctive inbox-only token.
    for (const hit of recallResult.hits) {
      expect(hit.id).not.toBe(INBOX_EXPECTED_ID);
      const haystack = renderableText(hit).toLowerCase();
      expect(haystack).not.toContain("capybarainbox");
    }
  });

  it("recall hit identifiers never duplicate across two different sources for the same captured payload", async () => {
    const recallResult = await client.recall.recall(MEMORY_QUERY);
    expect(recallResult.ok).toBe(true);
    if (!recallResult.ok) throw new Error("expected ok:true");
    const seen = new Map<string, RecallHit["source"]>();
    for (const hit of recallResult.hits) {
      const prior = seen.get(hit.id);
      if (prior !== undefined) {
        // The same id could legitimately appear in two stores, but a
        // single captured payload must not be returned under two
        // sources. The memory query's distinctive token only lives in
        // the memory store, so any duplicate id here would be the
        // exact drift this anchor catches.
        expect(prior).toBe(hit.source);
      }
      seen.set(hit.id, hit.source);
    }
  });

  it("ambiguous classifier reply: surfaces the typed ambiguous envelope and writes nothing to any store", async () => {
    const before = snapshotWrites({ memoryStore, knowledgeStore, projectRoot });
    const callsBefore = classifierCalls.length;

    const result = await client.capture.capture(AMBIGUOUS_TEXT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("ambiguous");
    if (result.reason !== "ambiguous") throw new Error("unreachable");
    expect([...result.suggestions]).toEqual([...CAPTURE_TARGET_ORDER]);

    expect(classifierCalls.length).toBe(callsBefore + 1);
    expect(classifierCalls[callsBefore]?.text).toBe(AMBIGUOUS_TEXT);

    const after = snapshotWrites({ memoryStore, knowledgeStore, projectRoot });
    expect(after).toEqual(before);
  });
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
