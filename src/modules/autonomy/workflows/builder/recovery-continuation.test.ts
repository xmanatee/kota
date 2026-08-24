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

import {
  inspectPendingBuilderRecoveriesInWorker,
  listPendingBuilderRecoveries,
} from "./recovery-continuation.js";

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

function writeTask(
  projectDir: string,
  id: string,
  taskClass: "Safety" | "Platform" | "Meta",
  priority: "p0" | "p1" | "p2",
  status: "doing" | "ready" = "ready",
): void {
  const dir = join(projectDir, "data", "tasks", status);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `title: ${id}`,
      `status: ${status}`,
      `priority: ${priority}`,
      "area: core",
      `task_class: ${taskClass}`,
      `summary: ${id}`,
      "created_at: 2026-08-01T00:00:00.000Z",
      "updated_at: 2026-08-01T00:00:00.000Z",
      "---",
      "",
      "## Problem",
      "",
      id,
      "",
    ].join("\n"),
    "utf8",
  );
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

  it("requests a clean pending merge whose branch contains an unintegrated commit", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "builder-clean-pending-merge-"));
    tempDirs.push(projectDir);
    const candidate = continuedRecoveryCandidate(projectDir);
    candidate.claim.status = "pending-merge";
    candidate.recoveryStatus = "pending-merge";
    candidate.ownerRunStatus = "success";
    candidate.worktree.state = "pending-merge";
    candidate.worktree.dirtyState = "clean";
    candidate.worktree.dirtyEntries = [];
    candidate.worktree.uniqueCommits = ["checkpoint123"];
    candidate.worktree.uniqueCommitCount = 1;
    candidate.worktree.branchAhead = 1;
    candidate.worktree.canonicalReconciliation = {
      phase: "conflict-blocked",
      disposition: "needs-review",
      originalBaseCommit: "abc123",
      checkpointCommit: "checkpoint123",
      canonicalHeadCommit: "canonical123",
      integratedCanonicalHeadCommit: null,
      branchBehindAtStart: 1,
      branchBehindAtResume: null,
      overlappingPaths: [],
      canonicalDestructivePaths: [],
      conflicts: [],
      validations: [],
      reason: "canonical checkout was dirty",
      artifactPath: join(projectDir, "reconciliation.json"),
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    listRecoveryClaims.mockReturnValue([candidate]);

    expect(listPendingBuilderRecoveries(projectDir)).toEqual([candidate]);
  });

  it("keeps a clean pending merge with recorded conflicts review-only", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "builder-conflicted-pending-merge-"));
    tempDirs.push(projectDir);
    const candidate = continuedRecoveryCandidate(projectDir);
    candidate.claim.status = "pending-merge";
    candidate.recoveryStatus = "pending-merge";
    candidate.ownerRunStatus = "success";
    candidate.worktree.state = "pending-merge";
    candidate.worktree.dirtyState = "clean";
    candidate.worktree.dirtyEntries = [];
    candidate.worktree.uniqueCommits = ["checkpoint123"];
    candidate.worktree.uniqueCommitCount = 1;
    candidate.worktree.canonicalReconciliation = {
      disposition: "needs-review",
      conflicts: [
        { path: "src/shared.ts", kind: "text", reason: "unresolved conflict" },
      ],
      canonicalDestructivePaths: [],
    } as unknown as NonNullable<
      typeof candidate.worktree.canonicalReconciliation
    >;
    listRecoveryClaims.mockReturnValue([candidate]);

    expect(listPendingBuilderRecoveries(projectDir)).toEqual([]);
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

  it("keeps a deliberate yield eligible for dispatcher-ranked recovery", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "builder-priority-yield-"));
    tempDirs.push(projectDir);
    const runDir = join(projectDir, ".kota", "runs", "recovery-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "terminal-worktree-finalizer.json"),
      JSON.stringify({
        recoveryRequested: true,
        continuationDecision: "preserve-yield",
        recoveryAction: { kind: "priority-yield" },
      }),
      "utf8",
    );
    const candidate = continuedRecoveryCandidate(projectDir);
    candidate.worktree.dirtyState = "clean";
    candidate.worktree.uniqueCommits = ["checkpoint123"];
    candidate.worktree.uniqueCommitCount = 1;
    candidate.worktree.canonicalReconciliation = {
      phase: "ready-to-resume",
      disposition: "ready-to-resume",
      originalBaseCommit: "base123",
      checkpointCommit: "checkpoint123",
      canonicalHeadCommit: "canonical123",
      integratedCanonicalHeadCommit: "integrated123",
      conflicts: [],
      validations: [],
      artifactPath: join(runDir, "builder-yield-checkpoint.json"),
    } as unknown as NonNullable<
      typeof candidate.worktree.canonicalReconciliation
    >;
    listRecoveryClaims.mockReturnValue([candidate]);

    expect(listPendingBuilderRecoveries(projectDir)).toEqual([candidate]);
  });

  it("holds needs-owner work out of automatic recovery", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "builder-needs-owner-"));
    tempDirs.push(projectDir);
    const runDir = join(projectDir, ".kota", "runs", "recovery-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "terminal-worktree-finalizer.json"),
      JSON.stringify({
        recoveryRequested: false,
        continuationDecision: "needs-owner",
        recoveryAction: { kind: "owner-decision-required" },
      }),
      "utf8",
    );
    listRecoveryClaims.mockReturnValue([continuedRecoveryCandidate(projectDir)]);

    expect(listPendingBuilderRecoveries(projectDir)).toEqual([]);
  });

  it("defers recovery behind a higher-ranked claimable task", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "builder-recovery-frontier-"));
    tempDirs.push(projectDir);
    writeTask(projectDir, "task-one", "Platform", "p1");
    writeTask(projectDir, "task-security", "Safety", "p1");
    listRecoveryClaims.mockReturnValue([continuedRecoveryCandidate(projectDir)]);
    const result = inspectPendingBuilderRecoveriesInWorker({ projectDir });

    expect(result).toEqual({ candidateCount: 1, requested: [] });
  });

  it("lets newly proven P0 Safety work outrank a yielded doing task", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "builder-priority-yield-frontier-"));
    tempDirs.push(projectDir);
    writeTask(projectDir, "task-one", "Platform", "p1", "doing");
    writeTask(projectDir, "task-safety", "Safety", "p0");
    const candidate = continuedRecoveryCandidate(projectDir);
    candidate.claim.taskState = "doing";
    listRecoveryClaims.mockReturnValue([candidate]);

    expect(inspectPendingBuilderRecoveriesInWorker({ projectDir })).toEqual({
      candidateCount: 1,
      requested: [],
    });
  });

  it("requests recovery when it outranks the claimable frontier", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "builder-recovery-frontier-"));
    tempDirs.push(projectDir);
    writeTask(projectDir, "task-one", "Platform", "p1");
    writeTask(projectDir, "task-meta", "Meta", "p2");
    listRecoveryClaims.mockReturnValue([continuedRecoveryCandidate(projectDir)]);
    const result = inspectPendingBuilderRecoveriesInWorker({ projectDir });

    expect(result.requested).toHaveLength(1);
    expect(result.requested[0]?.taskId).toBe("task-one");
  });
});
