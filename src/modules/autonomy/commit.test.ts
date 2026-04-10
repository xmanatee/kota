import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext, WorkflowStepResult } from "#core/workflow/run-types.js";
import { commitWorkflowChanges } from "./commit.js";
import builderWorkflow from "./workflows/builder/workflow.js";

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
}

function makeStepResult(status: WorkflowStepResult["status"]): WorkflowStepResult {
  return { id: "", type: "tool", status, startedAt: "", completedAt: "", durationMs: 0 };
}

function makeContext(
  stepResults: Record<string, WorkflowStepResult["status"]>,
  stepOutputs: Record<string, unknown> = {},
): WorkflowStepContext {
  const results: Record<string, WorkflowStepResult> = {};
  for (const [id, status] of Object.entries(stepResults)) {
    results[id] = makeStepResult(status);
  }
  return {
    stepResults: results,
    stepOutputs,
    previousOutput: undefined,
    stepOutputList: [],
    projectDir: "/tmp",
    workflow: { name: "builder", definitionPath: "", runId: "", runDir: "", runDirPath: "" },
    trigger: { event: "", payload: {} },
    runTool: async () => ({ content: [] }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
  } as unknown as WorkflowStepContext;
}

describe("commitWorkflowChanges", () => {
  let tmpBase: string;
  let projectDir: string;
  let runDirPath: string;

  beforeEach(() => {
    tmpBase = join(
      tmpdir(),
      `kota-commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    projectDir = join(tmpBase, "project");
    runDirPath = join(tmpBase, "run");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(runDirPath, { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("returns committed=false when there are no working tree changes", () => {
    expect(commitWorkflowChanges(projectDir, runDirPath)).toEqual({ committed: false });
  });

  it("commits unstaged working tree changes using the commit-message.txt file", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    writeFileSync(join(runDirPath, "commit-message.txt"), "Builder: my custom message");

    const result = commitWorkflowChanges(projectDir, runDirPath);
    expect(result).toEqual({ committed: true, message: "Builder: my custom message" });

    const log = execSync("git log --format=%s -1", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(log).toBe("Builder: my custom message");
  });

  it("commits working tree changes with a default message when commit-message.txt is absent", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");

    const result = commitWorkflowChanges(projectDir, runDirPath);
    expect(result).toEqual({ committed: true, message: "Workflow: update repo" });

    const log = execSync("git log --format=%s -1", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(log).toBe("Workflow: update repo");
  });
});

describe("builder workflow commit and restart gates", () => {
  const commitStep = builderWorkflow.steps.find((s) => s.id === "commit");
  const restartStep = builderWorkflow.steps.find((s) => s.id === "request-restart");

  it("commit step exists in the workflow", () => {
    expect(commitStep).toBeDefined();
    expect(commitStep?.when).toBeDefined();
  });

  it("restart step exists in the workflow", () => {
    expect(restartStep).toBeDefined();
    expect(restartStep?.when).toBeDefined();
  });

  it("skips commit when build fails", async () => {
    const ctx = makeContext({
      build: "failed",
      "check-no-intermediate-commits": "skipped",
    });
    expect(await commitStep!.when!(ctx)).toBe(false);
  });

  it("runs commit when build passes and no intermediate commits", async () => {
    const ctx = makeContext({
      build: "success",
      "check-no-intermediate-commits": "success",
      "create-task-branch": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(true);
  });

  it("skips restart when commit produced no commit", async () => {
    const ctx = makeContext(
      { commit: "success" },
      { commit: { committed: false } },
    );
    expect(await restartStep!.when!(ctx)).toBe(false);
  });

  it("runs restart when commit produced a commit", async () => {
    const ctx = makeContext(
      { commit: "success" },
      { commit: { committed: true, message: "Workflow: update repo" } },
    );
    expect(await restartStep!.when!(ctx)).toBe(true);
  });
});
