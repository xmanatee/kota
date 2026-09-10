import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDecompositionOwnership } from "./assessment-ownership.js";
import {
  failedBuilderMetadata,
  writeActionableTask,
} from "./workflow-test-support.js";

const TASK_ID = "task-canonical-move-ownership";
const roots: string[] = [];

function project(): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-decomposer-ownership-"));
  roots.push(workspaceRoot);
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  return workspaceRoot;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("decomposer assessment ownership", () => {
  it("resolves the exact task bound to the failed builder trigger", () => {
    const workspaceRoot = project();
    const task = writeActionableTask(workspaceRoot, TASK_ID);
    const metadata = failedBuilderMetadata(task);

    expect(resolveDecompositionOwnership(workspaceRoot, metadata)).toMatchObject({
      kind: "owned-task",
      task: {
        id: TASK_ID,
        path: `data/tasks/${TASK_ID}.md`,
        digest: task.taskDigest,
        markdown: readFileSync(join(workspaceRoot, task.taskPath), "utf8"),
      },
    });
  });

  it("rejects uncommitted task content even when HEAD still matches the admitted contract", () => {
    const workspaceRoot = project();
    const task = writeActionableTask(workspaceRoot, TASK_ID);
    const metadata = failedBuilderMetadata(task);
    execFileSync("git", ["add", "--", task.taskPath], { cwd: workspaceRoot });
    execFileSync("git", [
      "-c", "user.name=KOTA Test", "-c", "user.email=test@example.com",
      "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "--quiet", "-m", "admitted task",
    ], { cwd: workspaceRoot });
    const published = execFileSync("git", ["show", `HEAD:${task.taskPath}`], {
      cwd: workspaceRoot, encoding: "utf8",
    });

    writeActionableTask(workspaceRoot, TASK_ID, "Changed task intent.");
    expect(readFileSync(join(workspaceRoot, task.taskPath), "utf8")).not.toBe(published);

    expect(resolveDecompositionOwnership(workspaceRoot, metadata)).toEqual({
      kind: "superseded-task",
      reason: `Builder task ${TASK_ID} changed after the failed run was admitted`,
    });
  });

  it("rejects source metadata outside the builder queue contract", () => {
    const workspaceRoot = project();
    const task = writeActionableTask(workspaceRoot, TASK_ID);
    const metadata = failedBuilderMetadata(task);
    metadata.trigger = { ...metadata.trigger, event: "runtime.idle" };

    expect(() => resolveDecompositionOwnership(workspaceRoot, metadata)).toThrow(
      "requires a failed builder run triggered by autonomy.queue.available",
    );
  });
});
