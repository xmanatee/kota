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
    for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
      const dir = join(tempDir, "data", "tasks", state);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "AGENTS.md"), `# ${state}\n`);
    }
    writeFileSync(join(tempDir, ".gitignore"), ".kota/\n");
    execFileSync("git", ["init", "--quiet"], { cwd: tempDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    execFileSync("git", ["config", "user.name", "KOTA test"], { cwd: tempDir });
  });

  function writeTask(state: "backlog" | "ready" | "doing", id: string): void {
    writeFileSync(join(tempDir, "data", "tasks", state, `${id}.md`), [
      "---",
      `id: ${id}`,
      `title: ${id}`,
      `status: ${state}`,
      "priority: p2",
      "area: autonomy",
      `summary: ${id} summary`,
      "created_at: 2026-08-01T00:00:00.000Z",
      "updated_at: 2026-08-01T00:00:00.000Z",
      "---",
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

  it("runs explore when only a one-item backlog tail remains and refresh is due", async () => {
    writeTask("backlog", "task-tail");

    const result = await runExplorerScenario({
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepOutputs: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
    });

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      pullableCount: 1,
      actionableCount: 0,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("runs explore when a single ready task remains and refresh is due", async () => {
    writeTask("ready", "task-ready");

    const result = await runExplorerScenario({
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepOutputs: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
    });

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      pullableCount: 1,
      actionableCount: 1,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("explores when only active doing work remains", async () => {
    writeTask("doing", "task-doing");

    const result = await runExplorerScenario({
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepOutputs: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
    });

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
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
