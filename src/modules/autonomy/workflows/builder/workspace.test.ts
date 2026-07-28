import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builderAgentRunDir, workflowWorkspaceDir } from "./workspace.js";

describe("builder workspace helpers", () => {
  it("defaults workflow workspace to projectDir", () => {
    expect(workflowWorkspaceDir({ projectDir: "/repo" })).toBe("/repo");
  });

  it("requires an explicit absolute agentRunDir inside the active workspace", () => {
    const workspaceDir = "/repo/.worktrees/task-run";
    const agentRunDir = join(workspaceDir, ".kota", "builder-evidence", "run-1");

    expect(
      builderAgentRunDir({
        projectDir: "/repo",
        workspaceDir,
        runtimeResources: {
          profileId: "profile-1",
          agentRunDir,
          env: {},
        },
      }),
    ).toBe(agentRunDir);

    expect(() =>
      builderAgentRunDir({
        projectDir: "/repo",
        workspaceDir,
        runtimeResources: {
          profileId: "profile-1",
          agentRunDir: "/repo/.kota/runs/run-1",
          env: {},
        },
      }),
    ).toThrow(/inside the active workspace/);

    expect(() =>
      builderAgentRunDir({
        projectDir: "/repo",
        workspaceDir,
        runtimeResources: {
          profileId: "profile-1",
          agentRunDir: join(workspaceDir, ".kota", "runs", "run-1"),
          env: {},
        },
      }),
    ).toThrow(/must use \.kota\/builder-evidence/);
  });

  it("fails instead of guessing when runtime resources are missing", () => {
    expect(() =>
      builderAgentRunDir({
        projectDir: "/repo",
        workspaceDir: "/repo/.worktrees/task-run",
      }),
    ).toThrow(/missing agentRunDir/);
  });
});
