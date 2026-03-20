import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskStatus } from "./task-routes.js";

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

describe("task-routes", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("handleTaskStatus", () => {
    it("returns 200 with zero counts when tasks directory is missing", () => {
      const { res, result } = mockResponse();
      handleTaskStatus(res, projectDir);
      expect(result.status).toBe(200);
      const body = result.body as { counts: Record<string, number>; doing: unknown[] };
      expect(body.counts).toMatchObject({ inbox: 0, ready: 0, backlog: 0, doing: 0, blocked: 0 });
      expect(body.doing).toEqual([]);
    });

    it("counts tasks in each state", () => {
      writeTaskFile(projectDir, "ready", "task-a", { id: "task-a", title: "Task A", priority: "p1" });
      writeTaskFile(projectDir, "ready", "task-b", { id: "task-b", title: "Task B", priority: "p2" });
      writeTaskFile(projectDir, "backlog", "task-c", { id: "task-c", title: "Task C", priority: "p3" });
      writeTaskFile(projectDir, "blocked", "task-d", { id: "task-d", title: "Task D", priority: "p2" });

      const { res, result } = mockResponse();
      handleTaskStatus(res, projectDir);
      expect(result.status).toBe(200);
      const body = result.body as { counts: Record<string, number>; doing: unknown[] };
      expect(body.counts.ready).toBe(2);
      expect(body.counts.backlog).toBe(1);
      expect(body.counts.blocked).toBe(1);
      expect(body.counts.doing).toBe(0);
      expect(body.counts.inbox).toBe(0);
      expect(body.doing).toEqual([]);
    });

    it("returns doing task metadata", () => {
      writeTaskFile(projectDir, "doing", "active", {
        id: "task-active",
        title: "Active task",
        priority: "p1",
      });

      const { res, result } = mockResponse();
      handleTaskStatus(res, projectDir);
      expect(result.status).toBe(200);
      const body = result.body as { counts: Record<string, number>; doing: unknown[] };
      expect(body.counts.doing).toBe(1);
      expect(body.doing).toHaveLength(1);
      const task = body.doing[0] as Record<string, string>;
      expect(task.id).toBe("task-active");
      expect(task.title).toBe("Active task");
      expect(task.priority).toBe("p1");
    });

    it("ignores AGENTS.md in task directories", () => {
      mkdirSync(join(projectDir, "tasks", "ready"), { recursive: true });
      writeFileSync(join(projectDir, "tasks", "ready", "AGENTS.md"), "# Agents");
      writeTaskFile(projectDir, "ready", "real-task", { id: "task-real", title: "Real", priority: "p2" });

      const { res, result } = mockResponse();
      handleTaskStatus(res, projectDir);
      const body = result.body as { counts: Record<string, number> };
      expect(body.counts.ready).toBe(1);
    });
  });
});
