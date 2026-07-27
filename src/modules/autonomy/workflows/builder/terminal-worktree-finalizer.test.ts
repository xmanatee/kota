import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";

const {
  inspectAutomationWorktree,
  listAutomationWorktreeUniqueCommits,
  reconcileAutomationWorktrees,
} = vi.hoisted(() => ({
  inspectAutomationWorktree: vi.fn(),
  listAutomationWorktreeUniqueCommits: vi.fn(),
  reconcileAutomationWorktrees: vi.fn(),
}));

vi.mock("#modules/git/worktree-lifecycle.js", () => ({
  inspectAutomationWorktree,
  listAutomationWorktreeUniqueCommits,
  reconcileAutomationWorktrees,
}));

import { finalizeBuilderTerminalWorktree } from "./terminal-worktree-finalizer.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function finalizerInput(status: "success" | "failed"): WorkflowTerminalFinalizerInput {
  const projectDir = mkdtempSync(join(tmpdir(), "builder-finalizer-"));
  tempDirs.push(projectDir);
  return {
    projectDir,
    workspaceDir: projectDir,
    metadata: {
      id: "builder-run",
      workflow: "builder",
      status,
      runDir: ".kota/runs/builder-run",
      steps: [
        {
          id: "prepare-worktree",
          output: { enabled: true, taskId: "task-one" },
        },
      ],
    } as WorkflowTerminalFinalizerInput["metadata"],
    trigger: {
      event: "task.ready",
      schemaRef: null,
      payload: {},
    },
    log: vi.fn(),
  };
}

describe("finalizeBuilderTerminalWorktree", () => {
  it("reconciles a successful pending-merge run", async () => {
    inspectAutomationWorktree.mockReturnValue({
      branch: "kota/task-one",
      headCommit: "abc123",
      cleanup: { blockers: ["worktree is pending merge"] },
    });
    listAutomationWorktreeUniqueCommits.mockReturnValue({
      commits: ["abc123"],
    });
    reconcileAutomationWorktrees.mockReturnValue({
      items: [
        {
          taskId: "task-one",
          runId: "builder-run",
          removed: false,
          blockers: ["worktree is pending merge"],
        },
      ],
    });
    const input = finalizerInput("success");

    await finalizeBuilderTerminalWorktree(input);

    expect(reconcileAutomationWorktrees).toHaveBeenCalledWith(input.projectDir);
    const artifact = JSON.parse(
      readFileSync(
        join(input.projectDir, input.metadata.runDir, "terminal-worktree-finalizer.json"),
        "utf8",
      ),
    ) as { removed: boolean; uniqueCommits: string[] };
    expect(artifact).toMatchObject({ removed: false, uniqueCommits: ["abc123"] });
  });
});
