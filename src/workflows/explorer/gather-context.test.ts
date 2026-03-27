import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata, WorkflowRuntimeState, WorkflowStepContext } from "../../workflow/types.js";
import { gatherExplorerContext } from "./gather-context.js";

function makeMetadata(id: string, workflow: string, overrides: Partial<WorkflowRunMetadata> = {}): WorkflowRunMetadata {
  return {
    id,
    workflow,
    definitionPath: `src/workflows/${workflow}/workflow.ts`,
    trigger: { event: "runtime.idle", payload: {} },
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

function makeContext(
  projectDir: string,
  inspectOutput: unknown = null,
  state?: Partial<WorkflowRuntimeState>,
): WorkflowStepContext {
  const runtimeState: WorkflowRuntimeState = {
    completedRuns: 7,
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
      name: "explorer",
      definitionPath: "src/workflows/explorer/workflow.ts",
      runId: "test-run",
      runDir: ".kota/runs/test-run",
      runDirPath: join(projectDir, ".kota/runs/test-run"),
    },
    trigger: { event: "runtime.idle", payload: {} },
    previousOutput: null,
    stepOutputs: inspectOutput != null ? { "inspect-queue": inspectOutput } : {},
    stepResults: {},
    stepOutputList: [],
    runTool: async () => ({ content: "" }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => runtimeState,
  };
}

describe("gatherExplorerContext", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-explorer-ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("sets needsAttention=true when inspect-queue output indicates it", () => {
    const ctx = makeContext(projectDir, {
      needsAttention: true,
      counts: { inbox: 1, ready: 0, backlog: 0, doing: 0, blocked: 0, done: 0, dropped: 0 },
    });
    const result = gatherExplorerContext(ctx);
    expect(result.needsAttention).toBe(true);
  });

  it("sets needsAttention=false when inspect-queue output does not indicate it", () => {
    const ctx = makeContext(projectDir, {
      needsAttention: false,
      counts: { inbox: 0, ready: 3, backlog: 5, doing: 0, blocked: 0, done: 10, dropped: 1 },
    });
    const result = gatherExplorerContext(ctx);
    expect(result.needsAttention).toBe(false);
  });

  it("sets needsAttention=false when inspect-queue output is absent", () => {
    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    expect(result.needsAttention).toBe(false);
  });

  it("extracts taskCounts from inspect-queue output", () => {
    const counts = { inbox: 2, ready: 1, backlog: 3, doing: 0, blocked: 1, done: 50, dropped: 2 };
    const ctx = makeContext(projectDir, { needsAttention: true, counts });
    const result = gatherExplorerContext(ctx);
    expect(result.taskCounts).toEqual(counts);
  });

  it("returns empty taskCounts when inspect-queue output is absent", () => {
    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    expect(result.taskCounts).toEqual({});
  });

  it("returns recent runs from the last 24h", () => {
    const runId = "2026-03-20T00-00-00-000Z-builder-abc123";
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify(makeMetadata(runId, "builder")),
    );

    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    expect(result.recentRuns.some((r) => r.id === runId)).toBe(true);
  });

  it("omits durationMs and totalCostUsd from run summaries when not present", () => {
    const runId = "2026-03-20T00-00-00-000Z-builder-noCost";
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    const meta = makeMetadata(runId, "builder");
    delete (meta as Partial<WorkflowRunMetadata>).durationMs;
    delete (meta as Partial<WorkflowRunMetadata>).totalCostUsd;
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(meta));

    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    const run = result.recentRuns.find((r) => r.id === runId);
    expect(run).toBeDefined();
    expect(run).not.toHaveProperty("durationMs");
    expect(run).not.toHaveProperty("totalCostUsd");
  });

  it("returns costByWorkflow aggregated from recentRuns", () => {
    const runs = [
      { id: "run1", workflow: "builder", cost: 0.4 },
      { id: "run2", workflow: "explorer", cost: 0.1 },
      { id: "run3", workflow: "explorer", cost: 0.2 },
    ];
    for (const { id, workflow, cost } of runs) {
      const runDir = join(projectDir, ".kota", "runs", id);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "metadata.json"), JSON.stringify(makeMetadata(id, workflow, { totalCostUsd: cost })));
    }

    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);

    expect(result.costByWorkflow.builder).toBeCloseTo(0.4);
    expect(result.costByWorkflow.explorer).toBeCloseTo(0.3);
  });

  it("returns recentCommits as an array (may be empty in test env without git)", () => {
    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    expect(Array.isArray(result.recentCommits)).toBe(true);
  });

  it("returns runtime state with completedRuns and workflow summaries", () => {
    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    expect(result.runtimeState.completedRuns).toBe(7);
    expect(result.runtimeState.workflows.builder).toEqual({
      lastStatus: "success",
      lastRunId: "builder-run-1",
    });
    expect(result.runtimeState.workflows.explorer).toEqual({
      lastStatus: "success",
      lastRunId: "explorer-run-1",
    });
  });

  function writeTaskFile(dir: string, filename: string, attrs: Record<string, string>) {
    const frontmatter = Object.entries(attrs)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    writeFileSync(join(dir, filename), `---\n${frontmatter}\n---\n`);
  }

  it("returns openTaskSummaries for tasks in ready and backlog", () => {
    const readyDir = join(projectDir, "tasks", "ready");
    const backlogDir = join(projectDir, "tasks", "backlog");
    mkdirSync(readyDir, { recursive: true });
    mkdirSync(backlogDir, { recursive: true });

    writeTaskFile(readyDir, "task-foo.md", {
      id: "task-foo",
      title: "Foo task",
      summary: "A ready task",
      status: "ready",
      priority: "p1",
    });
    writeTaskFile(backlogDir, "task-bar.md", {
      id: "task-bar",
      title: "Bar task",
      summary: "A backlog task",
      status: "backlog",
      priority: "p2",
    });

    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);

    expect(result.openTaskSummaries).toEqual(
      expect.arrayContaining([
        { id: "task-foo", title: "Foo task", summary: "A ready task", status: "ready", priority: "p1" },
        { id: "task-bar", title: "Bar task", summary: "A backlog task", status: "backlog", priority: "p2" },
      ]),
    );
  });

  it("returns empty openTaskSummaries when both ready and backlog are empty", () => {
    mkdirSync(join(projectDir, "tasks", "ready"), { recursive: true });
    mkdirSync(join(projectDir, "tasks", "backlog"), { recursive: true });

    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    expect(result.openTaskSummaries).toEqual([]);
  });

  it("returns openTaskSummaries when only one state has tasks", () => {
    const readyDir = join(projectDir, "tasks", "ready");
    mkdirSync(readyDir, { recursive: true });
    writeTaskFile(readyDir, "task-only.md", {
      id: "task-only",
      title: "Only task",
      summary: "Just one",
      status: "ready",
      priority: "p3",
    });

    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    expect(result.openTaskSummaries).toHaveLength(1);
    expect(result.openTaskSummaries[0]).toMatchObject({ id: "task-only", status: "ready" });
  });

  it("skips AGENTS.md and uses empty string for missing summary", () => {
    const readyDir = join(projectDir, "tasks", "ready");
    mkdirSync(readyDir, { recursive: true });
    writeFileSync(join(readyDir, "AGENTS.md"), "# AGENTS\nsome content\n");
    writeTaskFile(readyDir, "task-nosummary.md", {
      id: "task-nosummary",
      title: "No summary task",
      status: "ready",
      priority: "p2",
    });

    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    expect(result.openTaskSummaries).toHaveLength(1);
    expect(result.openTaskSummaries[0].summary).toBe("");
  });
});
