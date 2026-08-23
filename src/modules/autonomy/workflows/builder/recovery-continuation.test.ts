import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStateRecoveryClaim } from "#modules/workflow-ops/state-recovery-provider.js";

const { listRecoveryClaims } = vi.hoisted(() => ({
  listRecoveryClaims: vi.fn(),
}));

vi.mock("#modules/autonomy/workflow-state-recovery-claims.js", () => ({
  listRecoveryClaims,
}));

import { listPendingBuilderRecoveries } from "./recovery-continuation.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function continuedRecoveryCandidate(projectDir: string): WorkflowStateRecoveryClaim {
  return {
    claim: {
      taskId: "task-one",
      taskState: "ready",
      runId: "recovery-run",
      worktreeRunId: "builder-run",
      workflowId: "builder",
      owner: "workflow:builder",
      workspaceDir: join(projectDir, ".worktrees", "task-one-builder-run"),
      branch: "kota/task/task-one/builder-run",
      baseCommit: "abc123",
      status: "active",
      evidence: "preserved builder work",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    claimPath: join(projectDir, ".kota", "task-claims", "active", "task-one.json"),
    recoveryStatus: "stale",
    safeToRetry: false,
    ownerRunStatus: "failed",
    worktree: {
      found: true,
      metadataPath: join(projectDir, ".kota", "worktrees", "task-one.json"),
      workspaceDir: join(projectDir, ".worktrees", "task-one-builder-run"),
      branch: "kota/task/task-one/builder-run",
      state: "active",
      runState: "finished",
      dirtyState: "dirty",
      dirtyEntries: ["M src/recovered.ts"],
      cleanupBlockers: ["worktree has uncommitted tracked changes"],
      mergeStatus: "not merged",
      headCommit: "abc123",
      uniqueCommits: [],
      uniqueCommitCount: 0,
      branchAhead: 0,
      branchBehind: 0,
    },
    relatedDeadLetters: [],
    recommendedAction: {
      kind: "needs-review",
      reason: "worktree contains preserved uncommitted changes",
    },
  };
}

describe("builder recovery continuation bounds", () => {
	it("requests unresolved pending merge after the prior continuation declined a generic retry", () => {
		const projectDir = mkdtempSync(join(tmpdir(), "builder-pending-merge-recovery-"));
		tempDirs.push(projectDir);
		const runDir = join(projectDir, ".kota", "runs", "recovery-run");
		mkdirSync(runDir, { recursive: true });
		writeFileSync(
			join(runDir, "terminal-worktree-finalizer.json"),
			JSON.stringify({
				recoveryRequested: false,
				recoveryAction: { kind: "state-recovery-required" },
			}),
			"utf8",
		);
		const candidate = continuedRecoveryCandidate(projectDir);
		candidate.claim.status = "pending-merge";
		candidate.recoveryStatus = "pending-merge";
		candidate.ownerRunStatus = "success";
		candidate.worktree.state = "pending-merge";
		candidate.worktree.dirtyState = "conflicted";
		candidate.worktree.dirtyEntries = ["UU src/shared.ts"];
		listRecoveryClaims.mockReturnValue([candidate]);

		expect(listPendingBuilderRecoveries(projectDir)).toEqual([candidate]);
	});

  it("does not requeue a continuation after its finalizer requires state recovery", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "builder-recovery-bound-"));
    tempDirs.push(projectDir);
    const runDir = join(projectDir, ".kota", "runs", "recovery-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "terminal-worktree-finalizer.json"),
      JSON.stringify({
        recoveryRequested: false,
        recoveryAction: { kind: "state-recovery-required" },
      }),
      "utf8",
    );
    listRecoveryClaims.mockReturnValue([continuedRecoveryCandidate(projectDir)]);

    expect(listPendingBuilderRecoveries(projectDir)).toEqual([]);
  });
});
