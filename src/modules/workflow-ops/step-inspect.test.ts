import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunMetadata } from "../../core/workflow/run-types.js";
import { readOptionalJsonFile } from "../../json-file.js";

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
// Unit tests for printSummary (via stdout capture)
// ---------------------------------------------------------------------------

describe("printSummary via step-inspect module", () => {
  let output: string[] = [];
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    output = [];
    consoleSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("prints agent step summary", async () => {
    const { printSummary } = await import("./step-inspect.js");
    const step = makeStep();
    printSummary(step);
    expect(output.join("\n")).toContain("build");
    expect(output.join("\n")).toContain("agent");
    expect(output.join("\n")).toContain("$0.1230");
    expect(output.join("\n")).toContain("Turns: 5");
    expect(output.join("\n")).toContain("Did the work.");
  });

  it("prints code step summary", async () => {
    const { printSummary } = await import("./step-inspect.js");
    const step = makeStep({ id: "prep", type: "code", output: { note: "ready" } });
    printSummary(step);
    expect(output.join("\n")).toContain("prep");
    expect(output.join("\n")).toContain("code");
    expect(output.join("\n")).toContain("note");
  });

  it("shows error when step failed", async () => {
    const { printSummary } = await import("./step-inspect.js");
    const step = makeStep({ status: "failed", error: "typecheck failed", output: null });
    printSummary(step);
    expect(output.join("\n")).toContain("typecheck failed");
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
