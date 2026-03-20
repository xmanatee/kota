import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata, WorkflowRuntimeState, WorkflowStepContext } from "../../workflow/types.js";
import { gatherBuilderContext } from "./gather-context.js";

function makeMetadata(id: string, workflow: string, overrides: Partial<WorkflowRunMetadata> = {}): WorkflowRunMetadata {
  return {
    id,
    workflow,
    definitionPath: `src/workflows/${workflow}/workflow.ts`,
    trigger: { event: "workflow.completed", payload: {} },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: "success",
    durationMs: 10000,
    totalCostUsd: 0.5,
    runDir: `.kota/runs/${id}`,
    steps: [],
    ...overrides,
  };
}

function makeContext(projectDir: string, state?: Partial<WorkflowRuntimeState>): WorkflowStepContext {
  const runtimeState: WorkflowRuntimeState = {
    completedRuns: 8,
    pendingRuns: [],
    workflows: {
      builder: { lastStatus: "success", lastRunId: "builder-run-1" },
      explorer: { lastStatus: "success", lastRunId: "explorer-run-1" },
    },
    ...state,
  };
  return {
    projectDir,
    workflow: {
      name: "builder",
      definitionPath: "src/workflows/builder/workflow.ts",
      runId: "test-run",
      runDir: ".kota/runs/test-run",
      runDirPath: join(projectDir, ".kota/runs/test-run"),
    },
    trigger: { event: "workflow.completed", payload: {} },
    previousOutput: { validCount: 2, invalidTasks: [] },
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    runTool: async () => ({ content: "" }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => runtimeState,
  };
}

describe("gatherBuilderContext", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-builder-ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    mkdirSync(join(projectDir, "tasks", "ready"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns taskCounts from the task queue snapshot", () => {
    const ctx = makeContext(projectDir);
    const result = gatherBuilderContext(ctx);
    expect(result.taskCounts).toBeDefined();
    expect(typeof result.taskCounts).toBe("object");
  });

  it("returns recent runs from the last 24h", () => {
    const runId = "2026-03-20T00-00-00-000Z-explorer-abc123";
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify(makeMetadata(runId, "explorer", { durationMs: 90000, totalCostUsd: 0.3 })),
    );

    const ctx = makeContext(projectDir);
    const result = gatherBuilderContext(ctx);

    expect(result.recentRuns.some((r) => r.id === runId)).toBe(true);
    const run = result.recentRuns.find((r) => r.id === runId);
    expect(run?.workflow).toBe("explorer");
    expect(run?.status).toBe("success");
    expect(run?.durationMs).toBe(90000);
    expect(run?.totalCostUsd).toBe(0.3);
  });

  it("omits durationMs and totalCostUsd from run summaries when not present", () => {
    const runId = "2026-03-20T00-00-00-000Z-builder-noCost";
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    const meta = makeMetadata(runId, "builder");
    delete (meta as Partial<WorkflowRunMetadata>).durationMs;
    delete (meta as Partial<WorkflowRunMetadata>).totalCostUsd;
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(meta));

    const ctx = makeContext(projectDir);
    const result = gatherBuilderContext(ctx);
    const run = result.recentRuns.find((r) => r.id === runId);
    expect(run).toBeDefined();
    expect(run).not.toHaveProperty("durationMs");
    expect(run).not.toHaveProperty("totalCostUsd");
  });

  it("returns recentCommits as an array (may be empty in test env without git)", () => {
    const ctx = makeContext(projectDir);
    const result = gatherBuilderContext(ctx);
    expect(Array.isArray(result.recentCommits)).toBe(true);
  });

  it("returns runtime state with completedRuns and workflow summaries", () => {
    const ctx = makeContext(projectDir);
    const result = gatherBuilderContext(ctx);

    expect(result.runtimeState.completedRuns).toBe(8);
    expect(result.runtimeState.workflows.builder).toEqual({
      lastStatus: "success",
      lastRunId: "builder-run-1",
    });
    expect(result.runtimeState.workflows.explorer).toEqual({
      lastStatus: "success",
      lastRunId: "explorer-run-1",
    });
  });

  it("limits recent runs to 20", () => {
    for (let i = 0; i < 25; i++) {
      const runId = `2026-03-20T00-00-00-${String(i).padStart(3, "0")}Z-builder-run${i}`;
      const runDir = join(projectDir, ".kota", "runs", runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "metadata.json"), JSON.stringify(makeMetadata(runId, "builder")));
    }

    const ctx = makeContext(projectDir);
    const result = gatherBuilderContext(ctx);
    expect(result.recentRuns.length).toBeLessThanOrEqual(20);
  });

  it("returns recentlyAttemptedTaskIds as an array (empty when no git repo)", () => {
    const ctx = makeContext(projectDir);
    const result = gatherBuilderContext(ctx);
    expect(Array.isArray(result.recentlyAttemptedTaskIds)).toBe(true);
  });

  describe("recentlyAttemptedTaskIds with git history", () => {
    let gitDir: string;

    beforeEach(() => {
      gitDir = join(
        tmpdir(),
        `kota-git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(join(gitDir, ".kota", "runs"), { recursive: true });
      mkdirSync(join(gitDir, "tasks", "done"), { recursive: true });
      mkdirSync(join(gitDir, "tasks", "doing"), { recursive: true });
      mkdirSync(join(gitDir, "tasks", "ready"), { recursive: true });

      const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t.com" };
      execSync("git init", { cwd: gitDir, env });
      execSync("git commit --allow-empty -m 'init'", { cwd: gitDir, env });
    });

    afterEach(() => {
      rmSync(gitDir, { recursive: true, force: true });
    });

    it("extracts task IDs from Builder commits touching tasks/done/", () => {
      const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t.com" };
      writeFileSync(join(gitDir, "tasks", "done", "task-fix-auth.md"), "done");
      execSync("git add tasks/done/task-fix-auth.md", { cwd: gitDir, env });
      execSync("git commit -m 'Builder: fix auth flow'", { cwd: gitDir, env });

      writeFileSync(join(gitDir, "tasks", "done", "task-add-search.md"), "done");
      execSync("git add tasks/done/task-add-search.md", { cwd: gitDir, env });
      execSync("git commit -m 'Builder: add search feature'", { cwd: gitDir, env });

      const ctx = makeContext(gitDir);
      const result = gatherBuilderContext(ctx);

      expect(result.recentlyAttemptedTaskIds).toContain("task-fix-auth");
      expect(result.recentlyAttemptedTaskIds).toContain("task-add-search");
    });

    it("excludes task IDs from non-Builder commits", () => {
      const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t.com" };
      writeFileSync(join(gitDir, "tasks", "done", "task-explorer-triage.md"), "done");
      execSync("git add tasks/done/task-explorer-triage.md", { cwd: gitDir, env });
      execSync("git commit -m 'Explorer: triage tasks'", { cwd: gitDir, env });

      const ctx = makeContext(gitDir);
      const result = gatherBuilderContext(ctx);

      expect(result.recentlyAttemptedTaskIds).not.toContain("task-explorer-triage");
    });

    it("limits recentlyAttemptedTaskIds to 10 entries", () => {
      const env = { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t.com" };
      for (let i = 0; i < 15; i++) {
        const slug = `task-item-${i}`;
        writeFileSync(join(gitDir, "tasks", "done", `${slug}.md`), "done");
        execSync(`git add tasks/done/${slug}.md`, { cwd: gitDir, env });
        execSync(`git commit -m 'Builder: implement item ${i}'`, { cwd: gitDir, env });
      }

      const ctx = makeContext(gitDir);
      const result = gatherBuilderContext(ctx);

      expect(result.recentlyAttemptedTaskIds.length).toBeLessThanOrEqual(10);
    });
  });
});
