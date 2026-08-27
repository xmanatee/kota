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
import { EXPLORER_STATE_KEY } from "./explorer-state.js";
import explorerWorkflow from "./workflow.js";

describe("explorer workflow thin queue gating", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "explorer-test-"));
    mkdirSync(join(tempDir, "data", "tasks", "archive"), { recursive: true });
    writeFileSync(join(tempDir, ".gitignore"), ".kota/\n");
    execFileSync("git", ["init", "--quiet"], { cwd: tempDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    execFileSync("git", ["config", "user.name", "KOTA test"], { cwd: tempDir });
  });

  function writeTask(id: string): void {
    writeFileSync(join(tempDir, "data", "tasks", `${id}.md`), [
      "---",
      "status: open",
      "priority: p2",
      "---",
      "",
      `# ${id}`,
      "",
    ].join("\n"));
  }

  function runExplorerScenario(
    options: Omit<WorkflowScenarioOptions, "workspaceRoot">,
  ) {
    execFileSync("git", ["add", "-A"], { cwd: tempDir });
    execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", "scenario input"], {
      cwd: tempDir,
    });
    return new WorkflowScenarioDriver(explorerWorkflow, {
      ...options,
      workspaceRoot: tempDir,
      ports: {
        runCommand: successfulWorkflowCommandRun,
        ...options.ports,
      },
    }).run();
  }

  it("runs explore when a single open task remains and refresh is due", async () => {
    writeTask("task-open");

    const result = await runExplorerScenario({
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepOutputs: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
    });

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      actionableCount: 1,
      activeCount: 1,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("skips explore when the queue is empty but the refresh window is not due", async () => {
    const state = createTestTransactionalRunState();
    state.compareAndSet(EXPLORER_STATE_KEY, 0, {
      lastExplorationAt: new Date().toISOString(),
    });

    const result = await runExplorerScenario({
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      ports: { state },
    });

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: false,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });
});
