import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ESCALATION_THRESHOLD,
  escalateTaskFiles,
  findTasksToEscalate,
  getReadyTaskIds,
} from "./auto-escalate.js";

function makeTaskContent(id: string, status: "ready" | "blocked"): string {
  return `---
id: ${id}
title: Test Task
status: ${status}
priority: p2
area: test
summary: A test task.
created_at: 2026-01-01
updated_at: 2026-01-01
---

## Problem

Something is broken.

## Desired Outcome

It works.

## Constraints

None.

## Done When

Tests pass.
`;
}

describe("findTasksToEscalate", () => {
  it("returns tasks meeting the threshold with no completions", () => {
    const summary = {
      attempts: { "task-foo": 3, "task-bar": 1 },
      completions: new Set<string>(),
    };
    expect(findTasksToEscalate(["task-foo", "task-bar"], summary)).toEqual([
      "task-foo",
    ]);
  });

  it("excludes tasks that were completed", () => {
    const summary = {
      attempts: { "task-foo": 3 },
      completions: new Set(["task-foo"]),
    };
    expect(findTasksToEscalate(["task-foo"], summary)).toEqual([]);
  });

  it("excludes tasks below the threshold", () => {
    const summary = {
      attempts: { "task-foo": ESCALATION_THRESHOLD - 1 },
      completions: new Set<string>(),
    };
    expect(findTasksToEscalate(["task-foo"], summary)).toEqual([]);
  });

  it("includes tasks exactly at the threshold", () => {
    const summary = {
      attempts: { "task-foo": ESCALATION_THRESHOLD },
      completions: new Set<string>(),
    };
    expect(findTasksToEscalate(["task-foo"], summary)).toEqual(["task-foo"]);
  });

  it("returns empty list when readyTaskIds is empty", () => {
    const summary = {
      attempts: { "task-foo": 5 },
      completions: new Set<string>(),
    };
    expect(findTasksToEscalate([], summary)).toEqual([]);
  });

  it("returns empty list when no tasks have attempts", () => {
    const summary = {
      attempts: {},
      completions: new Set<string>(),
    };
    expect(findTasksToEscalate(["task-foo"], summary)).toEqual([]);
  });
});

describe("getReadyTaskIds", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-escalate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "tasks", "ready"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns task IDs from ready directory", () => {
    writeFileSync(
      join(projectDir, "tasks", "ready", "task-foo.md"),
      makeTaskContent("task-foo", "ready"),
    );
    writeFileSync(
      join(projectDir, "tasks", "ready", "task-bar.md"),
      makeTaskContent("task-bar", "ready"),
    );
    const ids = getReadyTaskIds(projectDir);
    expect(ids).toContain("task-foo");
    expect(ids).toContain("task-bar");
  });

  it("excludes non-task files like AGENTS.md", () => {
    writeFileSync(join(projectDir, "tasks", "ready", "AGENTS.md"), "# hi");
    const ids = getReadyTaskIds(projectDir);
    expect(ids).toEqual([]);
  });

  it("returns empty array when directory does not exist", () => {
    const ids = getReadyTaskIds(join(projectDir, "nonexistent"));
    expect(ids).toEqual([]);
  });
});

describe("escalateTaskFiles", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-escalate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "tasks", "ready"), { recursive: true });
    mkdirSync(join(projectDir, "tasks", "blocked"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("moves task file from ready to blocked", () => {
    const taskId = "task-foo";
    writeFileSync(
      join(projectDir, "tasks", "ready", `${taskId}.md`),
      makeTaskContent(taskId, "ready"),
    );

    escalateTaskFiles(projectDir, [taskId]);

    expect(
      existsSync(join(projectDir, "tasks", "ready", `${taskId}.md`)),
    ).toBe(false);
    expect(
      existsSync(join(projectDir, "tasks", "blocked", `${taskId}.md`)),
    ).toBe(true);
  });

  it("updates status from ready to blocked", () => {
    const taskId = "task-foo";
    writeFileSync(
      join(projectDir, "tasks", "ready", `${taskId}.md`),
      makeTaskContent(taskId, "ready"),
    );

    escalateTaskFiles(projectDir, [taskId]);

    const content = readFileSync(
      join(projectDir, "tasks", "blocked", `${taskId}.md`),
      "utf-8",
    );
    expect(content).toContain("status: blocked");
    expect(content).not.toContain("status: ready");
  });

  it("adds a Blocker section to the task content", () => {
    const taskId = "task-foo";
    writeFileSync(
      join(projectDir, "tasks", "ready", `${taskId}.md`),
      makeTaskContent(taskId, "ready"),
    );

    escalateTaskFiles(projectDir, [taskId]);

    const content = readFileSync(
      join(projectDir, "tasks", "blocked", `${taskId}.md`),
      "utf-8",
    );
    expect(content).toContain("## Blocker");
    expect(content).toContain("Auto-escalated after");
  });

  it("does not duplicate Blocker section if already present", () => {
    const taskId = "task-foo";
    const contentWithBlocker =
      makeTaskContent(taskId, "ready") + "\n## Blocker\n\nExisting blocker.\n";
    writeFileSync(
      join(projectDir, "tasks", "ready", `${taskId}.md`),
      contentWithBlocker,
    );

    escalateTaskFiles(projectDir, [taskId]);

    const result = readFileSync(
      join(projectDir, "tasks", "blocked", `${taskId}.md`),
      "utf-8",
    );
    const count = (result.match(/## Blocker/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("escalates multiple tasks", () => {
    for (const id of ["task-a", "task-b"]) {
      writeFileSync(
        join(projectDir, "tasks", "ready", `${id}.md`),
        makeTaskContent(id, "ready"),
      );
    }

    escalateTaskFiles(projectDir, ["task-a", "task-b"]);

    expect(
      existsSync(join(projectDir, "tasks", "blocked", "task-a.md")),
    ).toBe(true);
    expect(
      existsSync(join(projectDir, "tasks", "blocked", "task-b.md")),
    ).toBe(true);
    expect(existsSync(join(projectDir, "tasks", "ready", "task-a.md"))).toBe(
      false,
    );
  });
});

describe("loadBuilderAttemptSummary (integration)", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "tasks", "doing"), { recursive: true });
    mkdirSync(join(projectDir, "tasks", "done"), { recursive: true });
    execSync("git init", { cwd: projectDir });
    execSync("git config user.email test@test.com", { cwd: projectDir });
    execSync("git config user.name Test", { cwd: projectDir });
    execSync("git commit --allow-empty -m 'Initial commit'", {
      cwd: projectDir,
    });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  let commitCounter = 0;
  function commitTask(
    taskId: string,
    state: "doing" | "done",
    message: string,
  ): void {
    commitCounter += 1;
    const filePath = join(projectDir, "tasks", state, `${taskId}.md`);
    writeFileSync(filePath, `# ${taskId} attempt ${commitCounter}\n`);
    execSync(`git add tasks/${state}/${taskId}.md`, { cwd: projectDir });
    execSync(`git commit -m "${message}"`, { cwd: projectDir });
  }

  it("counts builder attempts and completions from git history", async () => {
    const { loadBuilderAttemptSummary } = await import("./auto-escalate.js");

    commitTask("task-stuck", "doing", "Builder: attempt 1");
    commitTask("task-stuck", "doing", "Builder: attempt 2");
    commitTask("task-stuck", "doing", "Builder: attempt 3");
    commitTask("task-done", "doing", "Builder: start done task");
    commitTask("task-done", "done", "Builder: complete done task");

    const summary = loadBuilderAttemptSummary(projectDir);
    expect(summary.attempts["task-stuck"]).toBe(3);
    expect(summary.completions.has("task-done")).toBe(true);
    expect(summary.completions.has("task-stuck")).toBe(false);
  });

  it("respects maxRuns limit", async () => {
    const { loadBuilderAttemptSummary } = await import("./auto-escalate.js");

    commitTask("task-old", "doing", "Builder: old attempt");
    for (let i = 0; i < 10; i++) {
      execSync(`git commit --allow-empty -m "Builder: unrelated ${i}"`, {
        cwd: projectDir,
      });
    }

    // With maxRuns=10, task-old is the 11th Builder commit — should not appear
    const summary = loadBuilderAttemptSummary(projectDir, 10);
    expect(summary.attempts["task-old"]).toBeUndefined();
  });

  it("returns empty summary when no builder commits exist", async () => {
    const { loadBuilderAttemptSummary } = await import("./auto-escalate.js");

    const summary = loadBuilderAttemptSummary(projectDir);
    expect(summary.attempts).toEqual({});
    expect(summary.completions.size).toBe(0);
  });
});
