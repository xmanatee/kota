import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countRepoInboxEntries,
  countRepoTaskState,
  getRepoTaskQueueSnapshot,
  isThinPullQueue,
  REPO_INBOX_DIR,
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
} from "./repo-tasks.js";

describe("repo task helpers", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-repo-tasks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );

    for (const state of REPO_TASK_STATES) {
      mkdirSync(join(projectDir, REPO_TASKS_DIR, state), { recursive: true });
      writeFileSync(join(projectDir, REPO_TASKS_DIR, state, "AGENTS.md"), `# ${state}\n`);
    }
    mkdirSync(join(projectDir, REPO_INBOX_DIR), { recursive: true });
    writeFileSync(join(projectDir, REPO_INBOX_DIR, "AGENTS.md"), "# inbox\n");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("counts markdown task files while ignoring AGENTS.md", () => {
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "ready", "task-one.md"), "task");
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "ready", "task-two.md"), "task");

    expect(countRepoTaskState(projectDir, "ready")).toBe(2);
  });

  it("summarizes the open task queue by state", () => {
    writeFileSync(join(projectDir, REPO_INBOX_DIR, "task-capture.md"), "task");
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "ready", "task-ready.md"), "task");
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "doing", "task-doing.md"), "task");
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "done", "task-done.md"), "task");

    expect(countRepoInboxEntries(projectDir)).toBe(1);

    expect(getRepoTaskQueueSnapshot(projectDir)).toEqual({
      counts: {
        backlog: 0,
        ready: 1,
        doing: 1,
        blocked: 0,
        done: 1,
        dropped: 0,
      },
      inboxCount: 1,
      openCount: 3,
      pullableCount: 2,
      actionableCount: 2,
      headSha: expect.any(String),
    });
  });

  it("detects a one-item backlog tail with no ready or doing work", () => {
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "backlog", "task-tail.md"), "task");

    expect(isThinPullQueue(getRepoTaskQueueSnapshot(projectDir))).toBe(true);
  });

  it("does not treat ready work as a thin pull queue", () => {
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "ready", "task-ready.md"), "task");

    expect(isThinPullQueue(getRepoTaskQueueSnapshot(projectDir))).toBe(false);
  });
});
