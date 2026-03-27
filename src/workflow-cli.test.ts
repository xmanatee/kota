import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOptionalJsonFile } from "./json-file.js";
import { getEligibleAtMs } from "./workflow/run-executor-utils.js";
import { WorkflowRunStore } from "./workflow/run-store.js";
import type {
  WorkflowDefinition,
  WorkflowRunMetadata,
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "./workflow/types.js";

// Isolated test for the trigger command's core logic:
// cooldown checks and queue writes via WorkflowRunStore.

describe("workflow trigger command logic", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-wf-trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("enqueues a workflow when queue is empty", () => {
    const now = Date.now();
    store.setPendingRuns([
      {
        workflowName: "builder",
        trigger: { event: "manual", payload: { triggeredAt: new Date().toISOString() } },
        enqueuedAtMs: now,
        notBeforeMs: now,
      },
    ]);

    const state = store.readState();
    expect(state.pendingRuns).toHaveLength(1);
    expect(state.pendingRuns[0].workflowName).toBe("builder");
    expect(state.pendingRuns[0].trigger.event).toBe("manual");
  });

  it("detects a workflow already in the queue", () => {
    const now = Date.now();
    store.setPendingRuns([
      {
        workflowName: "builder",
        trigger: { event: "manual", payload: {} },
        enqueuedAtMs: now,
        notBeforeMs: now,
      },
    ]);

    const state = store.readState();
    const alreadyQueued = state.pendingRuns.some((r) => r.workflowName === "builder");
    expect(alreadyQueued).toBe(true);
  });

  describe("getEligibleAtMs (cooldown check)", () => {
    it("returns now when no last run exists", () => {
      const state: WorkflowRuntimeState = { completedRuns: 0, pendingRuns: [], workflows: {} };
      const before = Date.now();
      const eligibleAt = getEligibleAtMs("builder", 60_000, state);
      expect(eligibleAt).toBeGreaterThanOrEqual(before);
      expect(eligibleAt).toBeLessThanOrEqual(Date.now());
    });

    it("returns now when cooldownMs is zero", () => {
      const lastCompleted = new Date(Date.now() - 5_000).toISOString();
      const state: WorkflowRuntimeState = {
        completedRuns: 1,
        pendingRuns: [],
        workflows: { builder: { lastCompletedAt: lastCompleted, lastStatus: "success" } },
      };
      const eligibleAt = getEligibleAtMs("builder", 0, state);
      expect(eligibleAt).toBeLessThanOrEqual(Date.now());
    });

    it("returns a future time when cooldown has not elapsed", () => {
      const lastCompleted = new Date(Date.now() - 30_000).toISOString(); // 30s ago
      const cooldownMs = 120_000; // 2 min cooldown
      const state: WorkflowRuntimeState = {
        completedRuns: 1,
        pendingRuns: [],
        workflows: { builder: { lastCompletedAt: lastCompleted, lastStatus: "success" } },
      };
      const eligibleAt = getEligibleAtMs("builder", cooldownMs, state);
      expect(eligibleAt).toBeGreaterThan(Date.now());
    });

    it("returns a past time when cooldown has elapsed", () => {
      const lastCompleted = new Date(Date.now() - 200_000).toISOString(); // 200s ago
      const cooldownMs = 60_000; // 1 min cooldown
      const state: WorkflowRuntimeState = {
        completedRuns: 1,
        pendingRuns: [],
        workflows: { builder: { lastCompletedAt: lastCompleted, lastStatus: "success" } },
      };
      const eligibleAt = getEligibleAtMs("builder", cooldownMs, state);
      expect(eligibleAt).toBeLessThan(Date.now());
    });
  });
});

// ---------------------------------------------------------------------------
// Causal chain: triggeredByRunId
// ---------------------------------------------------------------------------

describe("WorkflowRunStore causal chain", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-wf-causal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const workflow: WorkflowDefinition = {
    name: "builder",
    enabled: true,
    definitionPath: "src/workflows/builder/workflow.ts",
    triggers: [{ event: "workflow.completed", cooldownMs: 0 }],
    steps: [],
  };

  it("sets triggeredByRunId when trigger payload contains runId", () => {
    const parentRunId = "2026-01-01T00-00-00-000Z-explorer-abc123";
    const run = store.createRun(workflow, {
      event: "workflow.completed",
      payload: { runId: parentRunId, workflow: "explorer", status: "success" },
    });
    expect(run.metadata.triggeredByRunId).toBe(parentRunId);
  });

  it("omits triggeredByRunId when trigger payload has no runId", () => {
    const run = store.createRun(workflow, {
      event: "runtime.idle",
      payload: {},
    });
    expect(run.metadata.triggeredByRunId).toBeUndefined();
  });

  it("omits triggeredByRunId when payload runId is not a string", () => {
    const run = store.createRun(workflow, {
      event: "workflow.completed",
      payload: { runId: 42 },
    });
    expect(run.metadata.triggeredByRunId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cost aggregation via WorkflowRunStore.finish()
// ---------------------------------------------------------------------------

const minimalWorkflow: WorkflowDefinition = {
  name: "builder",
  enabled: true,
  definitionPath: "src/workflows/builder/workflow.ts",
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [],
};

function makeStepResult(
  id: string,
  type: WorkflowStepResult["type"],
  output?: unknown,
): WorkflowStepResult {
  return {
    id,
    type,
    status: "success",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 100,
    output,
  };
}

describe("WorkflowRunStore cost aggregation", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-wf-cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("sets totalCostUsd to 0 when no agent steps exist", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", payload: {} });
    const completed = run.finish({ status: "success", durationMs: 100 });
    expect(completed.totalCostUsd).toBe(0);
  });

  it("sums totalCostUsd across agent step outputs", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", payload: {} });
    run.recordStep(makeStepResult("step1", "agent", { content: "ok", totalCostUsd: 0.01 }));
    run.recordStep(makeStepResult("step2", "agent", { content: "ok", totalCostUsd: 0.02 }));
    const completed = run.finish({ status: "success", durationMs: 200 });
    expect(completed.totalCostUsd).toBeCloseTo(0.03);
  });

  it("ignores cost from non-agent steps", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", payload: {} });
    run.recordStep(makeStepResult("s1", "agent", { content: "ok", totalCostUsd: 0.05 }));
    run.recordStep(makeStepResult("s2", "code", { result: "done" }));
    run.recordStep(makeStepResult("s3", "tool", { content: "ok", totalCostUsd: 99 }));
    const completed = run.finish({ status: "success", durationMs: 300 });
    expect(completed.totalCostUsd).toBeCloseTo(0.05);
  });

  it("treats agent steps with no cost output as zero", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", payload: {} });
    run.recordStep(makeStepResult("s1", "agent", { content: "ok" }));
    run.recordStep(makeStepResult("s2", "agent", { content: "ok", totalCostUsd: 0.03 }));
    const completed = run.finish({ status: "success", durationMs: 200 });
    expect(completed.totalCostUsd).toBeCloseTo(0.03);
  });

  it("accumulates totalCostUsd in runtime state across multiple runs", () => {
    const trigger = { event: "test", payload: {} };

    const run1 = store.createRun(minimalWorkflow, trigger);
    run1.recordStep(makeStepResult("s1", "agent", { content: "ok", totalCostUsd: 0.10 }));
    run1.finish({ status: "success", durationMs: 100 });

    const run2 = store.createRun(minimalWorkflow, trigger);
    run2.recordStep(makeStepResult("s1", "agent", { content: "ok", totalCostUsd: 0.20 }));
    run2.finish({ status: "success", durationMs: 100 });

    const state = store.readState();
    expect(state.totalCostUsd).toBeCloseTo(0.30);
  });

  it("treats existing run files without totalCostUsd as zero when accumulating", () => {
    // Simulate state already having totalCostUsd from a prior run
    store.setPendingRuns([]); // ensure state file exists with defaults
    const state = store.readState();
    expect(state.totalCostUsd).toBeUndefined();

    const run = store.createRun(minimalWorkflow, { event: "test", payload: {} });
    run.recordStep(makeStepResult("s1", "agent", { content: "ok", totalCostUsd: 0.05 }));
    run.finish({ status: "success", durationMs: 100 });

    const updated = store.readState();
    expect(updated.totalCostUsd).toBeCloseTo(0.05);
  });
});

// ---------------------------------------------------------------------------
// workflow show: per-step cost display
// ---------------------------------------------------------------------------

describe("workflow show step cost display", () => {
  it("appends cost to agent steps with totalCostUsd in output", () => {
    const step = {
      id: "build",
      type: "agent" as const,
      status: "success" as const,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5000,
      output: { content: "done", totalCostUsd: 1.791 },
    };
    const stepOutput = step.output as { totalCostUsd?: unknown } | null | undefined;
    const cost = step.type === "agent" && typeof stepOutput?.totalCostUsd === "number"
      ? ` $${stepOutput.totalCostUsd.toFixed(3)}`
      : "";
    expect(cost).toBe(" $1.791");
  });

  it("omits cost for non-agent steps", () => {
    const step: WorkflowStepResult = {
      id: "code-step",
      type: "code",
      status: "success",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 100,
      output: { totalCostUsd: 99 },
    };
    const stepOutput = step.output as { totalCostUsd?: unknown } | null | undefined;
    const cost = step.type === "agent" && typeof stepOutput?.totalCostUsd === "number"
      ? ` $${stepOutput.totalCostUsd.toFixed(3)}`
      : "";
    expect(cost).toBe("");
  });

  it("omits cost for agent steps without totalCostUsd", () => {
    const step = {
      id: "build",
      type: "agent" as const,
      status: "success" as const,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5000,
      output: { content: "done" },
    };
    const stepOutput = step.output as { totalCostUsd?: unknown } | null | undefined;
    const cost = step.type === "agent" && typeof stepOutput?.totalCostUsd === "number"
      ? ` $${stepOutput.totalCostUsd.toFixed(3)}`
      : "";
    expect(cost).toBe("");
  });

  it("omits cost for agent steps with null output", () => {
    const step = {
      id: "build",
      type: "agent" as const,
      status: "success" as const,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5000,
      output: null,
    };
    const stepOutput = step.output as { totalCostUsd?: unknown } | null | undefined;
    const cost = step.type === "agent" && typeof stepOutput?.totalCostUsd === "number"
      ? ` $${stepOutput.totalCostUsd.toFixed(3)}`
      : "";
    expect(cost).toBe("");
  });
});

// ---------------------------------------------------------------------------
// workflow show --step: step output inspection
// ---------------------------------------------------------------------------

describe("workflow show --step flag", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-wf-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns full JSON output for a step with output", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", payload: {} });
    run.recordStep(makeStepResult("gather-context", "code", { taskCounts: { ready: 2 } }));
    run.finish({ status: "success", durationMs: 100 });

    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
      join(store.runsDir, run.metadata.id, "metadata.json"),
    );
    const step = metadata?.steps.find((s) => s.id === "gather-context");
    expect(step).toBeDefined();
    expect(JSON.stringify(step?.output, null, 2)).toContain('"taskCounts"');
    expect(JSON.stringify(step?.output, null, 2)).toContain('"ready": 2');
  });

  it("returns error string for a failed step", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", payload: {} });
    run.recordStep({
      id: "build",
      type: "agent",
      status: "failed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 50,
      error: "Something went wrong",
    });
    run.finish({ status: "failed", durationMs: 50, error: "Something went wrong" });

    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
      join(store.runsDir, run.metadata.id, "metadata.json"),
    );
    const step = metadata?.steps.find((s) => s.id === "build");
    expect(step?.error).toBe("Something went wrong");
    expect(step?.output).toBeUndefined();
  });

  it("step with null output prints null as JSON", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", payload: {} });
    run.recordStep({
      id: "noop",
      type: "code",
      status: "success",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 10,
      output: null,
    });
    run.finish({ status: "success", durationMs: 10 });

    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
      join(store.runsDir, run.metadata.id, "metadata.json"),
    );
    const step = metadata?.steps.find((s) => s.id === "noop");
    expect(JSON.stringify(step?.output, null, 2)).toBe("null");
  });
});

// ---------------------------------------------------------------------------
// workflow show: plain-text error.txt reading
// ---------------------------------------------------------------------------

describe("workflow show error.txt reading", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `kota-wf-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads plain-text error.txt when present", () => {
    const errorPath = join(tmpDir, "error.txt");
    writeFileSync(errorPath, "something went wrong", "utf-8");
    const errorText = existsSync(errorPath) ? readFileSync(errorPath, "utf-8") : null;
    expect(errorText).toBe("something went wrong");
  });

  it("returns null when error.txt is absent", () => {
    const errorPath = join(tmpDir, "error.txt");
    const errorText = existsSync(errorPath) ? readFileSync(errorPath, "utf-8") : null;
    expect(errorText).toBeNull();
  });

  it("reads multi-line plain-text error.txt", () => {
    const errorPath = join(tmpDir, "error.txt");
    const msg = "line one\nline two\nline three";
    writeFileSync(errorPath, msg, "utf-8");
    const errorText = existsSync(errorPath) ? readFileSync(errorPath, "utf-8") : null;
    expect(errorText).toBe(msg);
  });
});
