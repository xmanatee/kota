import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { collectAutonomyContinuationContext } from "./continuation.js";

const roots: string[] = [];

function root(label: string): string {
  const value = mkdtempSync(join(tmpdir(), `kota-continuation-${label}-`));
  roots.push(value);
  mkdirSync(join(value, "data", "tasks", "archive"), { recursive: true });
  return value;
}

function task(status: "open" | "done", priority: string | null, title: string): string {
  const frontmatter = priority === null
    ? `---\nstatus: ${status}\n---`
    : `---\nstatus: ${status}\npriority: ${priority}\n---`;
  return `${frontmatter}\n\n# ${title}\n\n## Desired Outcome\n\nShip the outcome.\n`;
}

afterEach(() => {
  for (const value of roots.splice(0)) {
    rmSync(value, { recursive: true, force: true });
  }
});

describe("autonomy continuation context", () => {
  test("preserves the admitted contract and excludes retained priority blockers", () => {
    const workspaceRoot = root("workspace");
    const scopeRoot = root("scope");
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "archive", "task-current.md"),
      task("done", null, "Current task"),
    );
    writeFileSync(
      join(scopeRoot, "data", "tasks", "task-current.md"),
      task("open", "p1", "Current task"),
    );
    writeFileSync(
      join(scopeRoot, "data", "tasks", "task-urgent.md"),
      task("open", "p0", "Urgent runtime repair"),
    );
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: scopeRoot });
    execFileSync("git", ["config", "user.email", "test@example.test"], {
      cwd: scopeRoot,
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: scopeRoot });
    execFileSync("git", ["add", "data/tasks"], { cwd: scopeRoot });
    execFileSync("git", ["commit", "-q", "-m", "tasks"], { cwd: scopeRoot });

    const store = new RunStateDatabase(join(scopeRoot, ".kota"));
    store.registerScope({ id: "scope-a", rootPath: scopeRoot, createdAt: "2026-09-12T00:00:00Z" });
    const { epoch } = store.beginDaemonSession("2026-09-12T00:00:00Z");
    const input = {
      workSupplyInput: { scopeRoot, workspaceRoot: scopeRoot, stateDir: join(scopeRoot, ".kota"), capacity: 2 },
      id: "task-current",
      priority: "p1" as const,
      taskContract: "status: open\npriority: p1\n\n# Immutable admitted task",
    };
    try {
    const context = collectAutonomyContinuationContext(input);

    expect(context.current).toEqual({
      id: "task-current",
      priority: 1,
      priorityLabel: "p1",
    });
    expect(context.taskContract).toBe(
      "status: open\npriority: p1\n\n# Immutable admitted task",
    );
    expect(context.taskContract).not.toContain("status: done");
    expect(context.queue.available.map((candidate) => candidate.id)).toEqual([
      "task-urgent",
      "task-current",
    ]);
    expect(context.queue.available[0]).toMatchObject({
      priority: 0,
      resource: "task:task-urgent",
    });
    store.admitRun({ id: "urgent", scopeId: "scope-a", workflow: "writer", repository: "write",
      trigger: { event: "manual", schemaRef: null, payload: {} }, resources: ["task:task-urgent"],
      admittedAt: "2026-09-12T00:00:01Z" });
    expect(collectAutonomyContinuationContext(input).queue.available[0].id).toBe("task-urgent");
    store.startRun("urgent", epoch, "2026-09-12T00:00:02Z");
    store.admitRun({ id: "urgent-contender", scopeId: "scope-a", workflow: "writer", repository: "write",
      trigger: { event: "manual", schemaRef: null, payload: {} }, resources: ["task:task-urgent"],
      admittedAt: "2026-09-12T00:00:04Z" });
    store.suspendRun({ runId: "urgent", epoch, state: "needs_attention", wait: { reason: "external-unavailable" },
      suspendedAt: "2026-09-12T00:00:05Z" });
    expect(collectAutonomyContinuationContext(input).queue.available.map((task) => task.id)).toEqual(["task-current"]);
    } finally {
      store.close();
    }
  });
});
