/**
 * Cross-module integration test for the cross-store retract seam.
 *
 * Boots a thin in-process HTTP host that mounts the same
 * `createRetractRouteHandler` factory the production daemon mounts twice
 * (`POST /retract` on the daemon-control surface and `POST /api/retract`
 * on the user-facing surface), then drives the pipeline through the
 * production `DaemonControlClient.retract` so the test asserts the same
 * `RetractResult` wire shape every operator surface consumes through
 * `KotaClient.retract`.
 *
 * The retract provider is built from the real `RetractProviderImpl` plus
 * the four real first-party contributors wired against in-process
 * `MemoryStore` and `KnowledgeStore` instances and a temp project root
 * for the tasks and inbox writers.
 *
 * The test also seeds memory and knowledge entries, runs a real
 * `RecallProviderImpl` over them before and after each retract, and
 * asserts the retracted record disappears from recall — proving the
 * read-side seam settles after a successful retract.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
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
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import {
  createKnowledgeContributor as createKnowledgeRecallContributor,
  createMemoryContributor as createMemoryRecallContributor,
} from "#modules/recall/contributors.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import { createNormalizedTask } from "#modules/repo-tasks/repo-tasks-operations.js";
import {
  createInboxContributor,
  createKnowledgeContributor,
  createMemoryContributor,
  createTasksContributor,
} from "#modules/retract/contributors.js";
import { RetractProviderImpl } from "#modules/retract/retract-provider.js";
import { createRetractRouteHandler } from "#modules/retract/routes.js";

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
  const dir = mkdtempSync(join(tmpdir(), "kota-retract-pipeline-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "test"', { cwd: dir });
  mkdirSync(join(dir, "data", "tasks", "backlog"), { recursive: true });
  mkdirSync(join(dir, "data", "tasks", "dropped"), { recursive: true });
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  return dir;
}

describe("cross-store retract pipeline (HTTP)", () => {
  let projectRoot: string;
  let memoryStore: MemoryStore;
  let knowledgeStore: KnowledgeStore;
  let recallProvider: RecallProviderImpl;
  let server: Server;
  let client: DaemonControlClient;

  let memId: string;
  let knowledgeSlug: string;
  let taskId: string;
  let inboxRepoRelPath: string;

  beforeAll(async () => {
    projectRoot = makeProjectRoot();
    memoryStore = new MemoryStore(join(projectRoot, ".kota"));
    knowledgeStore = new KnowledgeStore(
      projectRoot,
      join(projectRoot, ".kota-global", "data"),
    );

    // Seed one record per target.
    memId = memoryStore.save("user prefers green tea");
    knowledgeSlug = knowledgeStore.create({
      title: "Old design note",
      content: "Outdated reasoning the operator wants to retract.",
    });
    const taskCreate = createNormalizedTask(projectRoot, {
      title: "obsolete review macOS push permissions",
      priority: "p3",
      area: "uncategorized",
      state: "backlog",
      summary: "obsolete review macOS push permissions",
    });
    if (!taskCreate.ok) throw new Error("setup: createNormalizedTask failed");
    taskId = taskCreate.id;
    inboxRepoRelPath = "data/inbox/note-stale-thought.md";
    writeFileSync(
      join(projectRoot, inboxRepoRelPath),
      "stale thought\n",
      "utf-8",
    );

    const retractProvider = new RetractProviderImpl();
    retractProvider.register(createMemoryContributor(memoryStore));
    retractProvider.register(createKnowledgeContributor(knowledgeStore));
    retractProvider.register(createTasksContributor(projectRoot));
    retractProvider.register(createInboxContributor(projectRoot));

    recallProvider = new RecallProviderImpl();
    recallProvider.register(createMemoryRecallContributor(memoryStore));
    recallProvider.register(createKnowledgeRecallContributor(knowledgeStore));

    const handler = createRetractRouteHandler(() => retractProvider);
    const started = await startServer([
      { method: "POST", path: "/retract", handler },
      { method: "POST", path: "/api/retract", handler },
    ]);
    server = started.server;
    client = DaemonControlClient.fromAddress({
      port: started.port,
      pid: 0,
      startedAt: new Date().toISOString(),
      token: "",
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("memory arm: a retract removes the entry and recall no longer surfaces it", async () => {
    const beforeHits = await recallProvider.recall("green tea");
    expect(beforeHits.some((h) => h.source === "memory" && h.id === memId)).toBe(
      true,
    );

    const result = await client.retract.retract({
      target: "memory",
      id: memId,
    });
    expect(result).toEqual({
      ok: true,
      record: { target: "memory", recordId: memId },
    });

    const afterHits = await recallProvider.recall("green tea");
    expect(afterHits.some((h) => h.source === "memory" && h.id === memId)).toBe(
      false,
    );
  });

  it("knowledge arm: a retract removes the entry and recall no longer surfaces it", async () => {
    const beforeHits = await recallProvider.recall("Outdated reasoning");
    expect(
      beforeHits.some(
        (h) => h.source === "knowledge" && h.id === knowledgeSlug,
      ),
    ).toBe(true);

    const result = await client.retract.retract({
      target: "knowledge",
      slug: knowledgeSlug,
    });
    expect(result).toEqual({
      ok: true,
      record: { target: "knowledge", recordId: knowledgeSlug },
    });

    const afterHits = await recallProvider.recall("Outdated reasoning");
    expect(
      afterHits.some(
        (h) => h.source === "knowledge" && h.id === knowledgeSlug,
      ),
    ).toBe(false);
  });

  it("tasks arm: a retract routes through the state machine, file ends up under data/tasks/dropped/ with status: dropped frontmatter", async () => {
    const backlogPath = join(
      projectRoot,
      "data",
      "tasks",
      "backlog",
      `${taskId}.md`,
    );
    expect(existsSync(backlogPath)).toBe(true);

    const result = await client.retract.retract({
      target: "tasks",
      id: taskId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.record.target).toBe("tasks");
    if (result.record.target !== "tasks") throw new Error("unreachable");
    expect(result.record.recordId).toBe(taskId);
    expect(result.record.previousPath).toBe(`data/tasks/backlog/${taskId}.md`);
    expect(result.record.path).toBe(`data/tasks/dropped/${taskId}.md`);
    expect(result.record.toState).toBe("dropped");

    const droppedPath = join(
      projectRoot,
      "data",
      "tasks",
      "dropped",
      `${taskId}.md`,
    );
    // The file is moved, not deleted.
    expect(existsSync(backlogPath)).toBe(false);
    expect(existsSync(droppedPath)).toBe(true);
    const body = readFileSync(droppedPath, "utf-8");
    expect(body).toMatch(/status: dropped/);
    expect(body).not.toMatch(/status: backlog/);
  });

  it("inbox arm: a retract unlinks the file at the named path", async () => {
    const absolutePath = join(projectRoot, inboxRepoRelPath);
    expect(existsSync(absolutePath)).toBe(true);

    const result = await client.retract.retract({
      target: "inbox",
      path: inboxRepoRelPath,
    });
    expect(result).toEqual({
      ok: true,
      record: {
        target: "inbox",
        recordId: "note-stale-thought",
        path: inboxRepoRelPath,
      },
    });
    expect(existsSync(absolutePath)).toBe(false);
  });

  it("not_found arm: a retract against an unknown id surfaces the typed envelope and writes nothing", async () => {
    const result = await client.retract.retract({
      target: "memory",
      id: "definitely-not-a-real-id",
    });
    expect(result).toEqual({
      ok: false,
      reason: "not_found",
      target: "memory",
      identifier: "definitely-not-a-real-id",
    });
  });

  it("no_contributors arm: a retract against a target with no registered contributor surfaces the typed envelope", async () => {
    const emptyProvider = new RetractProviderImpl();
    const handler = createRetractRouteHandler(() => emptyProvider);
    const started = await startServer([
      { method: "POST", path: "/retract", handler },
    ]);
    const isolatedClient = DaemonControlClient.fromAddress({
      port: started.port,
      pid: 0,
      startedAt: new Date().toISOString(),
      token: "",
    });
    try {
      const result = await isolatedClient.retract.retract({
        target: "memory",
        id: "any",
      });
      expect(result).toEqual({ ok: false, reason: "no_contributors" });
    } finally {
      await new Promise<void>((resolve) =>
        started.server.close(() => resolve()),
      );
    }
  });
});
