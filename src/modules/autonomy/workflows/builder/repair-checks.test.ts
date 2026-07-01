import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
  OBSERVABILITY_OBLIGATION_WARNING_TYPE,
} from "#modules/autonomy/observability-obligation.js";
import { SOURCE_FILE_SIZE_WARNING_TYPE } from "#modules/autonomy/source-size-check.js";
import {
  SOURCE_FILE_SEVERE_BATCH_THRESHOLD,
  SOURCE_FILE_SIZE_SEVERE_TYPE,
} from "#modules/autonomy/source-size-escalation.js";
import { SOURCE_FILE_SIZE_REVIEW_ARTIFACT } from "#modules/autonomy/source-size-review-artifact.js";
import { builderRepairChecks } from "./repair-checks.js";

function lines(count: number): string {
  return `${Array.from({ length: count }, (_, i) => `export const value${i} = ${i};`).join("\n")}\n`;
}

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

  it("wires severe source-size batches as blocking while preserving advisory warning artifacts", async () => {
    for (let i = 0; i < SOURCE_FILE_SEVERE_BATCH_THRESHOLD; i += 1) {
      writeFileSync(join(repoDir, "src", `large-${i}.ts`), lines(301));
    }
    execSync("git add src", { cwd: repoDir });
    const runDir = join(repoDir, ".kota", "runs", "test-run");
    mkdirSync(runDir, { recursive: true });
    const checks = new Map(builderRepairChecks().map((check) => [check.id, check]));
    const severe = checks.get(SOURCE_FILE_SIZE_SEVERE_TYPE);
    const advisory = checks.get(SOURCE_FILE_SIZE_WARNING_TYPE);
    const ctx = {
      projectDir: repoDir,
      workflow: { runDirPath: runDir },
    } as WorkflowStepContext;

    expect(severe).toMatchObject({
      id: SOURCE_FILE_SIZE_SEVERE_TYPE,
      type: "code",
      phase: 1,
    });
    expect(advisory).toMatchObject({
      id: SOURCE_FILE_SIZE_WARNING_TYPE,
      type: "code",
      severity: "warning",
      phase: 1,
    });
    if (!severe || severe.type !== "code") throw new Error("missing severe source-size check");
    if (!advisory || advisory.type !== "code") throw new Error("missing advisory source-size check");

    expect(() => severe.run(ctx, {} as never)).toThrow(/Blocking severe source-size failure/);
    expect(JSON.parse(readFileSync(join(runDir, SOURCE_FILE_SIZE_REVIEW_ARTIFACT), "utf-8")))
      .toMatchObject({
        outcome: "blocking",
        reasons: expect.arrayContaining([
          expect.objectContaining({
            kind: "oversized-batch",
          }),
        ]),
      });
    expect(() => advisory.run(ctx, {} as never)).toThrow(SOURCE_FILE_SIZE_WARNING_TYPE);
  });

  it("wires observability obligation diagnostics as advisory run artifacts", async () => {
    const workflowDir = join(repoDir, "src", "core", "workflow");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      join(workflowDir, "retry.ts"),
      [
        "export async function runStep(step: { run(): Promise<void> }) {",
        "  try {",
        "    return await step.run();",
        "  } catch (error) {",
        "    return null;",
        "  }",
        "}",
      ].join("\n"),
    );
    execSync("git add src/core/workflow/retry.ts", { cwd: repoDir });
    const runDir = join(repoDir, ".kota", "runs", "test-run-observability");
    mkdirSync(runDir, { recursive: true });
    const checks = new Map(builderRepairChecks().map((check) => [check.id, check]));
    const observability = checks.get(OBSERVABILITY_OBLIGATION_WARNING_TYPE);
    const ctx = {
      projectDir: repoDir,
      workflow: { runDirPath: runDir },
    } as WorkflowStepContext;

    expect(observability).toMatchObject({
      id: OBSERVABILITY_OBLIGATION_WARNING_TYPE,
      type: "code",
      severity: "warning",
      phase: 1,
    });
    if (!observability || observability.type !== "code") {
      throw new Error("missing observability obligation check");
    }

    expect(() => observability.run(ctx, {} as never)).toThrow(
      OBSERVABILITY_OBLIGATION_WARNING_TYPE,
    );
    expect(JSON.parse(readFileSync(join(runDir, OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT), "utf-8")))
      .toMatchObject({
        outcome: "warning",
        missingFiles: ["src/core/workflow/retry.ts"],
      });
  });

  it("runs repository-backed checks against workspaceDir while writing artifacts to the run directory", async () => {
    const projectDir = join(tmpdir(), `kota-builder-canonical-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(projectDir, { recursive: true });
    initRepo(projectDir);
    const workflowDir = join(repoDir, "src", "core", "workflow");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      join(workflowDir, "workspace-retry.ts"),
      [
        "export async function runStep(step: { run(): Promise<void> }) {",
        "  try {",
        "    return await step.run();",
        "  } catch (error) {",
        "    return null;",
        "  }",
        "}",
      ].join("\n"),
    );
    execSync("git add src/core/workflow/workspace-retry.ts", { cwd: repoDir });
    const runDir = join(projectDir, ".kota", "runs", "test-run-workspace");
    mkdirSync(runDir, { recursive: true });
    const checks = new Map(builderRepairChecks().map((check) => [check.id, check]));
    const observability = checks.get(OBSERVABILITY_OBLIGATION_WARNING_TYPE);
    const ctx = {
      projectDir,
      workspaceDir: repoDir,
      workflow: { runDirPath: runDir },
    } as WorkflowStepContext;

    try {
      if (!observability || observability.type !== "code") {
        throw new Error("missing observability obligation check");
      }

      expect(() => observability.run(ctx, {} as never)).toThrow(
        OBSERVABILITY_OBLIGATION_WARNING_TYPE,
      );
      expect(JSON.parse(readFileSync(join(runDir, OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT), "utf-8")))
        .toMatchObject({
          outcome: "warning",
          missingFiles: ["src/core/workflow/workspace-retry.ts"],
        });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("passes claimed-task commit-set repair when the terminal task matches the claim", () => {
    writeTask(repoDir, "done", "task-claimed");
    const check = claimedTaskCommitSetCheck();

    expect(check.run(claimContext(repoDir, "task-claimed"), {} as never)).toBe(
      "OK: commit set resolves claimed task task-claimed",
    );
  });

  it("passes claimed-task commit-set repair when acceptance evidence backfills existing done tasks", () => {
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

    expect(check.run(claimContext(repoDir, "task-claimed"), {} as never)).toBe(
      "OK: commit set resolves claimed task task-claimed",
    );
  });

  it("fails claimed-task commit-set repair when the commit set completes another task too", () => {
    writeTask(repoDir, "done", "task-claimed");
    writeTask(repoDir, "done", "task-other");
    const check = claimedTaskCommitSetCheck();

    expect(() => check.run(claimContext(repoDir, "task-claimed"), {} as never))
      .toThrow(/commit set also completes task-other/);
  });

  it("fails claimed-task commit-set repair before commit when a different task is terminal", () => {
    writeTask(repoDir, "done", "task-other");
    const check = claimedTaskCommitSetCheck();

    expect(() => check.run(claimContext(repoDir, "task-claimed"), {} as never))
      .toThrow(/claimed task-claimed but the commit set identifies task-other/);
  });

  it("fails claimed-task commit-set repair when the claimed task is not terminal", () => {
    writeTask(repoDir, "ready", "task-claimed");
    const check = claimedTaskCommitSetCheck();

    expect(() => check.run(claimContext(repoDir, "task-claimed"), {} as never))
      .toThrow(/commit set does not identify a completed task/);
  });
});
