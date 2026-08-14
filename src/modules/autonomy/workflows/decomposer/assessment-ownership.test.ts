import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  taskClaimContentDigest,
  taskClaimContractDigest,
} from "#modules/autonomy/task-claim-task-binding.js";
import {
  claimTask,
  markTaskClaimPendingDecomposition,
} from "#modules/autonomy/task-claims.js";
import {
  moveTaskById,
  readVerifiedRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { resolveDecompositionOwnership } from "./assessment-ownership.js";

const TASK_ID = "task-canonical-move-ownership";
const RUN_ID = "run-canonical-move-ownership";

function taskMarkdown(): string {
  return `---
id: ${TASK_ID}
title: Preserve task ownership across a canonical move
status: ready
priority: p1
area: security
task_class: Safety
summary: Prove the decomposer recognizes the claimed task after ready to doing.
created_at: 2026-08-13T00:00:00.000Z
updated_at: 2026-08-13T00:00:00.000Z
---

## Problem

The canonical task mover replaces the destination inode.

## Done When

- Ownership survives only the canonical lifecycle rewrite.

## Acceptance Evidence

- This regression executes the production task mover.
`;
}

describe("decomposer assessment ownership", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("binds a genuine ready-to-doing move even though the inode changes", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-decomposer-move-"));
    roots.push(projectDir);
    const readyDir = join(projectDir, "data", "tasks", "ready");
    const runDir = join(projectDir, ".kota", "runs", RUN_ID);
    mkdirSync(readyDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(readyDir, `${TASK_ID}.md`), taskMarkdown(), "utf8");

    execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
    execFileSync("git", ["add", "--", `data/tasks/ready/${TASK_ID}.md`], {
      cwd: projectDir,
    });

    const claimedTask = readVerifiedRepoTaskFile(projectDir, "ready", TASK_ID);
    if (claimedTask === null) throw new Error("ready task fixture is missing");
    const taskFile = { path: claimedTask.path, snapshot: claimedTask.snapshot };
    const claimed = claimTask({
      projectDir,
      taskId: TASK_ID,
      taskState: "ready",
      taskFile,
      runId: RUN_ID,
      workflowId: "builder",
      owner: "workflow:builder",
      workspaceDir: projectDir,
      branch: "main",
      baseCommit: "fixture-base",
      leaseMs: 60_000,
      now: new Date("2026-08-13T00:00:00.000Z"),
    });
    if (claimed.claim === null) throw new Error("task claim fixture was not created");
    const artifactClaim = claimed.claim;
    writeFileSync(
      join(runDir, "task-claim.json"),
      `${JSON.stringify({ claimed: true, taskId: TASK_ID, claim: artifactClaim }, null, 2)}\n`,
      "utf8",
    );

    moveTaskById(projectDir, TASK_ID, "doing");
    expect(
      markTaskClaimPendingDecomposition({
        projectDir,
        taskId: TASK_ID,
        runId: RUN_ID,
        workflowId: "builder",
        evidence: "builder timed out",
        now: new Date("2026-08-13T01:00:00.000Z"),
      }).changed,
    ).toBe(true);
    const movedTask = readVerifiedRepoTaskFile(projectDir, "doing", TASK_ID);
    if (movedTask === null) throw new Error("doing task fixture is missing");
    expect(movedTask.snapshot.ino).not.toBe(claimedTask.snapshot.ino);
    expect(taskClaimContractDigest(movedTask.content)).toBe(
      artifactClaim.taskContractDigest,
    );
    expect(taskClaimContentDigest(movedTask.content)).not.toBe(
      artifactClaim.taskContentDigest,
    );

    expect(
      resolveDecompositionOwnership(projectDir, {
        runId: RUN_ID,
        runDir: `.kota/runs/${RUN_ID}`,
      }),
    ).toMatchObject({
      kind: "owned-task",
      task: {
        id: TASK_ID,
        path: `data/tasks/doing/${TASK_ID}.md`,
      },
    });
  });
});
