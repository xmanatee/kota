import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import {
  WorkflowScenarioDriver,
  type WorkflowScenarioOptions,
} from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { EXPLORER_STATE_KEY, type ExplorerState } from "./explorer-state.js";
import explorerWorkflow, { EXPLORATION_REFRESH_MS } from "./workflow.js";

function stateWithLastExplorationAt(lastExplorationAt: string) {
  const state = createTestTransactionalRunState();
  state.compareAndSet(EXPLORER_STATE_KEY, 0, { lastExplorationAt });
  return state;
}

describe("explorer workflow refresh", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "explorer-test-"));
    for (const state of ["open", "open", "open", "blocked", "done", "dropped"]) {
      const dir = join(tempDir, "data", "tasks", state);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "AGENTS.md"), `# ${state}\n`);
    }
    writeFileSync(join(tempDir, ".gitignore"), ".kota/\n");
    execFileSync("git", ["init", "--quiet"], { cwd: tempDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    execFileSync("git", ["config", "user.name", "KOTA test"], { cwd: tempDir });
    commitScenarioInput();
  });

  function commitScenarioInput(): void {
    execFileSync("git", ["add", "-A"], { cwd: tempDir });
    if (execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: tempDir,
      encoding: "utf8",
    }).trim()) {
      execFileSync("git", ["commit", "--quiet", "-m", "scenario input"], {
        cwd: tempDir,
      });
    }
  }

  function runExplorerScenario(
    options: Omit<WorkflowScenarioOptions, "workspaceRoot">,
  ) {
    commitScenarioInput();
    return new WorkflowScenarioDriver(explorerWorkflow, {
      ...options,
      workspaceRoot: tempDir,
      ports: {
        runCommand: successfulWorkflowCommandRun,
        ...options.ports,
      },
    }).run();
  }

  it("runs explore when the queue is empty and refresh is due", async () => {
    const result = await runExplorerScenario({
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepOutputs: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
    });

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("does not write lastExplorationAt when explore step is skipped", async () => {
    const state = stateWithLastExplorationAt(new Date().toISOString());
    const before = state.read<ExplorerState>(EXPLORER_STATE_KEY);

    await runExplorerScenario({
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      ports: { state },
    });

    expect(state.read<ExplorerState>(EXPLORER_STATE_KEY)).toEqual(before);
  });

  it("skips explore when worktree is dirty", async () => {
    writeFileSync(join(tempDir, "dirty.txt"), "uncommitted\n");
    const harness = new WorkflowScenarioDriver(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      workspaceRoot: tempDir,
      workspaceDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      dirty: true,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("trigger cooldowns match the exploration refresh window to prevent no-op churn", () => {
    for (const trigger of explorerWorkflow.triggers) {
      expect(trigger.cooldownMs).toBe(EXPLORATION_REFRESH_MS);
    }
  });

  it("does not starve exploration when skipped runs repeatedly complete", async () => {
    const thirtyFiveMinutesAgo = new Date(
      Date.now() - 35 * 60 * 1000,
    ).toISOString();
    const state = stateWithLastExplorationAt(thirtyFiveMinutesAgo);

    const result = await runExplorerScenario({
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: {
        workflows: {
          explorer: {
            lastCompletion: {
              runId: "run-explorer-skipped",
              startedAt: new Date(
                Date.now() - 2 * 60 * 1000 - 10_000,
              ).toISOString(),
              completedAt: new Date(
                Date.now() - 2 * 60 * 1000,
              ).toISOString(),
              status: "success",
            },
          },
        },
      },
      stepOutputs: { explore: { turns: [], totalCostUsd: 0.02 } },
      ports: { state },
    });

    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });
});
