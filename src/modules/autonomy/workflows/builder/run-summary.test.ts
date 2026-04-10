import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext, WorkflowStepResult } from "../../../../core/workflow/run-types.js";
import { writeBuilderRunSummary } from "./run-summary.js";
import builderWorkflow from "./workflow.js";

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
}

function makeStepResult(
  status: WorkflowStepResult["status"],
  durationMs = 0,
): WorkflowStepResult {
  return { id: "", type: "code", status, startedAt: "", completedAt: "", durationMs };
}

function makeContext(
  projectDir: string,
  runDirPath: string,
  stepResults: Record<string, WorkflowStepResult["status"] | WorkflowStepResult> = {},
  stepOutputs: Record<string, unknown> = {},
): WorkflowStepContext {
  const results: Record<string, WorkflowStepResult> = {};
  for (const [id, statusOrResult] of Object.entries(stepResults)) {
    results[id] =
      typeof statusOrResult === "string"
        ? makeStepResult(statusOrResult)
        : statusOrResult;
  }
  return {
    stepResults: results,
    stepOutputs,
    previousOutput: undefined,
    stepOutputList: [],
    projectDir,
    workflow: {
      name: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runId: "2026-01-01T00-00-00-000Z-builder-test",
      runDir: ".kota/runs/test",
      runDirPath: runDirPath,
    },
    trigger: { event: "workflow.completed", payload: {} },
    runTool: async () => ({ content: [] }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
  } as unknown as WorkflowStepContext;
}

describe("writeBuilderRunSummary", () => {
  let tmpBase: string;
  let projectDir: string;
  let runDirPath: string;

  beforeEach(() => {
    tmpBase = join(
      tmpdir(),
      `kota-run-summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

  it("writes run-summary.json to the run directory", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    execSync("git add -A && git commit -m 'test change'", { cwd: projectDir, shell: "/bin/sh" });

    const ctx = makeContext(projectDir, runDirPath);
    writeBuilderRunSummary(ctx);

    expect(existsSync(join(runDirPath, "run-summary.json"))).toBe(true);
  });

  it("returns a summary with expected shape", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    execSync("git add -A && git commit -m 'test change'", { cwd: projectDir, shell: "/bin/sh" });

    const buildResult = makeStepResult("success", 120000);
    const ctx = makeContext(projectDir, runDirPath, { build: buildResult }, {
      build: { totalCostUsd: 0.42 },
    });
    const summary = writeBuilderRunSummary(ctx);

    expect(summary.runId).toBe("2026-01-01T00-00-00-000Z-builder-test");
    expect(summary.workflow).toBe("builder");
    expect(summary.outcome).toBe("success");
    expect(summary.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(summary.commitMessage).toBe("test change");
    expect(summary.filesChanged).toContain("change.txt");
    expect(summary.costUsd).toBe(0.42);
    expect(summary.durationMs).toBe(120000);
    expect(summary.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("extracts taskId and taskTitle from a task file touched in the commit", () => {
    mkdirSync(join(projectDir, "data", "tasks", "done"), { recursive: true });
    writeFileSync(
      join(projectDir, "data", "tasks", "done", "task-foo-bar.md"),
      "---\nid: task-foo-bar\ntitle: Foo bar feature\nstatus: done\n---\n",
    );
    execSync("git add -A && git commit -m 'Foo bar feature'", {
      cwd: projectDir,
      shell: "/bin/sh",
    });

    const ctx = makeContext(projectDir, runDirPath);
    const summary = writeBuilderRunSummary(ctx);

    expect(summary.taskId).toBe("task-foo-bar");
    expect(summary.taskTitle).toBe("Foo bar feature");
  });

  it("sets taskId and taskTitle to null when no task file is in the commit", () => {
    writeFileSync(join(projectDir, "src.ts"), "// code\n");
    execSync("git add -A && git commit -m 'Some code change'", {
      cwd: projectDir,
      shell: "/bin/sh",
    });

    const ctx = makeContext(projectDir, runDirPath);
    const summary = writeBuilderRunSummary(ctx);

    expect(summary.taskId).toBeNull();
    expect(summary.taskTitle).toBeNull();
  });

  it("sets costUsd and durationMs to null when build output is absent", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    execSync("git add -A && git commit -m 'test change'", { cwd: projectDir, shell: "/bin/sh" });

    const ctx = makeContext(projectDir, runDirPath);
    const summary = writeBuilderRunSummary(ctx);

    expect(summary.costUsd).toBeNull();
    expect(summary.durationMs).toBeNull();
  });

  it("written JSON matches returned summary", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    execSync("git add -A && git commit -m 'test change'", { cwd: projectDir, shell: "/bin/sh" });

    const ctx = makeContext(projectDir, runDirPath);
    const summary = writeBuilderRunSummary(ctx);

    const written = JSON.parse(readFileSync(join(runDirPath, "run-summary.json"), "utf-8"));
    expect(written).toEqual(summary);
  });
});

describe("builder workflow write-run-summary step", () => {
  const summaryStep = builderWorkflow.steps.find((s) => s.id === "write-run-summary");

  it("write-run-summary step exists in the workflow", () => {
    expect(summaryStep).toBeDefined();
    expect(summaryStep?.when).toBeDefined();
  });

  it("skips write-run-summary when commit produced no commit", async () => {
    const ctx = {
      stepResults: {
        commit: makeStepResult("success"),
      },
      stepOutputs: { commit: { committed: false } },
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

    expect(await summaryStep!.when!(ctx)).toBe(false);
  });

  it("runs write-run-summary when commit succeeded with a commit", async () => {
    const ctx = {
      stepResults: {
        commit: makeStepResult("success"),
      },
      stepOutputs: { commit: { committed: true, message: "Some commit" } },
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

    expect(await summaryStep!.when!(ctx)).toBe(true);
  });

  it("write-run-summary appears before request-restart in the workflow", () => {
    const steps = builderWorkflow.steps;
    const summaryIdx = steps.findIndex((s) => s.id === "write-run-summary");
    const restartIdx = steps.findIndex((s) => s.id === "request-restart");
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(restartIdx).toBeGreaterThan(summaryIdx);
  });
});
