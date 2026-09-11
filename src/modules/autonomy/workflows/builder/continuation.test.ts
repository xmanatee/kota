import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { collectBuilderContinuationContext } from "./continuation.js";

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

describe("builder continuation context", () => {
  test("retains the immutable admitted contract after the isolated task has moved terminal", () => {
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

    const context = collectBuilderContinuationContext({
      scopeRoot,
      taskId: "task-current",
      priority: "p1",
      taskContract: "status: open\npriority: p1\n\n# Immutable admitted task",
    });

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
  });
});
