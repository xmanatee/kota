import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskBodyUpdate, handleTaskCreate, handleTaskStateChange, handleTaskStatus } from "./task-routes.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-task-routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTaskFile(
  projectDir: string,
  state: string,
  slug: string,
  frontmatter: Record<string, string>,
): void {
  const dir = join(projectDir, "tasks", state);
  mkdirSync(dir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  writeFileSync(join(dir, `task-${slug}.md`), `---\n${fm}\n---\n\n## Problem\n\nSome problem.\n`);
}

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => {
      result.status = s;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function mockClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getTaskStatus: vi.fn(async () => null),
    ...overrides,
  } as unknown as import("./daemon-client.js").DaemonControlClient;
}

function mockRequest(body: Record<string, unknown>): IncomingMessage {
  const data = Buffer.from(JSON.stringify(body));
  const handlers: Record<string, Array<(arg?: Buffer | Error) => void>> = {};
  return {
    on(event: string, handler: (arg?: Buffer | Error) => void) {
      (handlers[event] = handlers[event] || []).push(handler);
      if (event === "end") {
        setImmediate(() => {
          for (const h of handlers.data ?? []) h(data);
          for (const h of handlers.end ?? []) h();
        });
      }
      return this;
    },
  } as unknown as IncomingMessage;
}

describe("task-routes", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("daemon client proxy", () => {
    it("returns daemon response when client succeeds", async () => {
      const daemonResponse = {
        counts: { inbox: 1, ready: 2, backlog: 3, doing: 0, blocked: 0 },
        tasks: { doing: [], ready: [], backlog: [], blocked: [] },
      };
      const client = mockClient({ getTaskStatus: vi.fn(async () => daemonResponse) });
      const { res, result } = mockResponse();
      await handleTaskStatus(res, client, makeProjectDir());
      expect(result.status).toBe(200);
      expect((result.body as typeof daemonResponse).counts.ready).toBe(2);
    });

    it("falls back to direct read when client returns null", async () => {
      const client = mockClient({ getTaskStatus: vi.fn(async () => null) });
      const dir = makeProjectDir();
      writeTaskFile(dir, "ready", "t1", { id: "task-t1", title: "T1", priority: "p2" });
      const { res, result } = mockResponse();
      await handleTaskStatus(res, client, dir);
      expect(result.status).toBe(200);
      expect((result.body as { counts: Record<string, number> }).counts.ready).toBe(1);
    });
  });

  describe("handleTaskStatus", () => {
    it("returns 200 with zero counts when tasks directory is missing", async () => {
      const { res, result } = mockResponse();
      await handleTaskStatus(res, null, projectDir);
      expect(result.status).toBe(200);
      const body = result.body as { counts: Record<string, number>; tasks: Record<string, unknown[]> };
      expect(body.counts).toMatchObject({ inbox: 0, ready: 0, backlog: 0, doing: 0, blocked: 0 });
      expect(body.tasks.doing).toEqual([]);
      expect(body.tasks.ready).toEqual([]);
    });

    it("counts tasks in each state", async () => {
      writeTaskFile(projectDir, "ready", "task-a", { id: "task-a", title: "Task A", priority: "p1" });
      writeTaskFile(projectDir, "ready", "task-b", { id: "task-b", title: "Task B", priority: "p2" });
      writeTaskFile(projectDir, "backlog", "task-c", { id: "task-c", title: "Task C", priority: "p3" });
      writeTaskFile(projectDir, "blocked", "task-d", { id: "task-d", title: "Task D", priority: "p2" });

      const { res, result } = mockResponse();
      await handleTaskStatus(res, null, projectDir);
      expect(result.status).toBe(200);
      const body = result.body as { counts: Record<string, number>; tasks: Record<string, unknown[]> };
      expect(body.counts.ready).toBe(2);
      expect(body.counts.backlog).toBe(1);
      expect(body.counts.blocked).toBe(1);
      expect(body.counts.doing).toBe(0);
      expect(body.counts.inbox).toBe(0);
      expect(body.tasks.doing).toEqual([]);
      expect(body.tasks.ready).toHaveLength(2);
    });

    it("returns doing task metadata", async () => {
      writeTaskFile(projectDir, "doing", "active", {
        id: "task-active",
        title: "Active task",
        priority: "p1",
        area: "infra",
        summary: "A short summary",
      });

      const { res, result } = mockResponse();
      await handleTaskStatus(res, null, projectDir);
      expect(result.status).toBe(200);
      const body = result.body as { counts: Record<string, number>; tasks: Record<string, unknown[]> };
      expect(body.counts.doing).toBe(1);
      expect(body.tasks.doing).toHaveLength(1);
      const task = body.tasks.doing[0] as Record<string, string>;
      expect(task.id).toBe("task-active");
      expect(task.title).toBe("Active task");
      expect(task.priority).toBe("p1");
      expect(task.area).toBe("infra");
      expect(task.summary).toBe("A short summary");
      expect(task.body).toContain("Some problem.");
    });

    it("returns tasks for ready, backlog, blocked states", async () => {
      writeTaskFile(projectDir, "ready", "r1", { id: "task-r1", title: "Ready task", priority: "p2", area: "ui" });
      writeTaskFile(projectDir, "backlog", "b1", { id: "task-b1", title: "Backlog task", priority: "p3" });
      writeTaskFile(projectDir, "blocked", "bl1", { id: "task-bl1", title: "Blocked task", priority: "p1" });

      const { res, result } = mockResponse();
      await handleTaskStatus(res, null, projectDir);
      const body = result.body as { tasks: Record<string, Array<Record<string, string>>> };
      expect(body.tasks.ready).toHaveLength(1);
      expect(body.tasks.ready[0].title).toBe("Ready task");
      expect(body.tasks.ready[0].area).toBe("ui");
      expect(body.tasks.backlog).toHaveLength(1);
      expect(body.tasks.blocked).toHaveLength(1);
    });

    it("ignores AGENTS.md in task directories", async () => {
      mkdirSync(join(projectDir, "tasks", "ready"), { recursive: true });
      writeFileSync(join(projectDir, "tasks", "ready", "AGENTS.md"), "# Agents");
      writeTaskFile(projectDir, "ready", "real-task", { id: "task-real", title: "Real", priority: "p2" });

      const { res, result } = mockResponse();
      await handleTaskStatus(res, null, projectDir);
      const body = result.body as { counts: Record<string, number> };
      expect(body.counts.ready).toBe(1);
    });
  });

  describe("handleTaskStateChange", () => {
    it("moves a task from ready to backlog and updates frontmatter", async () => {
      writeTaskFile(projectDir, "ready", "task-x", {
        id: "task-x",
        title: "X",
        priority: "p2",
        status: "ready",
      });

      const req = mockRequest({ state: "backlog" });
      const { res, result } = mockResponse();
      await handleTaskStateChange(req, res, "task-x", projectDir);

      expect(result.status).toBe(200);
      expect((result.body as Record<string, string>).state).toBe("backlog");

      // File should exist at new location
      const newPath = join(projectDir, "tasks", "backlog", "task-task-x.md");
      expect(existsSync(newPath)).toBe(true);
      const content = readFileSync(newPath, "utf-8");
      expect(content).toContain("status: backlog");

      // File should be gone from old location
      const oldPath = join(projectDir, "tasks", "ready", "task-task-x.md");
      expect(existsSync(oldPath)).toBe(false);
    });

    it("moves a task to dropped", async () => {
      writeTaskFile(projectDir, "backlog", "task-y", {
        id: "task-y",
        title: "Y",
        priority: "p3",
        status: "backlog",
      });

      const req = mockRequest({ state: "dropped" });
      const { res, result } = mockResponse();
      await handleTaskStateChange(req, res, "task-y", projectDir);

      expect(result.status).toBe(200);
      expect((result.body as Record<string, string>).state).toBe("dropped");
      expect(existsSync(join(projectDir, "tasks", "dropped", "task-task-y.md"))).toBe(true);
    });

    it("returns 200 with no-op when state is same", async () => {
      writeTaskFile(projectDir, "ready", "task-z", {
        id: "task-z",
        title: "Z",
        priority: "p1",
        status: "ready",
      });

      const req = mockRequest({ state: "ready" });
      const { res, result } = mockResponse();
      await handleTaskStateChange(req, res, "task-z", projectDir);

      expect(result.status).toBe(200);
      expect(existsSync(join(projectDir, "tasks", "ready", "task-task-z.md"))).toBe(true);
    });

    it("returns 400 for invalid target state", async () => {
      writeTaskFile(projectDir, "ready", "task-q", { id: "task-q", title: "Q", priority: "p2", status: "ready" });

      const req = mockRequest({ state: "doing" });
      const { res, result } = mockResponse();
      await handleTaskStateChange(req, res, "task-q", projectDir);

      expect(result.status).toBe(400);
    });

    it("returns 404 when task not found", async () => {
      const req = mockRequest({ state: "backlog" });
      const { res, result } = mockResponse();
      await handleTaskStateChange(req, res, "task-nonexistent", projectDir);

      expect(result.status).toBe(404);
    });
  });

  describe("handleTaskCreate", () => {
    it("creates a new inbox task file", async () => {
      const req = mockRequest({ title: "My new task", summary: "A quick summary" });
      const { res, result } = mockResponse();
      await handleTaskCreate(req, res, projectDir);

      expect(result.status).toBe(201);
      const body = result.body as Record<string, string>;
      expect(body.state).toBe("inbox");
      expect(body.id).toMatch(/^task-my-new-task-/);

      const inboxDir = join(projectDir, "tasks", "inbox");
      const files = readdirSync(inboxDir).filter((f) => f.endsWith(".md"));
      expect(files).toHaveLength(1);
      const content = readFileSync(join(inboxDir, files[0]), "utf-8");
      expect(content).toContain("title: My new task");
      expect(content).toContain("status: inbox");
      expect(content).toContain("summary: A quick summary");
    });

    it("returns 400 when title is missing", async () => {
      const req = mockRequest({ summary: "No title here" });
      const { res, result } = mockResponse();
      await handleTaskCreate(req, res, projectDir);

      expect(result.status).toBe(400);
    });
  });

  describe("handleTaskBodyUpdate", () => {
    it("updates the body of an open task while preserving frontmatter", async () => {
      writeTaskFile(projectDir, "ready", "task-edit", {
        id: "task-edit",
        title: "Edit Me",
        priority: "p2",
        status: "ready",
        updated_at: "2026-01-01T00:00:00Z",
      });

      const req = mockRequest({ body: "## New body\n\nUpdated content." });
      const { res, result } = mockResponse();
      await handleTaskBodyUpdate(req, res, "task-edit", projectDir);

      expect(result.status).toBe(200);
      const body = result.body as Record<string, string>;
      expect(body.id).toBe("task-edit");
      expect(body.body).toContain("Updated content.");

      const filePath = join(projectDir, "tasks", "ready", "task-task-edit.md");
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("id: task-edit");
      expect(content).toContain("title: Edit Me");
      expect(content).toContain("status: ready");
      expect(content).toContain("Updated content.");
      expect(content).not.toContain("2026-01-01T00:00:00Z");
    });

    it("returns 404 when task id is not found in open states", async () => {
      const req = mockRequest({ body: "some content" });
      const { res, result } = mockResponse();
      await handleTaskBodyUpdate(req, res, "task-nonexistent", projectDir);

      expect(result.status).toBe(404);
    });

    it("returns 409 when task is in a terminal state", async () => {
      writeTaskFile(projectDir, "done", "task-done", {
        id: "task-done",
        title: "Done",
        priority: "p3",
        status: "done",
      });

      const req = mockRequest({ body: "## Should fail" });
      const { res, result } = mockResponse();
      await handleTaskBodyUpdate(req, res, "task-done", projectDir);

      expect(result.status).toBe(409);
    });

    it("returns 400 when body field is missing", async () => {
      writeTaskFile(projectDir, "ready", "task-nob", {
        id: "task-nob",
        title: "No Body",
        priority: "p3",
        status: "ready",
      });

      const req = mockRequest({ notbody: "wrong field" });
      const { res, result } = mockResponse();
      await handleTaskBodyUpdate(req, res, "task-nob", projectDir);

      expect(result.status).toBe(400);
    });
  });
});
