/**
 * Cross-module integration test for the cross-store capture seam.
 *
 * Boots a thin in-process HTTP host that mounts the same
 * `createCaptureRouteHandler` factory the production daemon mounts twice
 * (`POST /capture` on the daemon-control surface and `POST /api/capture`
 * on the user-facing surface), then drives the pipeline through the
 * production `DaemonControlClient.capture` so the test asserts the same
 * `CaptureResult` wire shape Telegram, web, macOS, mobile, and Slack
 * surfaces consume through `KotaClient.capture`.
 *
 * The capture provider is built from the real `CaptureProviderImpl` plus
 * the four real first-party contributors (`createMemoryContributor`,
 * `createKnowledgeContributor`, `createTasksContributor`,
 * `createInboxContributor`) wired against in-process `MemoryStore` and
 * `KnowledgeStore` instances and a temp project root for the tasks and
 * inbox writers. The classifier is replaced with a deterministic
 * in-process stub that branches on the input text so one test instance
 * exercises both the confident-routing path and the ambiguous path
 * without calling a real model.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { CaptureResult } from "#core/server/kota-client.js";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import {
  CAPTURE_TARGET_ORDER,
  type CaptureClassification,
  type CaptureClassifier,
  type CaptureContributor,
  type CaptureProvider,
} from "#modules/capture/capture-types.js";
import {
  createInboxContributor,
  createKnowledgeContributor,
  createMemoryContributor,
  createTasksContributor,
} from "#modules/capture/contributors.js";
import { createCaptureRouteHandler } from "#modules/capture/routes.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";

/**
 * Per-target text fixtures. Each fixture's first line doubles as the
 * title for the contributors that derive a title (knowledge/tasks/inbox).
 * Slugs are stable so the inbox/tasks recordIds resolve to predictable
 * file paths for round-trip assertion.
 */
const MEMORY_TEXT =
  "remember to default to xhigh for autonomous decomposer steps";
const KNOWLEDGE_TEXT =
  "Capture seam invariants\nThe seam never silently retries a thrown contributor.";
const TASKS_TEXT =
  "audit capture pipeline integration coverage";
const INBOX_TEXT =
  "rough thought about capture telemetry";

/** Query strings the deterministic classifier branches on. */
const CONFIDENT_QUERY = "route this to memory please";
const AMBIGUOUS_QUERY = "totally unclear destination";

function buildClassifier(): {
  classifier: CaptureClassifier;
  calls: Array<{ text: string }>;
} {
  const calls: Array<{ text: string }> = [];
  const classifier: CaptureClassifier = {
    async classify(input) {
      calls.push({ text: input.text });
      let result: CaptureClassification;
      if (input.text === CONFIDENT_QUERY) {
        result = { kind: "confident", target: "memory" };
      } else if (input.text === AMBIGUOUS_QUERY) {
        result = { kind: "ambiguous" };
      } else {
        result = { kind: "ambiguous" };
      }
      return result;
    },
  };
  return { classifier, calls };
}

type RouteSpec = {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
};

function startServer(specs: RouteSpec[]): Promise<{ server: Server; port: number }> {
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
  const dir = mkdtempSync(join(tmpdir(), "kota-capture-pipeline-"));
  // git init so the tasks contributor's `git add` does not throw on a
  // non-repo, even though the contributor swallows that failure.
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  mkdirSync(join(dir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  return dir;
}

/** Snapshot of write counts across the four first-party stores. */
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
    tasks: existsSync(tasksDir)
      ? readdirCount(tasksDir)
      : 0,
    inbox: existsSync(inboxDir) ? readdirCount(inboxDir) : 0,
  };
}

function readdirCount(dir: string): number {
  return readdirSync(dir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  ).length;
}

describe("cross-store capture pipeline (HTTP)", () => {
  let projectRoot: string;
  let memoryStore: MemoryStore;
  let knowledgeStore: KnowledgeStore;
  let provider: CaptureProvider;
  let classifierCalls: Array<{ text: string }>;
  let server: Server;
  let baseUrl: string;
  let client: DaemonControlClient;

  beforeAll(async () => {
    projectRoot = makeProjectRoot();
    memoryStore = new MemoryStore(join(projectRoot, ".kota"));
    knowledgeStore = new KnowledgeStore(
      projectRoot,
      join(projectRoot, ".kota-global", "data"),
    );

    const { classifier, calls } = buildClassifier();
    classifierCalls = calls;

    const captureProvider = new CaptureProviderImpl({ classifier });
    captureProvider.register(createMemoryContributor(memoryStore));
    captureProvider.register(createKnowledgeContributor(knowledgeStore));
    captureProvider.register(createTasksContributor(projectRoot));
    captureProvider.register(createInboxContributor(projectRoot));
    provider = captureProvider;

    const handler = createCaptureRouteHandler(() => provider);
    const started = await startServer([
      { method: "POST", path: "/capture", handler },
      { method: "POST", path: "/api/capture", handler },
    ]);
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}`;
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

  it("registers exactly the four first-party contributors in CAPTURE_TARGET_ORDER", () => {
    expect(provider.contributors()).toEqual([...CAPTURE_TARGET_ORDER]);
  });

  it("memory arm: explicit target writes through MemoryProvider.save and the typed recordId resolves through MemoryStore.list", async () => {
    const result = await client.capture.capture(MEMORY_TEXT, {
      target: "memory",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.record.target).toBe("memory");
    if (result.record.target !== "memory") throw new Error("unreachable");
    expect(typeof result.record.recordId).toBe("string");
    expect(result.record.recordId.length).toBeGreaterThan(0);

    const persisted = memoryStore
      .list()
      .find((m) => m.id === result.record.recordId);
    expect(persisted).toBeDefined();
    expect(persisted?.content).toBe(MEMORY_TEXT);
  });

  it("knowledge arm: explicit target mints a slug recordId that resolves through KnowledgeProvider.read", async () => {
    const result = await client.capture.capture(KNOWLEDGE_TEXT, {
      target: "knowledge",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.record.target).toBe("knowledge");
    if (result.record.target !== "knowledge") throw new Error("unreachable");

    const entry = knowledgeStore.read(result.record.recordId);
    expect(entry).not.toBeNull();
    expect(entry?.title).toBe("Capture seam invariants");
    expect(entry?.content).toBe(KNOWLEDGE_TEXT);
  });

  it("tasks arm: explicit target mints a backlog file at the typed path", async () => {
    const result = await client.capture.capture(TASKS_TEXT, {
      target: "tasks",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.record.target).toBe("tasks");
    if (result.record.target !== "tasks") throw new Error("unreachable");
    expect(result.record.recordId).toBe(
      "task-audit-capture-pipeline-integration-coverage",
    );
    expect(result.record.path).toBe(
      `data/tasks/backlog/${result.record.recordId}.md`,
    );

    const filePath = join(projectRoot, result.record.path);
    expect(existsSync(filePath)).toBe(true);
    const body = readFileSync(filePath, "utf-8");
    expect(body).toMatch(new RegExp(`title: ${TASKS_TEXT}`));
    expect(body).toMatch(/status: backlog/);
  });

  it("inbox arm: explicit target writes a slugged note file at the typed path", async () => {
    const result = await client.capture.capture(INBOX_TEXT, {
      target: "inbox",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.record.target).toBe("inbox");
    if (result.record.target !== "inbox") throw new Error("unreachable");
    expect(result.record.recordId).toBe(
      "note-rough-thought-about-capture-telemetry",
    );
    expect(result.record.path).toBe(
      `data/inbox/${result.record.recordId}.md`,
    );

    const filePath = join(projectRoot, result.record.path);
    expect(existsSync(filePath)).toBe(true);
    const body = readFileSync(filePath, "utf-8");
    expect(body).toContain(INBOX_TEXT);
    expect(body.endsWith("\n")).toBe(true);
  });

  it("classifier confident reply routes the unguided call to the chosen contributor", async () => {
    const callsBefore = classifierCalls.length;
    const result = await client.capture.capture(CONFIDENT_QUERY);
    expect(classifierCalls.length).toBe(callsBefore + 1);
    expect(classifierCalls[callsBefore]?.text).toBe(CONFIDENT_QUERY);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.record.target).toBe("memory");
    if (result.record.target !== "memory") throw new Error("unreachable");

    const persisted = memoryStore
      .list()
      .find((m) => m.id === result.record.recordId);
    expect(persisted?.content).toBe(CONFIDENT_QUERY);
  });

  it("classifier ambiguous reply surfaces the typed ambiguous envelope with all four registered contributors and writes nothing", async () => {
    const before = snapshotWrites({ memoryStore, knowledgeStore, projectRoot });
    const result = await client.capture.capture(AMBIGUOUS_QUERY);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("ambiguous");
    if (result.reason !== "ambiguous") throw new Error("unreachable");
    expect([...result.suggestions]).toEqual([...CAPTURE_TARGET_ORDER]);

    const after = snapshotWrites({ memoryStore, knowledgeStore, projectRoot });
    expect(after).toEqual(before);
  });

  it("empty / whitespace-only text is rejected at the wire and writes nothing to any store", async () => {
    const before = snapshotWrites({ memoryStore, knowledgeStore, projectRoot });
    await expect(client.capture.capture("   \n\t  ")).rejects.toThrow(
      /text is required/,
    );
    const after = snapshotWrites({ memoryStore, knowledgeStore, projectRoot });
    expect(after).toEqual(before);
  });

  it("/api/capture returns byte-identical JSON to /capture for the same input, locking the twin-route contract", async () => {
    const body = JSON.stringify({
      text: "twin route equivalence probe",
      filter: { target: "memory" },
    });
    const headers = { "Content-Type": "application/json" };

    const controlRes = await fetch(`${baseUrl}/capture`, {
      method: "POST",
      headers,
      body,
    });
    const apiRes = await fetch(`${baseUrl}/api/capture`, {
      method: "POST",
      headers,
      body,
    });

    expect(controlRes.status).toBe(200);
    expect(apiRes.status).toBe(200);
    const controlText = await controlRes.text();
    const apiText = await apiRes.text();
    // Both calls are independent writes — the recordIds will differ. The
    // structural shape (and discriminator) must match byte-for-byte after
    // erasing the per-call recordId, so a regression that reshapes one
    // route handler's envelope without the other fails this assertion.
    const controlParsed = JSON.parse(controlText) as CaptureResult;
    const apiParsed = JSON.parse(apiText) as CaptureResult;
    expect(controlParsed.ok).toBe(true);
    expect(apiParsed.ok).toBe(true);
    if (!controlParsed.ok || !apiParsed.ok) throw new Error("unreachable");
    expect(controlParsed.record.target).toBe("memory");
    expect(apiParsed.record.target).toBe("memory");
    expect(Object.keys(controlParsed).sort()).toEqual(["ok", "record"]);
    expect(Object.keys(apiParsed).sort()).toEqual(["ok", "record"]);
    expect(Object.keys(controlParsed.record).sort()).toEqual(
      Object.keys(apiParsed.record).sort(),
    );

    // Same call, same envelope shape: when both invocations route to the
    // same handler factory, swapping the two parsed JSON bodies's recordId
    // fields must produce a deep-equal pair.
    if (
      controlParsed.record.target === "memory" &&
      apiParsed.record.target === "memory"
    ) {
      const erasedControl = { ...controlParsed.record, recordId: "X" };
      const erasedApi = { ...apiParsed.record, recordId: "X" };
      expect(erasedControl).toEqual(erasedApi);
    }
  });
});

describe("cross-store capture pipeline — contributor failure isolation", () => {
  let projectRoot: string;
  let memoryStore: MemoryStore;
  let knowledgeStore: KnowledgeStore;
  let provider: CaptureProvider;
  let server: Server;
  let client: DaemonControlClient;

  beforeAll(async () => {
    projectRoot = makeProjectRoot();
    memoryStore = new MemoryStore(join(projectRoot, ".kota"));
    knowledgeStore = new KnowledgeStore(
      projectRoot,
      join(projectRoot, ".kota-global", "data"),
    );

    const captureProvider = new CaptureProviderImpl();
    // A throwing memory contributor proves the seam never silently retries
    // into a different store. Other contributors are still registered so
    // we can assert their stores stay untouched after the failed capture.
    const throwingMemory: CaptureContributor = {
      target: "memory",
      async capture() {
        throw new Error("memory writer is offline");
      },
    };
    captureProvider.register(throwingMemory);
    captureProvider.register(createKnowledgeContributor(knowledgeStore));
    captureProvider.register(createTasksContributor(projectRoot));
    captureProvider.register(createInboxContributor(projectRoot));
    provider = captureProvider;

    const handler = createCaptureRouteHandler(() => provider);
    const started = await startServer([
      { method: "POST", path: "/capture", handler },
      { method: "POST", path: "/api/capture", handler },
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

  it("contributor_failed: the seam surfaces the typed failure envelope with the thrown message verbatim and writes nothing to any other store", async () => {
    const before = snapshotWrites({ memoryStore, knowledgeStore, projectRoot });
    const result = await client.capture.capture("anything", {
      target: "memory",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.reason).toBe("contributor_failed");
    if (result.reason !== "contributor_failed") throw new Error("unreachable");
    expect(result.target).toBe("memory");
    expect(result.message).toBe("memory writer is offline");

    const after = snapshotWrites({ memoryStore, knowledgeStore, projectRoot });
    expect(after).toEqual(before);
  });
});
