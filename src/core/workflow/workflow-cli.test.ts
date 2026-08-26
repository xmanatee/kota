import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AgentUsage,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/usage.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { getEligibleAtMs } from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import type {
  WorkflowRunMetadata,
  WorkflowRuntimeSummary,
  WorkflowStepResult,
} from "./run-types.js";
import type { WorkflowDefinition } from "./types.js";

describe("getEligibleAtMs (cooldown check)", () => {
    it("returns now when no last run exists", () => {
      const state: WorkflowRuntimeSummary = { completedRuns: 0, workflows: {} };
      const before = Date.now();
      const eligibleAt = getEligibleAtMs("builder", 60_000, state);
      expect(eligibleAt).toBeGreaterThanOrEqual(before);
      expect(eligibleAt).toBeLessThanOrEqual(Date.now());
    });

    it("returns now when cooldownMs is zero", () => {
      const lastCompleted = new Date(Date.now() - 5_000).toISOString();
      const state: WorkflowRuntimeSummary = {
        completedRuns: 1,
        workflows: {
          builder: {
            lastCompletion: {
              runId: "run-builder-prev",
              startedAt: lastCompleted,
              completedAt: lastCompleted,
              status: "success",
            },
          },
        },
      };
      const eligibleAt = getEligibleAtMs("builder", 0, state);
      expect(eligibleAt).toBeLessThanOrEqual(Date.now());
    });

    it("returns a future time when cooldown has not elapsed", () => {
      const lastCompleted = new Date(Date.now() - 30_000).toISOString(); // 30s ago
      const cooldownMs = 120_000; // 2 min cooldown
      const state: WorkflowRuntimeSummary = {
        completedRuns: 1,
        workflows: {
          builder: {
            lastCompletion: {
              runId: "run-builder-prev",
              startedAt: lastCompleted,
              completedAt: lastCompleted,
              status: "success",
            },
          },
        },
      };
      const eligibleAt = getEligibleAtMs("builder", cooldownMs, state);
      expect(eligibleAt).toBeGreaterThan(Date.now());
    });

    it("returns a past time when cooldown has elapsed", () => {
      const lastCompleted = new Date(Date.now() - 200_000).toISOString(); // 200s ago
      const cooldownMs = 60_000; // 1 min cooldown
      const state: WorkflowRuntimeSummary = {
        completedRuns: 1,
        workflows: {
          builder: {
            lastCompletion: {
              runId: "run-builder-prev",
              startedAt: lastCompleted,
              completedAt: lastCompleted,
              status: "success",
            },
          },
        },
      };
      const eligibleAt = getEligibleAtMs("builder", cooldownMs, state);
      expect(eligibleAt).toBeLessThan(Date.now());
    });
});

// ---------------------------------------------------------------------------
// Causal chain: triggeredByRunId
// ---------------------------------------------------------------------------

describe("WorkflowRunStore causal chain", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-wf-causal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    store = new WorkflowRunStore(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  const workflow: WorkflowDefinition = {
    name: "builder",
    enabled: true,
    repository: "none",
    tags: [],
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [{ event: "workflow.completed", cooldownMs: 0 }],
    steps: [],
  };

  it("sets triggeredByRunId when trigger payload contains runId", () => {
    const parentRunId = "2026-01-01T00-00-00-000Z-explorer-abc123";
    const run = store.createRun(workflow, {
      event: "workflow.completed",
      schemaRef: null, payload: { runId: parentRunId, workflow: "explorer", status: "success" },
    });
    expect(run.metadata.triggeredByRunId).toBe(parentRunId);
  });

  it("omits triggeredByRunId when trigger payload has no runId", () => {
    const run = store.createRun(workflow, {
      event: "runtime.idle",
      schemaRef: null, payload: {},
    });
    expect(run.metadata.triggeredByRunId).toBeUndefined();
  });

  it("omits triggeredByRunId when payload runId is not a string", () => {
    const run = store.createRun(workflow, {
      event: "workflow.completed",
      schemaRef: null, payload: { runId: 42 },
    });
    expect(run.metadata.triggeredByRunId).toBeUndefined();
  });

  it("sets causedBy when trigger is workflow.completed with runId and workflow", () => {
    const parentRunId = "2026-01-01T00-00-00-000Z-explorer-abc123";
    const run = store.createRun(workflow, {
      event: "workflow.completed",
      schemaRef: null, payload: { runId: parentRunId, workflow: "explorer", status: "success" },
    });
    expect(run.metadata.causedBy).toEqual({ runId: parentRunId, workflow: "explorer" });
  });

  it("omits causedBy when trigger is not workflow.completed", () => {
    const run = store.createRun(workflow, {
      event: "runtime.idle",
      schemaRef: null, payload: {},
    });
    expect(run.metadata.causedBy).toBeUndefined();
  });

  it("omits causedBy when workflow.completed payload lacks workflow name", () => {
    const parentRunId = "2026-01-01T00-00-00-000Z-explorer-abc123";
    const run = store.createRun(workflow, {
      event: "workflow.completed",
      schemaRef: null, payload: { runId: parentRunId },
    });
    expect(run.metadata.causedBy).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cost aggregation via WorkflowRunStore.finish()
// ---------------------------------------------------------------------------

const minimalWorkflow: WorkflowDefinition = {
  name: "builder",
  enabled: true,
  repository: "none",
  tags: [],
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  moduleRoot: "/test-module-root",
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [],
};

function completeUsage(costUsd: number): AgentUsage {
  return {
    tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
    cost: { state: "complete", usd: costUsd },
  };
}

function makeAgentStepResult(
  id: string,
  output?: unknown,
  usage: AgentUsage = UNKNOWN_AGENT_USAGE,
): WorkflowStepResult {
  return {
    id,
    type: "agent",
    status: "success",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 100,
    output,
    usage,
  };
}

function makeNonAgentStepResult(
  id: string,
  type: Exclude<WorkflowStepResult["type"], "agent">,
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
  let workspaceRoot: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-wf-cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    store = new WorkflowRunStore(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("omits usage when no agent steps exist", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", schemaRef: null, payload: {} });
    const completed = run.finish({ status: "success", durationMs: 100 });
    expect(completed.usage).toBeUndefined();
  });

  it("sums measured usage across agent step results", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", schemaRef: null, payload: {} });
    run.recordStep(makeAgentStepResult("step1", { content: "ok" }, completeUsage(0.01)));
    run.recordStep(makeAgentStepResult("step2", { content: "ok" }, completeUsage(0.02)));
    const completed = run.finish({ status: "success", durationMs: 200 });
    expect(completed.usage).toEqual({
      tokens: { state: "complete", inputTokens: 200, outputTokens: 40 },
      cost: { state: "complete", usd: 0.03 },
    });
  });

  it("ignores usage from non-agent steps", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", schemaRef: null, payload: {} });
    run.recordStep(makeAgentStepResult("s1", { content: "ok" }, completeUsage(0.05)));
    run.recordStep(makeNonAgentStepResult("s2", "code", { result: "done" }));
    run.recordStep(makeNonAgentStepResult("s3", "tool", { content: "ok" }));
    const completed = run.finish({ status: "success", durationMs: 300 });
    expect(completed.usage).toEqual(completeUsage(0.05));
  });

  it("keeps aggregate usage partial when an agent step reports unknown usage", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", schemaRef: null, payload: {} });
    run.recordStep(makeAgentStepResult("s1", { content: "ok" }));
    run.recordStep(makeAgentStepResult("s2", { content: "ok" }, completeUsage(0.03)));
    const completed = run.finish({ status: "success", durationMs: 200 });
    expect(completed.usage).toEqual({
      tokens: { state: "partial", inputTokens: 100, outputTokens: 20 },
      cost: { state: "unknown" },
    });
  });

  it("preserves unavailable cost instead of representing it as zero", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", schemaRef: null, payload: {} });
    run.recordStep(makeAgentStepResult("s1", { content: "ok" }, {
      tokens: { state: "complete", inputTokens: 40, outputTokens: 8 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    }));
    run.recordStep(makeAgentStepResult("s2", { content: "ok" }, completeUsage(0.05)));
    const completed = run.finish({ status: "success", durationMs: 100 });

    expect(completed.usage).toEqual({
      tokens: { state: "complete", inputTokens: 140, outputTokens: 28 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });
  });
});

// ---------------------------------------------------------------------------
// workflow show: per-step cost display
// ---------------------------------------------------------------------------

describe("workflow show step cost display", () => {
  function formatStepCost(step: WorkflowStepResult): string {
    if (step.usage === undefined) return "";
    return step.usage.cost.state === "complete"
      ? ` $${step.usage.cost.usd.toFixed(3)}`
      : ` ${step.usage.cost.state}`;
  }

  it("appends measured cost from typed usage", () => {
    const step: WorkflowStepResult = {
      id: "build",
      type: "agent",
      status: "success",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5000,
      output: { content: "done" },
      usage: completeUsage(1.791),
    };
    expect(formatStepCost(step)).toBe(" $1.791");
  });

  it("omits cost for non-agent steps", () => {
    const step: WorkflowStepResult = {
      id: "code-step",
      type: "code",
      status: "success",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 100,
      output: { result: 99 },
    };
    expect(formatStepCost(step)).toBe("");
  });

  it("shows unknown cost explicitly", () => {
    const step: WorkflowStepResult = {
      id: "build",
      type: "agent",
      status: "success",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5000,
      output: { content: "done" },
      usage: { tokens: { state: "unknown" }, cost: { state: "unknown" } },
    };
    expect(formatStepCost(step)).toBe(" unknown");
  });

  it("shows unavailable cost explicitly and never as zero", () => {
    const step: WorkflowStepResult = {
      id: "build",
      type: "agent",
      status: "success",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5000,
      output: null,
      usage: {
        tokens: { state: "complete", inputTokens: 10, outputTokens: 2 },
        cost: { state: "unavailable", reason: "provider-does-not-report" },
      },
    };
    expect(formatStepCost(step)).toBe(" unavailable");
    expect(formatStepCost(step)).not.toContain("$0");
  });
});

// ---------------------------------------------------------------------------
// workflow show --step: step output inspection
// ---------------------------------------------------------------------------

describe("workflow show --step flag", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-wf-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    store = new WorkflowRunStore(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("returns full JSON output for a step with output", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", schemaRef: null, payload: {} });
    run.recordStep(makeNonAgentStepResult("inspect-queue", "code", { taskCounts: { ready: 2 } }));
    run.finish({ status: "success", durationMs: 100 });

    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
      join(store.runsDir, run.metadata.id, "metadata.json"),
    );
    const step = metadata?.steps.find((s) => s.id === "inspect-queue");
    expect(step).toBeDefined();
    expect(JSON.stringify(step?.output, null, 2)).toContain('"taskCounts"');
    expect(JSON.stringify(step?.output, null, 2)).toContain('"ready": 2');
  });

  it("returns error string for a failed step", () => {
    const run = store.createRun(minimalWorkflow, { event: "test", schemaRef: null, payload: {} });
    run.recordStep({
      id: "build",
      type: "agent",
      status: "failed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 50,
      error: "Something went wrong",
      usage: UNKNOWN_AGENT_USAGE,
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
    const run = store.createRun(minimalWorkflow, { event: "test", schemaRef: null, payload: {} });
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
