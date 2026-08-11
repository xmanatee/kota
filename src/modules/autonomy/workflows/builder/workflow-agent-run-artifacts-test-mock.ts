import { vi } from "vitest";

vi.mock("./agent-run-artifacts.js", async () => {
  const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");

  return {
    checkAgentRunArtifactsReady: vi.fn(() => "OK: builder run evidence ready"),
    checkBuilderWorkflowChangesStageable: vi.fn(
      () => "OK: builder workflow changes stageable",
    ),
    commitBuilderWorkflowChanges: vi.fn((workspaceDir: string, agentRunDir: string) =>
      commitWorkflowChanges(workspaceDir, agentRunDir),
    ),
  };
});
