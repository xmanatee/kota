import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentUsage } from "#core/agent-harness/usage.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { stack } from "#modules/rendering/primitives.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildStepSummaryLines, readWorkflowRunStep } from "./step-inspect.js";

type StepRecord = WorkflowRunMetadata["steps"][number];

type StepOverrides = {
  id?: string;
  type?: "agent" | "code";
  status?: "success" | "failed";
  output?: unknown;
  error?: string;
  harness?: string;
  model?: string;
  usage?: AgentUsage;
};

function makeStep(overrides: StepOverrides = {}): StepRecord {
  const output = overrides.output === undefined
    ? { content: "Did the work.", turns: 5 }
    : overrides.output;
  const common = {
    id: overrides.id ?? "build",
    status: overrides.status ?? "success",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    durationMs: 60000,
    output,
    error: overrides.error,
  };
  if (overrides.type === "code") {
    return {
      ...common,
      type: "code",
    };
  }
  return {
    ...common,
    type: "agent",
    usage: overrides.usage ?? {
      tokens: { state: "unknown" },
      cost: { state: "complete", usd: 0.123 },
    },
    harness: overrides.harness,
    model: overrides.model,
  };
}

function writeRunFixture(
  runsDir: string,
  runId: string,
  steps: StepRecord[],
): string {
  const runDir = join(runsDir, runId);
  const stepsDir = join(runDir, "steps");
  mkdirSync(stepsDir, { recursive: true });

  const metadata: WorkflowRunMetadata = {
    id: runId,
    workflow: "builder",
    definitionPath: "",
    trigger: { event: "manual", schemaRef: null, payload: {} },
    startedAt: "2026-01-01T00:00:00Z",
    status: "success",
    runDir: runDir,
    steps,
  };
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));

  for (const step of steps) {
    writeFileSync(join(stepsDir, `${step.id}.json`), JSON.stringify(step));
  }
  return runDir;
}

// ---------------------------------------------------------------------------
// Unit tests for buildStepSummaryLines
// ---------------------------------------------------------------------------

describe("buildStepSummaryLines", () => {
  function renderSummary(step: StepRecord): string {
    return renderToString(stack(...buildStepSummaryLines(step)));
  }

  it("renders agent step summary", () => {
    const step = makeStep();
    const output = renderSummary(step);
    expect(output).toContain("build");
    expect(output).toContain("agent");
    expect(output).toContain("$0.1230");
    expect(output).toContain("Turns: 5");
    expect(output).toContain("Did the work.");
  });

  it("surfaces the resolved harness and model on agent steps", () => {
    const step = makeStep({
      harness: "claude-agent-sdk",
      model: "claude-opus-4-7",
    });
    const output = renderSummary(step);
    expect(output).toContain("Harness: claude-agent-sdk");
    expect(output).toContain("Model:   claude-opus-4-7");
  });

  it("renders code step summary", () => {
    const step = makeStep({ id: "prep", type: "code", output: { note: "ready" } });
    const output = renderSummary(step);
    expect(output).toContain("prep");
    expect(output).toContain("code");
    expect(output).toContain("note");
  });

  it("shows error when step failed", () => {
    const step = makeStep({ status: "failed", error: "typecheck failed", output: null });
    const output = renderSummary(step);
    expect(output).toContain("typecheck failed");
  });
});

// ---------------------------------------------------------------------------
// Integration tests: resolve steps through canonical run metadata
// ---------------------------------------------------------------------------

describe("step-inspect command integration", () => {
  let tmpDir: string;
  let runsDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kota-step-inspect-"));
    runsDir = join(tmpDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    store = new WorkflowRunStore(tmpDir);
  });

  it("reads the step admitted by canonical run metadata", () => {
    const runId = "2026-01-01T00-00-00-000Z-builder-abc123";
    const step = makeStep({ id: "build" });
    writeRunFixture(runsDir, runId, [step]);

    const result = readWorkflowRunStep(store, runId, "build");
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("Expected the step to be found");
    expect(result.step.id).toBe("build");
    expect(result.step.status).toBe("success");
    const output = result.step.output as { turns: number };
    expect(output.turns).toBe(5);
  });

  it("reports a missing step from canonical run metadata", () => {
    const runId = "2026-01-01T00-00-00-000Z-builder-abc123";
    writeRunFixture(runsDir, runId, [makeStep({ id: "build" })]);

    expect(readWorkflowRunStep(store, runId, "nonexistent")).toEqual({
      kind: "step-not-found",
    });
  });

  it("does not treat an artifact-only directory as a run", () => {
    const runId = "2026-01-01T00-00-00-000Z-builder-artifact";
    const stepsDir = join(runsDir, runId, "steps");
    mkdirSync(stepsDir, { recursive: true });
    writeFileSync(join(stepsDir, "build.json"), JSON.stringify(makeStep()));

    expect(readWorkflowRunStep(store, runId, "build")).toEqual({
      kind: "run-not-found",
    });
  });

  it("fails closed when authority-critical run metadata is malformed", () => {
    const runId = "2026-01-01T00-00-00-000Z-builder-malformed";
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({ id: runId, status: "success" }),
    );
    const authorityStore = new WorkflowRunStore(tmpDir, {
      authorityCriticalRunIds: () => new Set([runId]),
    });

    expect(() => readWorkflowRunStep(authorityStore, runId, "build")).toThrow(
      /Workflow run metadata authority is invalid/,
    );
  });
});
