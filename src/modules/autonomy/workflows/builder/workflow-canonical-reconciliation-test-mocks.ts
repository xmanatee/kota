import { vi } from "vitest";

vi.mock("#modules/git/worktree-canonical-reconciliation.js", () => ({
  checkpointAndReconcileAutomationWorktree: vi.fn((input: {
    artifactPath: string;
    onProgress: (record: object) => void;
  }) => {
    const record = {
      phase: "ready-to-resume",
      disposition: "ready-to-resume",
      originalBaseCommit: "abc1234",
      checkpointCommit: "checkpoint123",
      canonicalHeadCommit: "canonical123",
      integratedCanonicalHeadCommit: "canonical123",
      branchBehindAtStart: 2,
      branchBehindAtResume: 0,
      overlappingPaths: [],
      canonicalDestructivePaths: [],
      conflicts: [],
      validations: [],
      reason: null,
      artifactPath: input.artifactPath,
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    input.onProgress(record);
    return record;
  }),
}));
