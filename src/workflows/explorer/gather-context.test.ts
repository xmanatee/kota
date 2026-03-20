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
  previousOutput: unknown = null,
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
    previousOutput,
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

  it("sets needsAttention=true when previousOutput indicates it", () => {
    const ctx = makeContext(projectDir, {
      needsAttention: true,
      counts: { inbox: 1, ready: 0, backlog: 0, doing: 0, blocked: 0, done: 0, dropped: 0 },
    });
    const result = gatherExplorerContext(ctx);
    expect(result.needsAttention).toBe(true);
  });

  it("sets needsAttention=false when previousOutput does not indicate it", () => {
    const ctx = makeContext(projectDir, {
      needsAttention: false,
      counts: { inbox: 0, ready: 3, backlog: 5, doing: 0, blocked: 0, done: 10, dropped: 1 },
    });
    const result = gatherExplorerContext(ctx);
    expect(result.needsAttention).toBe(false);
  });

  it("sets needsAttention=false when previousOutput is null", () => {
    const ctx = makeContext(projectDir, null);
    const result = gatherExplorerContext(ctx);
    expect(result.needsAttention).toBe(false);
  });

  it("extracts taskCounts from previousOutput", () => {
    const counts = { inbox: 2, ready: 1, backlog: 3, doing: 0, blocked: 1, done: 50, dropped: 2 };
    const ctx = makeContext(projectDir, { needsAttention: true, counts });
    const result = gatherExplorerContext(ctx);
    expect(result.taskCounts).toEqual(counts);
  });

  it("returns empty taskCounts when previousOutput has none", () => {
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

    const ctx = makeContext(projectDir, { runDir: `.kota/runs/${runId}` });
    const result = gatherExplorerContext(ctx);
    const run = result.recentRuns.find((r) => r.id === runId);
    expect(run).toBeDefined();
    expect(run).not.toHaveProperty("durationMs");
    expect(run).not.toHaveProperty("totalCostUsd");
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
});
