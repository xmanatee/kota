import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeBuilderTaskIds, handleTaskStatus } from "./routes-state-handlers.js";
import { makeScopeRoot, mockResponse, writeTaskFile } from "./routes-test-helpers.js";

describe("task status route", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns empty active-state projections when the task directory is missing", async () => {
    const { res, result } = mockResponse();
    await handleTaskStatus(res, repoRoot);
    expect(result.status).toBe(200);
    const body = result.body as {
      counts: Record<string, number>;
      tasks: Record<string, unknown[]>;
    };
    expect(body.counts).toEqual({ inbox: 0, open: 0, blocked: 0 });
    expect(body.tasks).toEqual({ open: [], blocked: [] });
  });

  it("counts and returns open and blocked tasks", async () => {
    writeTaskFile(repoRoot, "open", "task-a", { title: "Task A", priority: "p1" });
    writeTaskFile(repoRoot, "open", "task-b", { title: "Task B", priority: "p2" });
    writeTaskFile(repoRoot, "blocked", "task-c", { title: "Task C", priority: "p3" });

    const { res, result } = mockResponse();
    await handleTaskStatus(res, repoRoot);
    const body = result.body as {
      counts: Record<string, number>;
      tasks: Record<string, Array<Record<string, unknown>>>;
    };
    expect(body.counts).toEqual({ inbox: 0, open: 2, blocked: 1 });
    expect(body.tasks.open).toHaveLength(2);
    expect(body.tasks.blocked).toHaveLength(1);
    expect(body.tasks.open[0]).toMatchObject({
      id: "task-a",
      title: "Task A",
      priority: "p1",
      waitingOnTasks: [],
      inProgress: false,
    });
  });

  it("includes unfinished predecessor ids on open tasks", async () => {
    writeTaskFile(repoRoot, "open", "task-dependent", {
      title: "Dependent task",
      priority: "p2",
      depends_on: "[task-enabler]",
    });
    writeTaskFile(repoRoot, "open", "task-enabler", {
      title: "Enabler task",
      priority: "p2",
    });

    const { res, result } = mockResponse();
    await handleTaskStatus(res, repoRoot);
    const body = result.body as {
      tasks: { open: Array<{ id: string; waitingOnTasks: string[] }> };
    };
    expect(body.tasks.open.find((task) => task.id === "task-dependent")?.waitingOnTasks)
      .toEqual(["task-enabler"]);
  });

  it("ignores AGENTS.md at the task root", async () => {
    mkdirSync(join(repoRoot, "data", "tasks"), { recursive: true });
    writeFileSync(join(repoRoot, "data", "tasks", "AGENTS.md"), "# Agents");
    writeTaskFile(repoRoot, "open", "task-real", { title: "Real", priority: "p2" });

    const { res, result } = mockResponse();
    await handleTaskStatus(res, repoRoot);
    const body = result.body as { counts: Record<string, number> };
    expect(body.counts.open).toBe(1);
  });
});

describe("activeBuilderTaskIds", () => {
  it("derives transient in-progress state only from active builder triggers", () => {
    const ids = activeBuilderTaskIds({
      activeRuns: [
        {
          workflow: "builder",
          trigger: { event: "autonomy.queue.available", payload: { taskId: "task-active" } },
        },
        {
          workflow: "explorer",
          trigger: { event: "schedule", payload: { taskId: "task-not-building" } },
        },
      ],
    } as never);
    expect([...ids]).toEqual(["task-active"]);
  });
});
