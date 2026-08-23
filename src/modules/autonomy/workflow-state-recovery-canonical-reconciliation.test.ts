import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAutomationWorktree,
  updateAutomationWorktreeCanonicalReconciliation,
} from "#modules/git/index.js";
import type { AutomationWorktreeCanonicalReconciliation } from "#modules/git/worktree-lifecycle-types.js";
import { claimTask, type TaskClaim } from "./task-claims.js";
import {
  claimInput,
  makeProject,
  writeTask,
} from "./task-claims-test-support.js";
import { listRecoveryWorktrees } from "./workflow-state-recovery-claims.js";
import { readWorktreeEvidence } from "./workflow-state-recovery-worktree.js";

describe("state recovery canonical reconciliation projection", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("projects the durable reconciliation phase and lineage", () => {
    const taskId = "task-alpha";
    const runId = "run-recovery";
    writeTask(projectDir, "ready", taskId, "2026-08-15T00:00:00.000Z");
    const claimed = claimTask(
      claimInput(projectDir, taskId, runId, new Date("2026-08-15T00:01:00.000Z")),
    );
    if (!claimed.claim) throw new Error("expected claimed task fixture");
    const claim: TaskClaim = claimed.claim;
    const canonicalReconciliation: AutomationWorktreeCanonicalReconciliation = {
      phase: "ready-to-resume",
      disposition: "ready-to-resume",
      originalBaseCommit: claim.baseCommit,
      checkpointCommit: "checkpoint123",
      canonicalHeadCommit: "canonical123",
      integratedCanonicalHeadCommit: "canonical123",
      branchBehindAtStart: 3,
      branchBehindAtResume: 0,
      overlappingPaths: ["src/shared.ts"],
      canonicalDestructivePaths: [],
      conflicts: [],
      validations: [
        {
          command: ["pnpm", "run", "typecheck"],
          exitCode: 0,
          stdoutTail: "",
          stderrTail: "",
          passed: true,
        },
      ],
      reason: null,
      artifactPath: ".kota/runs/run-recovery/preserved-canonical-reconciliation.json",
      updatedAt: "2026-08-15T00:02:00.000Z",
    };
    const metadataDir = join(projectDir, ".kota", "worktrees");
    mkdirSync(metadataDir, { recursive: true });
    writeFileSync(
      join(metadataDir, `${taskId}-${runId}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        taskId,
        runId,
        workflowId: "builder",
        owner: "workflow:builder",
        workspaceDir: claim.workspaceDir,
        branch: claim.branch,
        baseCommit: claim.baseCommit,
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: canonicalReconciliation.updatedAt,
        state: "removed",
        copiedSetupFiles: [],
        removedAt: canonicalReconciliation.updatedAt,
        canonicalReconciliation,
      }, null, 2)}\n`,
      "utf8",
    );

    expect(readWorktreeEvidence(projectDir, claim)).toMatchObject({
      state: "removed",
      canonicalReconciliation: {
        phase: "ready-to-resume",
        disposition: "ready-to-resume",
        originalBaseCommit: claim.baseCommit,
        checkpointCommit: "checkpoint123",
        integratedCanonicalHeadCommit: "canonical123",
        branchBehindAtResume: 0,
      },
    });
  });

  it("projects every active reconciliation phase through the state-recovery worktree list", () => {
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: projectDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectDir });
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n.worktrees/\n", "utf8");
    execFileSync("git", ["add", ".gitignore"], { cwd: projectDir });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: projectDir });
    const canonicalHeadCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectDir,
      encoding: "utf8",
    }).trim();
    const taskId = "task-active-reconciliation";
    const runId = "run-active-reconciliation";
    const created = createAutomationWorktree({
      projectDir,
      taskId,
      runId,
      workflowId: "builder",
      owner: "workflow:builder",
    });
    const shared = {
      originalBaseCommit: created.metadata.baseCommit,
      checkpointCommit: canonicalHeadCommit,
      canonicalHeadCommit,
      integratedCanonicalHeadCommit: null,
      branchBehindAtStart: 0,
      branchBehindAtResume: null,
      overlappingPaths: [],
      canonicalDestructivePaths: [],
      conflicts: [],
      validations: [],
      reason: null,
      artifactPath: ".kota/runs/run-active-reconciliation/preserved-canonical-reconciliation.json",
      updatedAt: "2026-08-15T00:02:00.000Z",
    };
    const records: AutomationWorktreeCanonicalReconciliation[] = [
      { ...shared, phase: "checkpointing", disposition: "pending", checkpointCommit: null },
      { ...shared, phase: "reconciling-canonical", disposition: "pending" },
      {
        ...shared,
        phase: "conflict-blocked",
        disposition: "needs-review",
        reason: "canonical reconciliation needs review",
      },
      {
        ...shared,
        phase: "ready-to-resume",
        disposition: "ready-to-resume",
        integratedCanonicalHeadCommit: canonicalHeadCommit,
        branchBehindAtResume: 0,
        validations: [{
          command: ["pnpm", "run", "typecheck"],
          exitCode: 0,
          stdoutTail: "",
          stderrTail: "",
          passed: true,
        }],
      },
    ];

    for (const record of records) {
      updateAutomationWorktreeCanonicalReconciliation(
        { projectDir, taskId, runId },
        record,
      );

      expect(listRecoveryWorktrees(projectDir)).toEqual([
        expect.objectContaining({
          taskId,
          runId,
          canonicalReconciliation: expect.objectContaining({
            phase: record.phase,
            disposition: record.disposition,
          }),
        }),
      ]);
    }
  });
});
