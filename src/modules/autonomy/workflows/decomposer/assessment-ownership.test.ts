import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { resolveDecompositionOwnership } from "./assessment-ownership.js";
import {
  failedBuilderMetadata,
  writeActionableTask,
} from "./workflow-test-support.js";

const TASK_ID = "task-canonical-move-ownership";
const roots: string[] = [];

function project(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "kota-decomposer-ownership-"));
  roots.push(projectDir);
  execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
  return projectDir;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("decomposer assessment ownership", () => {
  it("resolves the exact task bound to the failed builder trigger", () => {
    const projectDir = project();
    const task = writeActionableTask(projectDir, TASK_ID, "doing");
    const metadata = failedBuilderMetadata(task);

    expect(resolveDecompositionOwnership(projectDir, metadata)).toMatchObject({
      kind: "owned-task",
      task: {
        id: TASK_ID,
        path: `data/tasks/doing/${TASK_ID}.md`,
        digest: task.taskDigest,
      },
    });
  });

  it("treats a canonical ready-to-doing move as a changed immutable contract", () => {
    const projectDir = project();
    const task = writeActionableTask(projectDir, TASK_ID, "ready");
    const metadata = failedBuilderMetadata(task);
    execFileSync("git", ["add", "--", task.taskPath], { cwd: projectDir });

    moveTaskById(projectDir, TASK_ID, "doing");

    expect(resolveDecompositionOwnership(projectDir, metadata)).toEqual({
      kind: "superseded-task",
      reason: `Builder task ${TASK_ID} changed after the failed run was admitted`,
    });
  });

  it("rejects source metadata outside the builder queue contract", () => {
    const projectDir = project();
    const task = writeActionableTask(projectDir, TASK_ID, "doing");
    const metadata = failedBuilderMetadata(task);
    metadata.trigger = { ...metadata.trigger, event: "runtime.idle" };

    expect(() => resolveDecompositionOwnership(projectDir, metadata)).toThrow(
      "requires a failed builder run triggered by autonomy.queue.available",
    );
  });
});
