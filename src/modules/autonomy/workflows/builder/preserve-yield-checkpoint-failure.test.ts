import { readFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readActiveTaskClaim } from "#modules/autonomy/task-claims.js";
import { inspectAutomationWorktree } from "#modules/git/worktree-lifecycle.js";
import {
  evaluatePreserveYieldThroughController,
  failedCheckpointMetadata,
} from "./preserve-yield-controller.test-helpers.js";
import {
  fixtureGit,
  lifecycleRoots,
  makePreserveYieldFixture,
  PRESERVED_RUN_ID,
  PRESERVED_TASK_ID,
  writeFixtureFile,
} from "./preserve-yield-lifecycle.test-helpers.js";
import { runBuilderTerminalWorktreeFinalizerInWorker } from "./terminal-worktree-finalizer-operation.js";

afterEach(() => {
  for (const root of lifecycleRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("builder preserve-yield checkpoint failure", () => {
  it("keeps ownership and the dirty diff", async () => {
    const fixture = makePreserveYieldFixture("preserve-yield-checkpoint-failure");
    const indexLock = fixtureGit(fixture.workspaceDir, [
      "rev-parse",
      "--git-path",
      "index.lock",
    ]);
    writeFixtureFile(
      isAbsolute(indexLock) ? indexLock : join(fixture.workspaceDir, indexLock),
      "checkpoint blocked by fixture\n",
    );

    await expect(evaluatePreserveYieldThroughController(fixture)).rejects.toThrow(
      /preserve-yield checkpoint failed.*index\.lock/i,
    );
    const checkpoint = JSON.parse(readFileSync(join(
      fixture.projectDir,
      ".kota/runs",
      PRESERVED_RUN_ID,
      "builder-yield-checkpoint.json",
    ), "utf8"));
    expect(checkpoint).toMatchObject({
      disposition: "needs-review",
      checkpointCommit: null,
    });
    expect(checkpoint.reason).toContain("index.lock");
    expect(readActiveTaskClaim(fixture.projectDir, PRESERVED_TASK_ID)).toMatchObject({
      runId: PRESERVED_RUN_ID,
      status: "active",
      workspaceDir: fixture.workspaceDir,
    });
    expect(inspectAutomationWorktree({
      projectDir: fixture.projectDir,
      taskId: PRESERVED_TASK_ID,
      runId: PRESERVED_RUN_ID,
    }).dirty.dirty).toBe(true);
    expect(readFileSync(join(fixture.workspaceDir, "src/work.ts"), "utf8")).toBe(
      "export const work = 2;\n",
    );

    const finalizerPath = join(
      fixture.projectDir,
      ".kota/runs",
      PRESERVED_RUN_ID,
      "terminal-worktree-finalizer.json",
    );
    await runBuilderTerminalWorktreeFinalizerInWorker({
      projectDir: fixture.projectDir,
      metadata: failedCheckpointMetadata(),
      triggerEvent: "autonomy.queue.available",
      workspace: { taskId: PRESERVED_TASK_ID, worktreeRunId: PRESERVED_RUN_ID },
      artifactPath: finalizerPath,
    });
    expect(JSON.parse(readFileSync(finalizerPath, "utf8"))).toMatchObject({
      continuationDecision: null,
      claimDisposition: "preserved",
      recoveryAction: { kind: "none" },
    });
    expect(readActiveTaskClaim(fixture.projectDir, PRESERVED_TASK_ID)).toMatchObject({
      runId: PRESERVED_RUN_ID,
      status: "active",
      workspaceDir: fixture.workspaceDir,
    });
  });
});
