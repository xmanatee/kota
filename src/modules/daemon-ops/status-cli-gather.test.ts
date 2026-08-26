import { beforeEach, describe, expect, it, vi } from "vitest";
import { readStatusRunProjection } from "./status-cli-gather.js";

const mocks = vi.hoisted(() => ({
  readRunOperationalProjection: vi.fn(),
  getRepoWorktreeStatus: vi.fn(),
}));

vi.mock("#core/workflow/run-operational-projection.js", () => ({
  readRunOperationalProjection: mocks.readRunOperationalProjection,
}));

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: mocks.getRepoWorktreeStatus,
}));

describe("readStatusRunProjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("joins durable run records to live repository workspace evidence", () => {
    mocks.readRunOperationalProjection.mockReturnValue({
      available: true,
      databasePath: "/repo/.kota/kota.sqlite",
      runs: [
        {
          runId: "run-queued",
          projectId: "project-repo",
          workflow: "builder",
          state: "queued",
          resources: ["repository:write"],
          sandbox: null,
          wait: null,
          processes: [],
          lastError: null,
        },
        {
          runId: "run-running",
          projectId: "project-repo",
          workflow: "builder",
          state: "running",
          resources: ["repository:write", "port:41000-41019"],
          sandbox: {
            runId: "run-running",
            repository: "write",
            rootDir: "/repo/.kota/runtime/run-running",
            workspaceDir: "/repo/.worktrees/runs/run-running/workspace",
            tempDir: "/repo/.kota/runtime/run-running/temp",
            artifactDir: "/repo/.kota/runtime/run-running/artifacts",
            branch: "kota/run/run-running",
            baseCommit: "1111111111111111111111111111111111111111",
          },
          wait: null,
          processes: [{ processKey: "agent", pid: 4217 }],
          lastError: null,
        },
        {
          runId: "run-waiting",
          projectId: "project-repo",
          workflow: "owner-gated",
          state: "waiting",
          resources: ["repository:read"],
          sandbox: {
            runId: "run-waiting",
            repository: "read",
            rootDir: "/repo/.kota/runtime/run-waiting",
            workspaceDir: "/repo/.worktrees/runs/run-waiting/workspace",
            tempDir: "/repo/.kota/runtime/run-waiting/temp",
            artifactDir: "/repo/.kota/runtime/run-waiting/artifacts",
            baseCommit: "2222222222222222222222222222222222222222",
          },
          wait: { kind: "approval", approvalId: "approval-17" },
          processes: [],
          lastError: null,
        },
        {
          runId: "run-attention",
          projectId: "project-repo",
          workflow: "publisher",
          state: "needs_attention",
          resources: [],
          sandbox: {
            runId: "run-attention",
            repository: "none",
            rootDir: "/repo/.kota/runtime/run-attention",
            workspaceDir: "/repo/.kota/runtime/run-attention/workspace",
            tempDir: "/repo/.kota/runtime/run-attention/temp",
            artifactDir: "/repo/.kota/runtime/run-attention/artifacts",
          },
          wait: { kind: "operator" },
          processes: [{ processKey: "publisher", status: "unknown" }],
          lastError: "process identity could not be recovered",
        },
      ],
    });
    mocks.getRepoWorktreeStatus
      .mockReturnValueOnce({
        available: true,
        dirty: true,
        trackedDirty: true,
        entries: ["M src/core/workflow/runtime.ts"],
        fingerprint: "M src/core/workflow/runtime.ts",
        summary: "M src/core/workflow/runtime.ts",
        headSha: "3333333333333333333333333333333333333333",
      })
      .mockReturnValueOnce({
        available: false,
        dirty: false,
        trackedDirty: false,
        entries: [],
        fingerprint: "",
        summary: "git status unavailable: workspace missing",
        headSha: "",
      });

    const result = readStatusRunProjection("/repo/.kota", "/repo");

    expect(mocks.readRunOperationalProjection).toHaveBeenCalledWith({
      stateDir: "/repo/.kota",
      projectDir: "/repo",
    });
    expect(mocks.getRepoWorktreeStatus).toHaveBeenNthCalledWith(
      1,
      "/repo/.worktrees/runs/run-running/workspace",
    );
    expect(mocks.getRepoWorktreeStatus).toHaveBeenNthCalledWith(
      2,
      "/repo/.worktrees/runs/run-waiting/workspace",
    );
    expect(mocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(2);
    expect(result.runs).toEqual([
      expect.objectContaining({
        runId: "run-queued",
        state: "queued",
        resources: ["repository:write"],
        processes: [],
        sandbox: null,
      }),
      expect.objectContaining({
        runId: "run-running",
        state: "running",
        resources: ["repository:write", "port:41000-41019"],
        processes: [{ processKey: "agent", pid: 4217 }],
        sandbox: expect.objectContaining({
          repository: "write",
          branch: "kota/run/run-running",
          baseCommit: "1111111111111111111111111111111111111111",
          workspace: {
            available: true,
            headCommit: "3333333333333333333333333333333333333333",
            dirty: true,
            dirtySummary: "M src/core/workflow/runtime.ts",
          },
        }),
      }),
      expect.objectContaining({
        runId: "run-waiting",
        state: "waiting",
        wait: { kind: "approval", approvalId: "approval-17" },
        sandbox: expect.objectContaining({
          repository: "read",
          branch: null,
          baseCommit: "2222222222222222222222222222222222222222",
          workspace: {
            available: false,
            headCommit: null,
            dirty: null,
            dirtySummary: "git status unavailable: workspace missing",
          },
        }),
      }),
      expect.objectContaining({
        runId: "run-attention",
        state: "needs_attention",
        wait: { kind: "operator" },
        lastError: "process identity could not be recovered",
        sandbox: expect.objectContaining({
          repository: "none",
          branch: null,
          baseCommit: null,
          workspace: null,
        }),
      }),
    ]);
  });

  it("preserves an unavailable durable projection without probing workspaces", () => {
    mocks.readRunOperationalProjection.mockReturnValue({
      available: false,
      databasePath: "/repo/.kota/kota.sqlite",
      runs: [],
    });

    expect(readStatusRunProjection("/repo/.kota", "/repo")).toEqual({
      available: false,
      databasePath: "/repo/.kota/kota.sqlite",
      runs: [],
    });
    expect(mocks.getRepoWorktreeStatus).not.toHaveBeenCalled();
  });
});
