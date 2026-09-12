import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
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

  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "explorer-test-"));
    mkdirSync(join(tempDir, "data", "tasks", "archive"), { recursive: true });
    const authority = new RunStateDatabase(join(tempDir, ".kota"));
    authority.registerScope({ id: deriveDirectoryScopeId(tempDir), rootPath: tempDir, createdAt: new Date().toISOString() });
    authority.close();
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
      "## Desired Outcome",
      "Operators can find the source of a failed workflow from its status view.",
      "",
      "## Acceptance",
      "The failed status links to the retained error evidence for that run.",
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
        state: { stateDir: join(tempDir, ".kota"), scopeId: deriveDirectoryScopeId(tempDir) },
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

    expect(result.status, result.error).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      actionableCount: 1,
      activeCount: 1,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("skips explore when the queue is empty but the refresh window is not due", async () => {
    const state = createTestTransactionalRunState(join(tempDir, ".kota", "test-state"));
    state.compareAndSet(EXPLORER_STATE_KEY, 0, {
      lastExplorationAt: new Date().toISOString(),
    });

    const result = await runExplorerScenario({
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      ports: { state },
    });

    expect(result.status, result.error).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: false,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it.each([
    { held: true, tasks: 0, explore: true },
    { held: true, tasks: 1, explore: true },
    { held: true, tasks: 5, explore: false },
    { held: false, tasks: 0, explore: false },
  ])("rechecks inbox ownership before exploration: $held held, $tasks tasks", async ({ held, tasks, explore }) => {
    mkdirSync(join(tempDir, "data/inbox"));
    writeFileSync(join(tempDir, "data/inbox/task-capture.md"), "Investigate a grounded improvement.\n");
    for (let index = 0; index < tasks; index++) writeTask(`task-independent-${index}`);
    if (held) {
      const database = new RunStateDatabase(join(tempDir, ".kota"));
      const now = new Date().toISOString();
      const { epoch } = database.beginDaemonSession(now);
      database.admitRun({ id: "held-sorter", scopeId: deriveDirectoryScopeId(tempDir), workflow: "inbox-sorter", repository: "write",
        trigger: { event: "autonomy.inbox.available", schemaRef: null, payload: {} },
        resources: ["autonomy:inbox-triage"], admittedAt: now });
      database.startRun("held-sorter", epoch, now);
      database.suspendRun({ runId: "held-sorter", epoch, state: "waiting", suspendedAt: now });
      database.close();
    }
    const result = await runExplorerScenario({
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepOutputs: { explore: { turns: [], totalCostUsd: 0.02 } },
    });
    expect(result.status, result.error).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({ inboxCount: 1, availableCount: tasks, needsAttention: explore });
    expect(result.steps.explore.status).toBe(explore ? "success" : "skipped");
  });
});
