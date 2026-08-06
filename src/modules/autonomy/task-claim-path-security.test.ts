import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimNextQueueTask,
  readActiveTaskClaim,
  taskClaimPath,
} from "#modules/autonomy/task-claims.js";
import {
  makeProject,
  queueInput,
  writeTask,
} from "#modules/autonomy/task-claims-test-support.js";

describe("task claim queue path security", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked queue-state parent before creating a claim", () => {
    const projectDir = makeProject();
    const siblingProjectDir = makeProject();
    roots.push(projectDir, siblingProjectDir);
    const taskId = "task-sibling-parent-disclosure";
    writeTask(
      siblingProjectDir,
      "ready",
      taskId,
      "2026-08-06T00:00:00.000Z",
      "source_marker: SIBLING_PARENT_SECRET must not cross the project boundary.",
    );
    const readyDir = join(projectDir, "data", "tasks", "ready");
    rmSync(readyDir, { recursive: true });
    symlinkSync(join(siblingProjectDir, "data", "tasks", "ready"), readyDir);

    expect(() =>
      claimNextQueueTask(
        queueInput(projectDir, "run-linked-parent", new Date("2026-08-06T01:00:00Z")),
      ),
    ).toThrow(/symbolic-link directory components are forbidden/);
    expect(existsSync(taskClaimPath(projectDir, taskId))).toBe(false);
  });

  it("rejects a symlinked queue entry before creating a claim", () => {
    const projectDir = makeProject();
    const siblingProjectDir = makeProject();
    roots.push(projectDir, siblingProjectDir);
    const taskId = "task-sibling-entry-disclosure";
    writeTask(
      siblingProjectDir,
      "ready",
      taskId,
      "2026-08-06T00:00:00.000Z",
      "source_marker: SIBLING_ENTRY_SECRET must not cross the project boundary.",
    );
    symlinkSync(
      join(siblingProjectDir, "data", "tasks", "ready", `${taskId}.md`),
      join(projectDir, "data", "tasks", "ready", `${taskId}.md`),
    );

    expect(() =>
      claimNextQueueTask(
        queueInput(projectDir, "run-linked-entry", new Date("2026-08-06T01:00:00Z")),
      ),
    ).toThrow(/symbolic-link markdown entries are forbidden/);
    expect(existsSync(taskClaimPath(projectDir, taskId))).toBe(false);
  });

  it("resolves a legacy claim through the verified current task path", () => {
    const projectDir = makeProject();
    roots.push(projectDir);
    const taskId = "task-legacy-verified-claim";
    writeTask(
      projectDir,
      "ready",
      taskId,
      "2026-08-06T00:00:00.000Z",
    );
    const claimPath = taskClaimPath(projectDir, taskId);
    mkdirSync(join(claimPath, ".."), { recursive: true });
    writeFileSync(
      claimPath,
      `${JSON.stringify({
        schemaVersion: 1,
        taskId,
        taskState: "ready",
        runId: "run-legacy-claim",
        workflowId: "builder",
        owner: "workflow:builder",
        workspaceDir: join(projectDir, ".worktrees", "run-legacy-claim"),
        branch: `kota/task/${taskId}/run-legacy-claim`,
        baseCommit: "abc1234",
        leaseMs: 60_000,
        leaseAcquiredAt: "2026-08-06T00:00:00.000Z",
        leaseExpiresAt: "2026-08-06T01:00:00.000Z",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
        status: "active",
        evidence: null,
      }, null, 2)}\n`,
      "utf8",
    );

    expect(readActiveTaskClaim(projectDir, taskId)).toMatchObject({
      schemaVersion: 2,
      taskId,
      taskState: "ready",
      taskFile: {
        path: `data/tasks/ready/${taskId}.md`,
      },
    });
  });
});
