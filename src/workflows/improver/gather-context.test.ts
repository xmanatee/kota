import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata, WorkflowRuntimeState, WorkflowStepContext } from "../../workflow/types.js";
import { gatherImproverContext } from "./gather-context.js";

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

function makeContext(projectDir: string, triggerPayload: Record<string, unknown> = {}, state?: Partial<WorkflowRuntimeState>): WorkflowStepContext {
  const runtimeState: WorkflowRuntimeState = {
    completedRuns: 5,
    pendingRuns: [],
    workflows: {
      builder: { lastStatus: "success", lastRunId: "builder-run-1" },
      explorer: { lastStatus: "success", lastRunId: "explorer-run-1" },
    },
    ...state,
  };
  return {
    projectDir,
    workflow: { name: "improver", definitionPath: "src/workflows/improver/workflow.ts", runId: "test-run", runDir: ".kota/runs/test-run", runDirPath: join(projectDir, ".kota/runs/test-run") },
    trigger: { event: "workflow.completed", payload: triggerPayload },
    previousOutput: null,
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

describe("gatherImproverContext", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-improver-ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns null triggeringRun when payload has no runDir", () => {
    const ctx = makeContext(projectDir, {});
    const result = gatherImproverContext(ctx);
    expect(result.triggeringRun).toBeNull();
  });

  it("returns null triggeringRun when metadata file does not exist", () => {
    const ctx = makeContext(projectDir, { runDir: ".kota/runs/nonexistent-run" });
    const result = gatherImproverContext(ctx);
    expect(result.triggeringRun).toBeNull();
  });

  it("returns triggeringRun summary when metadata file exists", () => {
    const runId = "2026-03-20T00-00-00-000Z-builder-abc123";
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify(makeMetadata(runId, "builder", { durationMs: 120000, totalCostUsd: 0.75 })),
    );

    const ctx = makeContext(projectDir, { runDir: `.kota/runs/${runId}` });
    const result = gatherImproverContext(ctx);

    expect(result.triggeringRun).toEqual({
      id: runId,
      workflow: "builder",
      status: "success",
      durationMs: 120000,
      totalCostUsd: 0.75,
    });
  });

  it("returns recent runs from the last 24h", () => {
    const runId = "2026-03-20T00-00-00-000Z-explorer-def456";
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify(makeMetadata(runId, "explorer")),
    );

    const ctx = makeContext(projectDir, {});
    const result = gatherImproverContext(ctx);

    expect(result.recentRuns.some((r) => r.id === runId)).toBe(true);
  });

  it("returns runtime state with completedRuns and workflow summaries", () => {
    const ctx = makeContext(projectDir, {});
    const result = gatherImproverContext(ctx);

    expect(result.runtimeState.completedRuns).toBe(5);
    expect(result.runtimeState.workflows.builder).toEqual({
      lastStatus: "success",
      lastRunId: "builder-run-1",
    });
    expect(result.runtimeState.workflows.explorer).toEqual({
      lastStatus: "success",
      lastRunId: "explorer-run-1",
    });
  });

  it("returns costByWorkflow aggregated from recentRuns", () => {
    const runs = [
      { id: "run1", workflow: "builder", cost: 0.6 },
      { id: "run2", workflow: "improver", cost: 0.3 },
      { id: "run3", workflow: "builder", cost: 0.2 },
    ];
    for (const { id, workflow, cost } of runs) {
      const runDir = join(projectDir, ".kota", "runs", id);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "metadata.json"), JSON.stringify(makeMetadata(id, workflow, { totalCostUsd: cost })));
    }

    const ctx = makeContext(projectDir, {});
    const result = gatherImproverContext(ctx);

    expect(result.costByWorkflow.builder).toBeCloseTo(0.8);
    expect(result.costByWorkflow.improver).toBeCloseTo(0.3);
  });

  it("returns empty recentCommits when not in a git repo", () => {
    const ctx = makeContext(projectDir, {});
    const result = gatherImproverContext(ctx);
    expect(Array.isArray(result.recentCommits)).toBe(true);
  });

  it("returns changedFiles as an array (empty when not in a git repo with history)", () => {
    const ctx = makeContext(projectDir, {});
    const result = gatherImproverContext(ctx);
    expect(Array.isArray(result.changedFiles)).toBe(true);
  });

  it("omits durationMs and totalCostUsd when not present", () => {
    const runId = "2026-03-20T00-00-00-000Z-builder-noCost";
    const runDir = join(projectDir, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    const meta = makeMetadata(runId, "builder");
    delete (meta as Partial<WorkflowRunMetadata>).durationMs;
    delete (meta as Partial<WorkflowRunMetadata>).totalCostUsd;
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(meta));

    const ctx = makeContext(projectDir, { runDir: `.kota/runs/${runId}` });
    const result = gatherImproverContext(ctx);

    expect(result.triggeringRun).not.toHaveProperty("durationMs");
    expect(result.triggeringRun).not.toHaveProperty("totalCostUsd");
  });
});
