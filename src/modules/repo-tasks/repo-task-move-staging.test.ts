import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  moveTaskById,
  stageRepoTaskStateMutation,
} from "./repo-tasks-domain.js";

const TASK_ID = "task-linked-worktree-move";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

describe("repo task move staging", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stages both sides of repeated state moves in a linked worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-task-move-staging-"));
    roots.push(root);
    const repoDir = join(root, "repo");
    const worktreeDir = join(root, "linked");
    const readyDir = join(repoDir, "data", "tasks", "ready");
    mkdirSync(readyDir, { recursive: true });
    mkdirSync(join(repoDir, "data", "tasks", "doing"), { recursive: true });
    mkdirSync(join(repoDir, "data", "tasks", "done"), { recursive: true });
    writeFileSync(
      join(readyDir, `${TASK_ID}.md`),
      `---
id: ${TASK_ID}
title: Exercise linked-worktree task staging
status: ready
priority: p2
area: modules
summary: Prove state transitions stage the rewritten destination task.
created_at: 2026-07-25T00:00:00.000Z
updated_at: 2026-07-25T00:00:00.000Z
---

## Problem

The task is ready.

## Desired Outcome

The task reaches done.

## Constraints

Keep the transition canonical.

## Done When

- The task is done.

## Acceptance Evidence

- The linked-worktree Git status records the complete rename.
`,
      "utf-8",
    );

    git(repoDir, ["init", "-b", "main"]);
    git(repoDir, ["config", "user.email", "kota-test@example.invalid"]);
    git(repoDir, ["config", "user.name", "KOTA Test"]);
    git(repoDir, ["add", "-A"]);
    git(repoDir, ["commit", "-m", "seed task"]);
    git(repoDir, ["worktree", "add", "-b", "task/test", worktreeDir]);

    moveTaskById(worktreeDir, TASK_ID, "doing");
    moveTaskById(worktreeDir, TASK_ID, "done");

    const status = git(worktreeDir, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      "data/tasks",
    ]);
    expect(status).toMatch(
      /^R {2}data\/tasks\/ready\/task-linked-worktree-move\.md -> data\/tasks\/done\/task-linked-worktree-move\.md$/,
    );
    expect(status).not.toContain("??");
    expect(
      readFileSync(
        join(worktreeDir, "data", "tasks", "done", `${TASK_ID}.md`),
        "utf-8",
      ),
    ).toMatch(/^status: done$/m);
  });

  it("refuses to overwrite an existing destination-state task", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-task-move-conflict-"));
    roots.push(root);
    const readyDir = join(root, "data", "tasks", "ready");
    const doneDir = join(root, "data", "tasks", "done");
    mkdirSync(readyDir, { recursive: true });
    mkdirSync(doneDir, { recursive: true });
    const readyPath = join(readyDir, `${TASK_ID}.md`);
    const donePath = join(doneDir, `${TASK_ID}.md`);
    const readyContent = "source task remains in ready\n";
    const doneContent = "existing done task must not be replaced\n";
    writeFileSync(readyPath, readyContent, "utf-8");
    writeFileSync(donePath, doneContent, "utf-8");

    expect(() => moveTaskById(root, TASK_ID, "done")).toThrow(
      `Task "${TASK_ID}" already exists in "done"`,
    );

    expect(readFileSync(readyPath, "utf-8")).toBe(readyContent);
    expect(readFileSync(donePath, "utf-8")).toBe(doneContent);
  });

  it("retries exact task staging after a native agent sandbox moves the file", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-task-host-staging-"));
    roots.push(root);
    const repoDir = join(root, "repo");
    const readyDir = join(repoDir, "data", "tasks", "ready");
    const doneDir = join(repoDir, "data", "tasks", "done");
    mkdirSync(readyDir, { recursive: true });
    mkdirSync(doneDir, { recursive: true });
    const readyPath = join(readyDir, `${TASK_ID}.md`);
    const donePath = join(doneDir, `${TASK_ID}.md`);
    writeFileSync(
      readyPath,
      `---
id: ${TASK_ID}
title: Retry native-sandbox task staging
status: ready
priority: p2
area: modules
summary: Prove the host can retry the domain-owned exact-path staging operation.
created_at: 2026-07-25T00:00:00.000Z
updated_at: 2026-07-25T00:00:00.000Z
---

## Problem

The native agent sandbox protects Git metadata.

## Desired Outcome

The host stages the completed task rename.

## Constraints

Keep staging claim-scoped.

## Done When

- The task rename is staged.

## Acceptance Evidence

- Git status records the complete rename.
`,
      "utf-8",
    );

    git(repoDir, ["init", "-b", "main"]);
    git(repoDir, ["config", "user.email", "kota-test@example.invalid"]);
    git(repoDir, ["config", "user.name", "KOTA Test"]);
    git(repoDir, ["add", "-A"]);
    git(repoDir, ["commit", "-m", "seed task"]);

    renameSync(readyPath, donePath);
    writeFileSync(
      donePath,
      readFileSync(donePath, "utf-8").replace("status: ready", "status: done"),
      "utf-8",
    );
    expect(
      git(repoDir, [
        "status",
        "--short",
        "--untracked-files=all",
        "--",
        "data/tasks",
      ]),
    ).toContain(`?? data/tasks/done/${TASK_ID}.md`);

    expect(stageRepoTaskStateMutation(repoDir, TASK_ID)).toEqual([
      `data/tasks/ready/${TASK_ID}.md`,
      `data/tasks/done/${TASK_ID}.md`,
    ]);
    expect(git(repoDir, ["status", "--short", "--", "data/tasks"])).toMatch(
      /^R {2}data\/tasks\/ready\/task-linked-worktree-move\.md -> data\/tasks\/done\/task-linked-worktree-move\.md$/,
    );
  });
});
