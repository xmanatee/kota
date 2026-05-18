import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepoTaskState } from "./repo-tasks-domain.js";
import {
  countRepoInboxEntries,
  countRepoPromotableBacklogTasks,
  countRepoTaskState,
  getRepoTaskQueueSnapshot,
  isThinPullQueue,
  REPO_INBOX_DIR,
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
} from "./repo-tasks-domain.js";

function taskFixture(
  id: string,
  state: RepoTaskState,
  options: { dependsOn?: string[] } = {},
): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    `status: ${state}`,
    "priority: p2",
    "area: modules",
    `summary: ${id} summary`,
    "updated_at: 2026-05-08T00:00:00.000Z",
    ...(options.dependsOn ? [`depends_on: [${options.dependsOn.join(", ")}]`] : []),
    "---",
    "",
  ].join("\n");
}

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

  it("counts only non-anchor backlog tasks as promotable", () => {
    writeFileSync(
      join(projectDir, REPO_TASKS_DIR, "backlog", "task-work.md"),
      [
        "---",
        "id: task-work",
        "title: Work",
        "status: backlog",
        "priority: p2",
        "area: modules",
        "summary: Work",
        "updated_at: 2026-05-08T00:00:00.000Z",
        "---",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(projectDir, REPO_TASKS_DIR, "backlog", "task-anchor.md"),
      [
        "---",
        "id: task-anchor",
        "title: Anchor",
        "status: backlog",
        "priority: p2",
        "area: architecture",
        "summary: Anchor",
        "updated_at: 2026-05-08T00:00:00.000Z",
        "anchor: true",
        "---",
        "",
      ].join("\n"),
    );

    expect(countRepoPromotableBacklogTasks(projectDir)).toBe(1);
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
      dependencyBlockedTasks: [],
      headSha: expect.any(String),
    });
  });

  it("subtracts unfinished hard dependencies from pullable and actionable counts", () => {
    writeFileSync(
      join(projectDir, REPO_TASKS_DIR, "ready", "task-dependent.md"),
      [
        "---",
        "id: task-dependent",
        "title: Dependent",
        "status: ready",
        "priority: p2",
        "area: modules",
        "summary: Dependent",
        "updated_at: 2026-05-08T00:00:00.000Z",
        "depends_on: [task-enabler]",
        "---",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(projectDir, REPO_TASKS_DIR, "backlog", "task-enabler.md"),
      [
        "---",
        "id: task-enabler",
        "title: Enabler",
        "status: backlog",
        "priority: p2",
        "area: modules",
        "summary: Enabler",
        "updated_at: 2026-05-08T00:00:00.000Z",
        "---",
        "",
      ].join("\n"),
    );

    const snapshot = getRepoTaskQueueSnapshot(projectDir);

    expect(snapshot.counts.ready).toBe(1);
    expect(snapshot.pullableCount).toBe(1);
    expect(snapshot.actionableCount).toBe(0);
    expect(snapshot.dependencyBlockedTasks).toEqual([
      {
        id: "task-dependent",
        title: "Dependent",
        state: "ready",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
    ]);
  });

  it("counts dependency-clear backlog work as promotable after predecessors are done", () => {
    writeFileSync(
      join(projectDir, REPO_TASKS_DIR, "backlog", "task-dependent.md"),
      [
        "---",
        "id: task-dependent",
        "title: Dependent",
        "status: backlog",
        "priority: p2",
        "area: modules",
        "summary: Dependent",
        "updated_at: 2026-05-08T00:00:00.000Z",
        "depends_on: [task-enabler]",
        "---",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(projectDir, REPO_TASKS_DIR, "done", "task-enabler.md"),
      [
        "---",
        "id: task-enabler",
        "title: Enabler",
        "status: done",
        "priority: p2",
        "area: modules",
        "summary: Enabler",
        "updated_at: 2026-05-08T00:00:00.000Z",
        "---",
        "",
      ].join("\n"),
    );

    expect(countRepoPromotableBacklogTasks(projectDir)).toBe(1);
    expect(getRepoTaskQueueSnapshot(projectDir).dependencyBlockedTasks).toEqual([]);
  });

  it("detects a one-item backlog tail with no ready or doing work", () => {
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "backlog", "task-tail.md"), "task");

    expect(isThinPullQueue(getRepoTaskQueueSnapshot(projectDir))).toBe(true);
  });

  it("detects a single ready task as thin", () => {
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "ready", "task-ready.md"), "task");

    expect(isThinPullQueue(getRepoTaskQueueSnapshot(projectDir))).toBe(true);
  });

  it("detects two dependency-clear pull tasks as thin", () => {
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "ready", "task-a.md"), "task");
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "backlog", "task-b.md"), "task");

    expect(isThinPullQueue(getRepoTaskQueueSnapshot(projectDir))).toBe(true);
  });

  it("does not treat dependency-blocked ready and backlog tails as thin", () => {
    writeFileSync(
      join(projectDir, REPO_TASKS_DIR, "ready", "task-ready-dependent.md"),
      taskFixture("task-ready-dependent", "ready", { dependsOn: ["task-enabler"] }),
    );
    writeFileSync(
      join(projectDir, REPO_TASKS_DIR, "backlog", "task-backlog-dependent.md"),
      taskFixture("task-backlog-dependent", "backlog", { dependsOn: ["task-enabler"] }),
    );
    writeFileSync(
      join(projectDir, REPO_TASKS_DIR, "blocked", "task-enabler.md"),
      taskFixture("task-enabler", "blocked"),
    );

    const snapshot = getRepoTaskQueueSnapshot(projectDir);

    expect(snapshot.pullableCount).toBe(0);
    expect(snapshot.dependencyBlockedTasks).toEqual([
      {
        id: "task-backlog-dependent",
        title: "task-backlog-dependent",
        state: "backlog",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
      {
        id: "task-ready-dependent",
        title: "task-ready-dependent",
        state: "ready",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
    ]);
    expect(isThinPullQueue(snapshot)).toBe(false);
  });

  it("does not treat three or more dependency-clear pull tasks as thin", () => {
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "ready", "task-a.md"), "task");
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "ready", "task-b.md"), "task");
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "backlog", "task-c.md"), "task");

    expect(isThinPullQueue(getRepoTaskQueueSnapshot(projectDir))).toBe(false);
  });

  it("is thin when only a doing task remains and nothing waits behind it", () => {
    writeFileSync(join(projectDir, REPO_TASKS_DIR, "doing", "task-active.md"), "task");

    expect(isThinPullQueue(getRepoTaskQueueSnapshot(projectDir))).toBe(true);
  });

  it("is not thin when queue is empty", () => {
    expect(isThinPullQueue(getRepoTaskQueueSnapshot(projectDir))).toBe(false);
  });
});
