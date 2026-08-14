import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { unexpectedWorkflowAgentHarnessRun } from "#core/workflow/testing/agent-harness-runner.js";
import { builderRepairChecks } from "./repair-checks.js";

function initRepo(dir: string): void {
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
}

function writeTask(
  projectDir: string,
  state: "ready" | "done" | "blocked" | "dropped",
  taskId: string,
): void {
  const taskDir = join(projectDir, "data", "tasks", state);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    join(taskDir, `${taskId}.md`),
    `---
id: ${taskId}
title: ${taskId}
status: ${state}
---
`,
  );
}

function appendTaskNote(
  projectDir: string,
  state: "ready" | "done" | "blocked" | "dropped",
  taskId: string,
  note: string,
): void {
  const taskPath = join(projectDir, "data", "tasks", state, `${taskId}.md`);
  writeFileSync(taskPath, `${readFileSync(taskPath, "utf-8")}${note}\n`);
}

function claimedTaskCommitSetCheck() {
  const check = builderRepairChecks().find(
    (candidate) => candidate.id === "claimed-task-commit-set",
  );
  expect(check).toMatchObject({
    id: "claimed-task-commit-set",
    type: "code",
    phase: 1,
  });
  if (!check || check.type !== "code") {
    throw new Error("missing claimed task commit-set check");
  }
  return check;
}

function claimContext(projectDir: string, taskId: string): WorkflowStepContext {
  const runDir = ".kota/runs/test-run";
  return {
    projectDir,
    agentRuntime: resolveAgentRuntime(undefined),
    workflow: {
      name: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runId: "test-run",
      runDir,
      runDirPath: join(projectDir, runDir),
    },
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {},
    },
    previousOutput: null,
    stepOutputs: {
      "claim-task": {
        claimed: true,
        taskId,
      },
    },
    stepResults: {},
    stepOutputList: [],
    runAgentHarness: unexpectedWorkflowAgentHarnessRun,
    runTool: async () => {
      throw new Error("runTool is not available in this test context");
    },
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({
      completedRuns: 0,
      pendingRuns: [],
      workflows: {},
    }),
    reportProgress: () => {},
    triggerWorkflow: async () => ({ runId: "queued-run", status: "queued" }),
  };
}

describe("builder repository-backed repair checks", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `kota-builder-source-size-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(repoDir, "src"), { recursive: true });
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("keeps lint validation read-only", async () => {
    writeFileSync(
      join(repoDir, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "node -e \"process.exit(0)\"",
          "lint:fix":
            "node -e \"require('node:fs').writeFileSync('lint-fix-ran', '')\"",
        },
      }),
    );
    const lint = builderRepairChecks().find((check) => check.id === "lint");
    if (!lint || lint.type !== "code") throw new Error("missing builder lint check");

    await lint.run({ projectDir: repoDir } as WorkflowStepContext, {} as never);

    expect(existsSync(join(repoDir, "lint-fix-ran"))).toBe(false);
  });

  it("passes claimed-task commit-set repair when the terminal task matches the claim", async () => {
    writeTask(repoDir, "done", "task-claimed");
    const check = claimedTaskCommitSetCheck();

    await expect(check.run(claimContext(repoDir, "task-claimed"), {} as never)).resolves.toBe(
      "OK: commit set resolves claimed task task-claimed",
    );
  });

  it("passes claimed-task commit-set repair when acceptance evidence backfills existing done tasks", async () => {
    writeTask(repoDir, "done", "task-existing-evidence");
    execSync("git add data/tasks/done/task-existing-evidence.md", { cwd: repoDir });
    execSync('git commit -q -m "existing evidence task"', { cwd: repoDir });

    appendTaskNote(
      repoDir,
      "done",
      "task-existing-evidence",
      "\n## Backfill\n\n- task_class: Platform",
    );
    writeTask(repoDir, "done", "task-claimed");
    const check = claimedTaskCommitSetCheck();

    await expect(check.run(claimContext(repoDir, "task-claimed"), {} as never)).resolves.toBe(
      "OK: commit set resolves claimed task task-claimed",
    );
  });

  it("fails claimed-task commit-set repair when the commit set completes another task too", async () => {
    writeTask(repoDir, "done", "task-claimed");
    writeTask(repoDir, "done", "task-other");
    const check = claimedTaskCommitSetCheck();

    await expect(check.run(claimContext(repoDir, "task-claimed"), {} as never))
      .rejects.toThrow(/commit set also completes task-other/);
  });

  it("fails claimed-task commit-set repair before commit when a different task is terminal", async () => {
    writeTask(repoDir, "done", "task-other");
    const check = claimedTaskCommitSetCheck();

    await expect(check.run(claimContext(repoDir, "task-claimed"), {} as never))
      .rejects.toThrow(/claimed task-claimed but the commit set identifies task-other/);
  });

  it("fails claimed-task commit-set repair when the claimed task is not terminal", async () => {
    writeTask(repoDir, "ready", "task-claimed");
    const check = claimedTaskCommitSetCheck();

    await expect(check.run(claimContext(repoDir, "task-claimed"), {} as never))
      .rejects.toThrow(/commit set does not identify a completed task/);
  });
});
