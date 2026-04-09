import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  loadConfig: vi.fn(() => ({ extensions: { builder: { branchPerTask: true } } })),
}));

function makeCtx(overrides: Partial<{ branch: string | null; branchPerTask: boolean }> = {}) {
  const { branch = "kota/task/task-current", branchPerTask = true } = overrides;
  return {
    projectDir: "/fake/project",
    workflow: { runId: "run-001", runDir: ".kota/runs/run-001", runDirPath: "/fake/project/.kota/runs/run-001" },
    stepOutputs: {
      "create-task-branch": { branchPerTask, branch, baseBranch: "main", taskId: "task-current" },
    },
  } as never;
}

describe("cleanupMergedBranches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result when branchPerTask=false", async () => {
    const { cleanupMergedBranches } = await import("./branch-per-task.js");
    const result = cleanupMergedBranches(makeCtx({ branchPerTask: false, branch: null }));
    expect(result).toEqual({ cleaned: [], warnings: [] });
  });

  it("returns warning when gh is not available", async () => {
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 1, stdout: "", stderr: "not installed" } as never);

    const { cleanupMergedBranches } = await import("./branch-per-task.js");
    const result = cleanupMergedBranches(makeCtx());

    expect(result.cleaned).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/gh CLI not available/);
  });

  it("deletes merged kota/task/* branches, skips current branch", async () => {
    const { spawnSync } = await import("node:child_process");
    const mergedPrs = [
      { headRefName: "kota/task/task-old-1" },
      { headRefName: "kota/task/task-old-2" },
      { headRefName: "kota/task/task-current" }, // should be skipped
      { headRefName: "other/branch" },            // not kota/task — should be skipped
    ];

    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as never) // gh auth status
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(mergedPrs), stderr: "" } as never) // gh pr list
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as never) // delete task-old-1
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as never); // delete task-old-2

    const { cleanupMergedBranches } = await import("./branch-per-task.js");
    const result = cleanupMergedBranches(makeCtx({ branch: "kota/task/task-current" }));

    expect(result.cleaned).toEqual(["kota/task/task-old-1", "kota/task/task-old-2"]);
    expect(result.warnings).toEqual([]);
  });

  it("records warning and continues when a branch delete fails", async () => {
    const { spawnSync } = await import("node:child_process");
    const mergedPrs = [
      { headRefName: "kota/task/task-old-1" },
      { headRefName: "kota/task/task-old-2" },
    ];

    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as never) // gh auth status
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(mergedPrs), stderr: "" } as never) // gh pr list
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "remote: branch not found" } as never) // delete task-old-1 fails
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as never); // delete task-old-2 succeeds

    const { cleanupMergedBranches } = await import("./branch-per-task.js");
    const result = cleanupMergedBranches(makeCtx({ branch: "kota/task/task-current" }));

    expect(result.cleaned).toEqual(["kota/task/task-old-2"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/kota\/task\/task-old-1/);
  });

  it("returns warning when gh pr list fails", async () => {
    const { spawnSync } = await import("node:child_process");

    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" } as never) // gh auth status
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "API error" } as never); // gh pr list

    const { cleanupMergedBranches } = await import("./branch-per-task.js");
    const result = cleanupMergedBranches(makeCtx());

    expect(result.cleaned).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Failed to list merged PRs/);
  });
});
