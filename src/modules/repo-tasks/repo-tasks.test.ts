import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepoTaskState } from "./repo-tasks-domain.js";
import {
  countRepoInboxEntries,
  countRepoTaskState,
  getRepoTaskQueueSnapshot,
  isThinDispatchableQueue,
  REPO_INBOX_DIR,
  REPO_TASKS_DIR,
} from "./repo-tasks-domain.js";

function taskFixture(
  id: string,
  state: RepoTaskState,
  options: { dependsOn?: string[] } = {},
): string {
  const active = state === "open" || state === "blocked";
  return [
    "---",
    `status: ${state}`,
    ...(active ? ["priority: p2"] : []),
    ...(active && options.dependsOn
      ? [`depends_on: [${options.dependsOn.join(", ")}]`]
      : []),
    "---",
    "",
    `# ${id}`,
    "",
    "## Problem",
    "",
    "Test task.",
    "",
  ].join("\n");
}

describe("repo task helpers", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = join(
      tmpdir(),
      `kota-repo-tasks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(repoRoot, REPO_TASKS_DIR, "archive"), { recursive: true });
    mkdirSync(join(repoRoot, REPO_INBOX_DIR), { recursive: true });
    writeFileSync(join(repoRoot, REPO_TASKS_DIR, "AGENTS.md"), "# tasks\n");
    writeFileSync(join(repoRoot, REPO_INBOX_DIR, "AGENTS.md"), "# inbox\n");
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeTask(id: string, state: RepoTaskState, dependsOn?: string[]): void {
    const dir = state === "done" || state === "dropped"
      ? join(repoRoot, REPO_TASKS_DIR, "archive")
      : join(repoRoot, REPO_TASKS_DIR);
    writeFileSync(join(dir, `${id}.md`), taskFixture(id, state, { dependsOn }));
  }

  it("counts active and archived task states while ignoring AGENTS.md", () => {
    writeTask("task-one", "open");
    writeTask("task-two", "open");
    writeTask("task-done", "done");
    expect(countRepoTaskState(repoRoot, "open")).toBe(2);
    expect(countRepoTaskState(repoRoot, "done")).toBe(1);
  });

  it("summarizes the queue without a persisted doing state", () => {
    writeFileSync(join(repoRoot, REPO_INBOX_DIR, "task-capture.md"), "task");
    writeTask("task-one", "open");
    writeTask("task-two", "open");
    writeTask("task-done", "done");

    expect(countRepoInboxEntries(repoRoot)).toBe(1);
    expect(getRepoTaskQueueSnapshot(repoRoot)).toEqual({
      counts: { open: 2, blocked: 0, done: 1, dropped: 0 },
      inboxCount: 1,
      activeCount: 2,
      actionableCount: 2,
      dispatchableCount: 3,
      hasDispatchableWork: true,
      dependencyBlockedTasks: [],
      headSha: expect.any(String),
    });
  });

  it("keeps dependency-waiting tasks open but excludes them from dispatch", () => {
    writeTask("task-dependent", "open", ["task-enabler"]);
    writeTask("task-enabler", "open");

    const snapshot = getRepoTaskQueueSnapshot(repoRoot);
    expect(snapshot.counts.open).toBe(2);
    expect(snapshot.activeCount).toBe(2);
    expect(snapshot.actionableCount).toBe(1);
    expect(snapshot.dispatchableCount).toBe(1);
    expect(snapshot.dependencyBlockedTasks).toEqual([
      {
        id: "task-dependent",
        title: "task-dependent",
        state: "open",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
    ]);
  });

  it("dispatches a dependent task after its predecessor is archived as done", () => {
    writeTask("task-dependent", "open", ["task-enabler"]);
    writeTask("task-enabler", "done");

    const snapshot = getRepoTaskQueueSnapshot(repoRoot);
    expect(snapshot.dependencyBlockedTasks).toEqual([]);
    expect(snapshot.actionableCount).toBe(1);
    expect(snapshot.dispatchableCount).toBe(1);
  });

  it("treats one or two dependency-clear open tasks as a thin queue", () => {
    writeTask("task-a", "open");
    expect(isThinDispatchableQueue(getRepoTaskQueueSnapshot(repoRoot))).toBe(true);
    writeTask("task-b", "open");
    expect(isThinDispatchableQueue(getRepoTaskQueueSnapshot(repoRoot))).toBe(true);
  });

  it("does not treat dependency-blocked or three-task queues as thin", () => {
    writeTask("task-dependent", "open", ["task-enabler"]);
    writeTask("task-enabler", "blocked");
    expect(isThinDispatchableQueue(getRepoTaskQueueSnapshot(repoRoot))).toBe(false);

    rmSync(join(repoRoot, REPO_TASKS_DIR, "task-dependent.md"));
    rmSync(join(repoRoot, REPO_TASKS_DIR, "task-enabler.md"));
    writeTask("task-a", "open");
    writeTask("task-b", "open");
    writeTask("task-c", "open");
    expect(isThinDispatchableQueue(getRepoTaskQueueSnapshot(repoRoot))).toBe(false);
  });
});
