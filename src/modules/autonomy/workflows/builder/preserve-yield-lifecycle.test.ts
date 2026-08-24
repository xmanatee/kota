import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readActiveTaskClaim } from "#modules/autonomy/task-claims.js";
import { listRecoveryClaims } from "#modules/autonomy/workflow-state-recovery-claims.js";
import { listAutomationWorktreeUniqueCommits } from "#modules/git/worktree-lifecycle.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { continueBuilderWorktreeInWorker } from "./prepare-worktree-operations.js";
import { evaluatePreserveYieldThroughController } from "./preserve-yield-controller.test-helpers.js";
import {
  CONTINUATION_RUN_ID,
  fixtureGit,
  lifecycleRoots,
  makePreserveYieldFixture,
  PRESERVED_RUN_ID,
  PRESERVED_TASK_ID,
  reconcilePreservedWork,
  SAFETY_TASK_ID,
  writeFixtureFile,
  yieldedPreserveYieldMetadata,
} from "./preserve-yield-lifecycle.test-helpers.js";
import { findPreservedBuilderEvidenceRunId } from "./preserved-evidence.js";
import {
  claimPendingBuilderRecovery,
  inspectPendingBuilderRecoveriesInWorker,
} from "./recovery-continuation.js";
import { runBuilderTerminalWorktreeFinalizerInWorker } from "./terminal-worktree-finalizer-operation.js";

afterEach(() => {
  for (const root of lifecycleRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("builder preserve-yield lifecycle", () => {
  it("checkpoints, yields to P0, and resumes the same durable lineage", async () => {
    const fixture = makePreserveYieldFixture("preserve-yield-lifecycle");
    const decision = await evaluatePreserveYieldThroughController(fixture);
    expect(decision.decision).toBe("preserve-yield");
    const checkpoint = JSON.parse(
      readFileSync(
        join(
          fixture.projectDir,
          ".kota/runs",
          PRESERVED_RUN_ID,
          "builder-yield-checkpoint.json",
        ),
        "utf8",
      ),
    );
    expect(checkpoint).toMatchObject({
      disposition: "ready-to-resume",
      branchBehindAtResume: 0,
    });
    expect(checkpoint.checkpointCommit).not.toBeNull();
    const checkpointHead = fixtureGit(fixture.workspaceDir, ["rev-parse", "HEAD"]);
    const checkpointCommits = listAutomationWorktreeUniqueCommits(
      fixture.projectDir,
      fixture.branch,
    ).commits;

    const finalizerPath = join(
      fixture.projectDir,
      ".kota/runs",
      PRESERVED_RUN_ID,
      "terminal-worktree-finalizer.json",
    );
    const finalized = await runBuilderTerminalWorktreeFinalizerInWorker({
      projectDir: fixture.projectDir,
      metadata: yieldedPreserveYieldMetadata(decision),
      triggerEvent: "autonomy.queue.available",
      workspace: { taskId: PRESERVED_TASK_ID, worktreeRunId: PRESERVED_RUN_ID },
      artifactPath: finalizerPath,
    });
    expect(finalized.recoveryRequest).toBeNull();
    expect(JSON.parse(readFileSync(finalizerPath, "utf8"))).toMatchObject({
      recoveryRequested: false,
      continuationDecision: "preserve-yield",
      claimDisposition: "preserved",
      recoveryAction: { kind: "priority-yield" },
    });
    expect(readActiveTaskClaim(fixture.projectDir, PRESERVED_TASK_ID)).toMatchObject({
      runId: PRESERVED_RUN_ID,
      status: "active",
    });
    writeFixtureFile(
      join(
        fixture.projectDir,
        ".kota/runs",
        PRESERVED_RUN_ID,
        "metadata.json",
      ),
      `${JSON.stringify(yieldedPreserveYieldMetadata(decision))}\n`,
    );

    expect(
      inspectPendingBuilderRecoveriesInWorker({
        projectDir: fixture.projectDir,
      }),
    ).toEqual({ candidateCount: 1, requested: [] });

    const p0ReadyPath = join(
      fixture.projectDir,
      "data/tasks/ready",
      `${SAFETY_TASK_ID}.md`,
    );
    const p0DonePath = join(
      fixture.projectDir,
      "data/tasks/done",
      `${SAFETY_TASK_ID}.md`,
    );
    writeFixtureFile(
      p0DonePath,
      readFileSync(p0ReadyPath, "utf8").replace("status: ready", "status: done"),
    );
    rmSync(p0ReadyPath);
    fixtureGit(fixture.projectDir, ["add", "data/tasks"]);
    fixtureGit(fixture.projectDir, [
      "commit",
      "-q",
      "-m",
      "complete P0 Safety work",
    ]);
    const dispatch = inspectPendingBuilderRecoveriesInWorker({
      projectDir: fixture.projectDir,
    });
    expect(dispatch.requested).toEqual([
      expect.objectContaining({
        taskId: PRESERVED_TASK_ID,
        sourceRunId: PRESERVED_RUN_ID,
        worktreeRunId: PRESERVED_RUN_ID,
        workspaceDir: fixture.workspaceDir,
      }),
    ]);
    const request = dispatch.requested[0];
    if (request === undefined) throw new Error("recovery request is missing");

    const resumedClaim = claimPendingBuilderRecovery({
      projectDir: fixture.projectDir,
      trigger: {
        event: "autonomy.builder.recovery.requested",
        schemaRef: null,
        payload: request,
      },
      workflow: {
        name: "builder",
        definitionPath: "builder/workflow.ts",
        runId: CONTINUATION_RUN_ID,
        runDir: `.kota/runs/${CONTINUATION_RUN_ID}`,
        runDirPath: join(fixture.projectDir, ".kota/runs", CONTINUATION_RUN_ID),
      },
    });
    expect(resumedClaim).toMatchObject({
      claimed: true,
      taskId: PRESERVED_TASK_ID,
      recoveryPath: "continued-preserved-claim",
      claim: {
        runId: CONTINUATION_RUN_ID,
        worktreeRunId: PRESERVED_RUN_ID,
        workspaceDir: fixture.workspaceDir,
      },
    });
    const continued = continueBuilderWorktreeInWorker({
      projectDir: fixture.projectDir,
      taskId: PRESERVED_TASK_ID,
      worktreeRunId: PRESERVED_RUN_ID,
      continuationRunId: CONTINUATION_RUN_ID,
    });
    expect(continued.metadata.workspaceDir).toBe(fixture.workspaceDir);
    expect(continued.metadata.recoveryRunId).toBe(CONTINUATION_RUN_ID);
    expect(readFileSync(join(fixture.workspaceDir, "src/work.ts"), "utf8")).toBe(
      "export const work = 2;\n",
    );
    expect(findPreservedBuilderEvidenceRunId(fixture.workspaceDir, PRESERVED_RUN_ID)).toBe(
      PRESERVED_RUN_ID,
    );

    const resumed = await reconcilePreservedWork(
      fixture,
      CONTINUATION_RUN_ID,
      "preserved-canonical-reconciliation.json",
    );
    expect(resumed.disposition, resumed.reason ?? "reconciliation failed").toBe(
      "ready-to-resume",
    );
    expect(resumed.checkpointCommit).toBe(checkpoint.checkpointCommit);
    expect(
      fixtureGit(fixture.workspaceDir, [
        "merge-base",
        "--is-ancestor",
        checkpointHead,
        "HEAD",
      ]),
    ).toBe("");
    const resumedCommits = listAutomationWorktreeUniqueCommits(
      fixture.projectDir,
      fixture.branch,
    ).commits;
    expect(resumedCommits).toHaveLength(checkpointCommits.length + 1);
    expect(
      fixtureGit(fixture.workspaceDir, [
        "log",
        "--format=%s",
        `${fixture.baseCommit}..HEAD`,
      ])
        .split("\n")
        .filter((subject) =>
          subject.startsWith("Checkpoint preserved builder work for"),
        ),
    ).toEqual([
      `Checkpoint preserved builder work for ${PRESERVED_RUN_ID}`,
    ]);
    expect(
      listFullRepoTasks(fixture.projectDir).filter((task) => task.id === PRESERVED_TASK_ID),
    ).toHaveLength(1);
    expect(listRecoveryClaims(fixture.projectDir)).toEqual([]);
    expect(readActiveTaskClaim(fixture.projectDir, PRESERVED_TASK_ID)).toMatchObject({
      runId: CONTINUATION_RUN_ID,
      worktreeRunId: PRESERVED_RUN_ID,
      workspaceDir: fixture.workspaceDir,
      status: "active",
    });
  });

});
