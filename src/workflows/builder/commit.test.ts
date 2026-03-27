import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext, WorkflowStepResult } from "../../workflow/run-types.js";
import { commitBuilderChanges } from "./commit.js";
import builderWorkflow from "./workflow.js";

// ── helpers ────────────────────────────────────────────────────────────────

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
): WorkflowStepContext {
  const results: Record<string, WorkflowStepResult> = {};
  for (const [id, status] of Object.entries(stepResults)) {
    results[id] = makeStepResult(status);
  }
  return {
    stepResults: results,
    stepOutputs: {},
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

// ── commitBuilderChanges unit tests ────────────────────────────────────────

describe("commitBuilderChanges", () => {
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

  it("returns committed=false when there are no staged changes", () => {
    writeFileSync(join(projectDir, "unstaged.txt"), "unstaged\n");
    expect(commitBuilderChanges(projectDir, runDirPath)).toEqual({ committed: false });
  });

  it("commits staged changes using the commit-message.txt file", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    execSync("git add change.txt", { cwd: projectDir });
    writeFileSync(join(runDirPath, "commit-message.txt"), "Builder: my custom message");

    const result = commitBuilderChanges(projectDir, runDirPath);
    expect(result).toEqual({ committed: true, message: "Builder: my custom message" });

    const log = execSync("git log --format=%s -1", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(log).toBe("Builder: my custom message");
  });

  it("commits staged changes with a default message when commit-message.txt is absent", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    execSync("git add change.txt", { cwd: projectDir });

    const result = commitBuilderChanges(projectDir, runDirPath);
    expect(result).toEqual({ committed: true, message: "Builder: complete task" });

    const log = execSync("git log --format=%s -1", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    expect(log).toBe("Builder: complete task");
  });
});

// ── commit step gate tests ─────────────────────────────────────────────────

describe("builder workflow commit gate", () => {
  const commitStep = builderWorkflow.steps.find((s) => s.id === "commit");

  it("commit step exists in the workflow", () => {
    expect(commitStep).toBeDefined();
    expect(commitStep?.when).toBeDefined();
  });

  it("is skipped when verify-typecheck fails", async () => {
    const ctx = makeContext({
      "verify-typecheck": "failed",
      "verify-lint": "success",
      "verify-test": "success",
      "verify-build": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(false);
  });

  it("is skipped when verify-lint fails", async () => {
    const ctx = makeContext({
      "verify-typecheck": "success",
      "verify-lint": "failed",
      "verify-test": "success",
      "verify-build": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(false);
  });

  it("is skipped when verify-test fails", async () => {
    const ctx = makeContext({
      "verify-typecheck": "success",
      "verify-lint": "success",
      "verify-test": "failed",
      "verify-build": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(false);
  });

  it("is skipped when verify-build fails", async () => {
    const ctx = makeContext({
      "verify-typecheck": "success",
      "verify-lint": "success",
      "verify-test": "success",
      "verify-build": "failed",
    });
    expect(await commitStep!.when!(ctx)).toBe(false);
  });

  it("is skipped when any verify step is missing (skipped)", async () => {
    const ctx = makeContext({
      "verify-typecheck": "success",
      "verify-lint": "success",
      // verify-test absent — step was skipped, not recorded
      "verify-build": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(false);
  });

  it("runs when all four verify steps pass", async () => {
    const ctx = makeContext({
      "verify-typecheck": "success",
      "verify-lint": "success",
      "verify-test": "success",
      "verify-build": "success",
    });
    expect(await commitStep!.when!(ctx)).toBe(true);
  });
});
