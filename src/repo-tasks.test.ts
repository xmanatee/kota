import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countRepoTasks,
  getRepoTaskQueueSnapshot,
  REPO_TASK_STATES,
} from "./repo-tasks.js";

describe("repo task helpers", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-repo-tasks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );

    for (const state of REPO_TASK_STATES) {
      mkdirSync(join(projectDir, "tasks", state), { recursive: true });
      writeFileSync(join(projectDir, "tasks", state, "AGENTS.md"), `# ${state}\n`);
    }
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("counts markdown task files while ignoring AGENTS.md", () => {
    writeFileSync(join(projectDir, "tasks", "ready", "task-one.md"), "task");
    writeFileSync(join(projectDir, "tasks", "ready", "task-two.md"), "task");

    expect(countRepoTasks(projectDir, "ready")).toBe(2);
  });

  it("summarizes the open task queue by state", () => {
    writeFileSync(join(projectDir, "tasks", "inbox", "task-capture.md"), "task");
    writeFileSync(join(projectDir, "tasks", "ready", "task-ready.md"), "task");
    writeFileSync(join(projectDir, "tasks", "doing", "task-doing.md"), "task");
    writeFileSync(join(projectDir, "tasks", "done", "task-done.md"), "task");

    expect(getRepoTaskQueueSnapshot(projectDir)).toEqual({
      counts: {
        inbox: 1,
        backlog: 0,
        ready: 1,
        doing: 1,
        blocked: 0,
        done: 1,
        dropped: 0,
      },
      openCount: 3,
      actionableCount: 2,
    });
  });
});
