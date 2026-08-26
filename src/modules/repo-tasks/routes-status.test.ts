import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTaskStatus } from "./routes.js";
import { makeScopeRoot, mockResponse, writeTaskFile } from "./routes-test-helpers.js";

describe("task status route", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns 200 with zero counts when tasks directory is missing", async () => {
    const { res, result } = mockResponse();
    handleTaskStatus(res, repoRoot);
    expect(result.status).toBe(200);
    const body = result.body as { counts: Record<string, number>; tasks: Record<string, unknown[]> };
    expect(body.counts).toMatchObject({ inbox: 0, ready: 0, backlog: 0, doing: 0, blocked: 0 });
    expect(body.tasks.doing).toEqual([]);
    expect(body.tasks.ready).toEqual([]);
  });

  it("counts tasks in each state", async () => {
    writeTaskFile(repoRoot, "ready", "task-a", { id: "task-a", title: "Task A", priority: "p1" });
    writeTaskFile(repoRoot, "ready", "task-b", { id: "task-b", title: "Task B", priority: "p2" });
    writeTaskFile(repoRoot, "backlog", "task-c", { id: "task-c", title: "Task C", priority: "p3" });
    writeTaskFile(repoRoot, "blocked", "task-d", { id: "task-d", title: "Task D", priority: "p2" });

    const { res, result } = mockResponse();
    handleTaskStatus(res, repoRoot);
    const body = result.body as { counts: Record<string, number>; tasks: Record<string, unknown[]> };
    expect(body.counts.ready).toBe(2);
    expect(body.counts.backlog).toBe(1);
    expect(body.counts.blocked).toBe(1);
    expect(body.counts.doing).toBe(0);
    expect(body.counts.inbox).toBe(0);
    expect(body.tasks.ready).toHaveLength(2);
  });

  it("returns doing task metadata", async () => {
    writeTaskFile(repoRoot, "doing", "active", {
      id: "task-active",
      title: "Active task",
      priority: "p1",
      area: "infra",
      summary: "A short summary",
    });

    const { res, result } = mockResponse();
    handleTaskStatus(res, repoRoot);
    const body = result.body as { counts: Record<string, number>; tasks: Record<string, unknown[]> };
    expect(body.counts.doing).toBe(1);
    const task = body.tasks.doing[0] as Record<string, string>;
    expect(task.id).toBe("task-active");
    expect(task.title).toBe("Active task");
    expect(task.priority).toBe("p1");
    expect(task.area).toBe("infra");
    expect(task.summary).toBe("A short summary");
    expect(task.body).toContain("Some problem.");
  });

  it("returns tasks for ready, backlog, blocked states", async () => {
    writeTaskFile(repoRoot, "ready", "r1", { id: "task-r1", title: "Ready task", priority: "p2", area: "ui" });
    writeTaskFile(repoRoot, "backlog", "b1", { id: "task-b1", title: "Backlog task", priority: "p3" });
    writeTaskFile(repoRoot, "blocked", "bl1", { id: "task-bl1", title: "Blocked task", priority: "p1" });

    const { res, result } = mockResponse();
    handleTaskStatus(res, repoRoot);
    const body = result.body as { tasks: Record<string, Array<Record<string, string>>> };
    expect(body.tasks.ready[0].title).toBe("Ready task");
    expect(body.tasks.ready[0].area).toBe("ui");
    expect(body.tasks.backlog).toHaveLength(1);
    expect(body.tasks.blocked).toHaveLength(1);
  });

  it("includes waiting-on predecessor ids in task status details", async () => {
    writeTaskFile(repoRoot, "ready", "dependent", {
      id: "task-dependent",
      title: "Dependent task",
      status: "ready",
      priority: "p2",
      area: "modules",
      summary: "Waiting on another task.",
      updated_at: "2026-05-18T00:00:00.000Z",
      depends_on: "[task-enabler]",
    });
    writeTaskFile(repoRoot, "backlog", "enabler", {
      id: "task-enabler",
      title: "Enabler task",
      status: "backlog",
      priority: "p2",
      area: "modules",
      summary: "Not done yet.",
      updated_at: "2026-05-18T00:00:00.000Z",
    });

    const { res, result } = mockResponse();
    handleTaskStatus(res, repoRoot);
    const body = result.body as { tasks: Record<string, Array<Record<string, unknown>>> };
    expect(body.tasks.ready[0].waitingOnTasks).toEqual(["task-enabler"]);
  });

  it("ignores AGENTS.md in task directories", async () => {
    mkdirSync(join(repoRoot, "data", "tasks", "ready"), { recursive: true });
    writeFileSync(join(repoRoot, "data", "tasks", "ready", "AGENTS.md"), "# Agents");
    writeTaskFile(repoRoot, "ready", "real-task", { id: "task-real", title: "Real", priority: "p2" });

    const { res, result } = mockResponse();
    handleTaskStatus(res, repoRoot);
    const body = result.body as { counts: Record<string, number> };
    expect(body.counts.ready).toBe(1);
  });
});
