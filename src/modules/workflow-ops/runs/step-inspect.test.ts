import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { stack } from "#modules/rendering/primitives.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildStepSummaryLines } from "./step-inspect.js";

type StepRecord = WorkflowRunMetadata["steps"][number];

function makeStep(overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    id: "build",
    type: "agent",
    status: "success",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    durationMs: 60000,
    output: {
      content: "Did the work.",
      totalCostUsd: 0.123,
      turns: 5,
    },
    ...overrides,
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
    trigger: { event: "manual", payload: {} },
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
// Integration tests: read step file from a real temp directory
// ---------------------------------------------------------------------------

describe("step-inspect command integration", () => {
  let tmpDir: string;
  let runsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kota-step-inspect-"));
    runsDir = join(tmpDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  it("reads step JSON from the steps directory", () => {
    const runId = "2026-01-01T00-00-00-000Z-builder-abc123";
    const step = makeStep({ id: "build" });
    writeRunFixture(runsDir, runId, [step]);

    const stepPath = join(runsDir, runId, "steps", "build.json");
    expect(existsSync(stepPath)).toBe(true);
    const loaded = readOptionalJsonFile<StepRecord>(stepPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("build");
    expect(loaded!.status).toBe("success");
    const output = loaded!.output as { turns: number };
    expect(output.turns).toBe(5);
  });

  it("returns null for a missing step file", () => {
    const runId = "2026-01-01T00-00-00-000Z-builder-abc123";
    writeRunFixture(runsDir, runId, [makeStep({ id: "build" })]);

    const loaded = readOptionalJsonFile<StepRecord>(
      join(runsDir, runId, "steps", "nonexistent.json"),
    );
    expect(loaded).toBeNull();
  });
});
