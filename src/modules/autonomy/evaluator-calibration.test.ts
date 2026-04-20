import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  WorkflowStepContext,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import {
  aggregateCalibration,
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
  evaluateCalibrationGate,
  writeCalibrationArtifact,
} from "./evaluator-calibration.js";

type CalibrationSeed = {
  runId: string;
  completedAt: string;
  verdict: EvaluatorCalibrationArtifact["verdict"];
  sourceFilesChanged: string[];
  warningCount?: number;
  criticalIssueCount?: number;
  repairIterations?: number;
  finalIterationFailures?: string[];
  taskId?: string | null;
  taskFinalState?: EvaluatorCalibrationArtifact["taskFinalState"];
};

function seedRun(runsDir: string, seed: CalibrationSeed): void {
  const runDir = join(runsDir, seed.runId);
  mkdirSync(runDir, { recursive: true });
  const artifact: EvaluatorCalibrationArtifact = {
    runId: seed.runId,
    workflow: "builder",
    completedAt: seed.completedAt,
    verdict: seed.verdict,
    warningCount: seed.warningCount ?? 0,
    criticalIssueCount: seed.criticalIssueCount ?? 0,
    repairIterations: seed.repairIterations ?? 1,
    finalIterationFailures: seed.finalIterationFailures ?? [],
    terminalRunStatus: "success",
    taskId: seed.taskId ?? null,
    taskFinalState: seed.taskFinalState ?? null,
    sourceFilesChanged: seed.sourceFilesChanged,
  };
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify(artifact, null, 2),
  );
}

function makeStepContext(
  overrides: {
    runDir: string;
    projectDir: string;
    stepOutputs?: Record<string, unknown>;
    stepResults?: Record<string, WorkflowStepResult>;
  },
): WorkflowStepContext {
  return {
    projectDir: overrides.projectDir,
    workflow: {
      name: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runId: "run-test",
      runDir: "run-test",
      runDirPath: overrides.runDir,
    },
    trigger: { event: "autonomy.queue.available", payload: {} },
    previousOutput: undefined,
    stepOutputs: overrides.stepOutputs ?? {},
    stepResults: overrides.stepResults ?? {},
    stepOutputList: [],
    runTool: async () => {
      throw new Error("runTool not used");
    },
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({
      completedRuns: 0,
      pendingRuns: [],
      workflows: {},
    }),
    triggerWorkflow: async () => ({ runId: "r", status: "queued" }),
  };
}

describe("writeCalibrationArtifact", () => {
  let root: string;
  let runDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cal-write-"));
    runDir = join(root, "runs", "run-test");
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("records verdict, repair-iteration failures, and filters bookkeeping paths", () => {
    writeFileSync(
      join(runDir, "critic-review.json"),
      JSON.stringify({
        verdict: "pass",
        critical_issues: [],
        warnings: [{ category: "style", message: "nit" }],
        summary: "ok",
      }),
    );
    writeFileSync(
      join(runDir, "run-summary.json"),
      JSON.stringify({
        runId: "run-test",
        workflow: "builder",
        taskId: "task-1",
        filesChanged: [
          "src/modules/autonomy/evaluator-calibration.ts",
          "data/tasks/done/task-1.md",
          "src/modules/autonomy/AGENTS.md",
          "src/modules/autonomy/critic.ts",
        ],
        completedAt: "2026-04-20T12:00:00.000Z",
      }),
    );

    const ctx = makeStepContext({
      runDir,
      projectDir: root,
      stepOutputs: {
        build: {
          repairIterations: [
            { attempt: 1, failures: [{ id: "critic-review" }] },
            { attempt: 2, failures: [] },
          ],
        },
      },
      stepResults: {
        build: {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: "2026-04-20T11:59:00.000Z",
          completedAt: "2026-04-20T12:00:00.000Z",
          durationMs: 60000,
        },
      },
    });

    const artifact = writeCalibrationArtifact(ctx);
    expect(artifact.verdict).toBe("pass");
    expect(artifact.warningCount).toBe(1);
    expect(artifact.repairIterations).toBe(2);
    expect(artifact.finalIterationFailures).toEqual([]);
    expect(artifact.taskId).toBe("task-1");
    expect(artifact.sourceFilesChanged).toEqual([
      "src/modules/autonomy/evaluator-calibration.ts",
      "src/modules/autonomy/critic.ts",
    ]);
  });

  it("captures verdict-vs-repair-loop contradiction: pass verdict with a non-empty final iteration", () => {
    writeFileSync(
      join(runDir, "critic-review.json"),
      JSON.stringify({
        verdict: "pass",
        critical_issues: [],
        warnings: [],
        summary: "ok",
      }),
    );
    writeFileSync(
      join(runDir, "run-summary.json"),
      JSON.stringify({
        runId: "run-test",
        workflow: "builder",
        taskId: null,
        filesChanged: ["src/core/foo.ts"],
        completedAt: "2026-04-20T12:00:00.000Z",
      }),
    );

    const ctx = makeStepContext({
      runDir,
      projectDir: root,
      stepOutputs: {
        build: {
          repairIterations: [
            {
              attempt: 1,
              failures: [{ id: "typecheck" }, { id: "lint" }],
            },
          ],
        },
      },
      stepResults: {
        build: {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: "2026-04-20T11:59:00.000Z",
          completedAt: "2026-04-20T12:00:00.000Z",
          durationMs: 60000,
        },
      },
    });

    const artifact = writeCalibrationArtifact(ctx);
    expect(artifact.verdict).toBe("pass");
    expect(artifact.finalIterationFailures).toEqual(["typecheck", "lint"]);
  });

  it("records verdict=absent when critic-review.json is missing", () => {
    writeFileSync(
      join(runDir, "run-summary.json"),
      JSON.stringify({
        runId: "run-test",
        workflow: "builder",
        taskId: null,
        filesChanged: [],
        completedAt: "2026-04-20T12:00:00.000Z",
      }),
    );

    const ctx = makeStepContext({
      runDir,
      projectDir: root,
      stepOutputs: { build: { repairIterations: [] } },
      stepResults: {
        build: {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: "2026-04-20T11:59:00.000Z",
          completedAt: "2026-04-20T12:00:00.000Z",
          durationMs: 60000,
        },
      },
    });

    const artifact = writeCalibrationArtifact(ctx);
    expect(artifact.verdict).toBe("absent");
  });
});

describe("aggregateCalibration", () => {
  let root: string;
  let runsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cal-agg-"));
    runsDir = join(root, "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("flags pass-verdict contradiction when a later run touches overlapping source files", () => {
    seedRun(runsDir, {
      runId: "2026-04-20T10-00-00-000Z-builder-a",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts", "src/core/b.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T12-00-00-000Z-builder-b",
      completedAt: "2026-04-20T12:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:30:00.000Z"),
    });
    expect(agg.totalRuns).toBe(2);
    expect(agg.byVerdict.pass).toBe(2);
    expect(agg.passContradictionCount).toBe(1);
    expect(agg.passContradictionRate).toBeCloseTo(0.5, 5);
  });

  it("correlates pass_with_warnings verdicts with a later follow-up run independently of pass contradiction", () => {
    seedRun(runsDir, {
      runId: "2026-04-20T10-00-00-000Z-builder-a",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass_with_warnings",
      sourceFilesChanged: ["src/modules/x.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T11-00-00-000Z-builder-b",
      completedAt: "2026-04-20T11:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/modules/x.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    expect(agg.byVerdict.pass_with_warnings).toBe(1);
    expect(agg.passWithWarningsFollowUpCount).toBe(1);
    expect(agg.passWithWarningsFollowUpRate).toBe(1);
    expect(agg.passContradictionCount).toBe(0);
  });

  it("does not flag follow-up when file sets do not overlap", () => {
    seedRun(runsDir, {
      runId: "2026-04-20T10-00-00-000Z-builder-a",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/modules/x.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T11-00-00-000Z-builder-b",
      completedAt: "2026-04-20T11:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/modules/y.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    expect(agg.passContradictionCount).toBe(0);
  });

  it("ignores follow-ups outside the follow-up window", () => {
    seedRun(runsDir, {
      runId: "2026-04-15T10-00-00-000Z-builder-a",
      completedAt: "2026-04-15T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-19T10-00-00-000Z-builder-b",
      completedAt: "2026-04-19T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 2 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T00:00:00.000Z"),
    });
    expect(agg.byVerdict.pass).toBe(2);
    expect(agg.passContradictionCount).toBe(0);
  });

  it("excludes runs outside the primary window", () => {
    seedRun(runsDir, {
      runId: "2026-04-01T10-00-00-000Z-builder-a",
      completedAt: "2026-04-01T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-19T10-00-00-000Z-builder-b",
      completedAt: "2026-04-19T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/b.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T00:00:00.000Z"),
    });
    expect(agg.totalRuns).toBe(1);
  });

  it("handles a missing runs directory by returning zeros", () => {
    const agg = aggregateCalibration(join(root, "does-not-exist"), {
      nowMs: Date.parse("2026-04-20T00:00:00.000Z"),
    });
    expect(agg.totalRuns).toBe(0);
    expect(agg.passContradictionCount).toBe(0);
  });
});

describe("evaluateCalibrationGate", () => {
  function baseAggregate(
    overrides: Partial<
      Pick<
        ReturnType<typeof aggregateCalibration>,
        "byVerdict" | "passContradictionCount" | "passContradictionRate"
      >
    > = {},
  ): ReturnType<typeof aggregateCalibration> {
    return {
      windowStartMs: 0,
      windowEndMs: 1,
      totalRuns: 0,
      byVerdict: overrides.byVerdict ?? {
        pass: 0,
        pass_with_warnings: 0,
        fail: 0,
        absent: 0,
      },
      passContradictionCount: overrides.passContradictionCount ?? 0,
      passContradictionRate: overrides.passContradictionRate ?? 0,
      passWithWarningsFollowUpCount: 0,
      passWithWarningsFollowUpRate: 0,
    };
  }

  it("reports insufficient-sample when pass verdicts are below minSample", () => {
    const decision = evaluateCalibrationGate(
      baseAggregate({
        byVerdict: { pass: 3, pass_with_warnings: 0, fail: 0, absent: 0 },
      }),
      { thresholdRate: 0.25, minSample: 8 },
    );
    expect(decision.status).toBe("insufficient-sample");
  });

  it("reports under-threshold when contradiction rate is at or below the threshold", () => {
    const decision = evaluateCalibrationGate(
      baseAggregate({
        byVerdict: { pass: 10, pass_with_warnings: 0, fail: 0, absent: 0 },
        passContradictionCount: 2,
        passContradictionRate: 0.2,
      }),
      { thresholdRate: 0.25, minSample: 8 },
    );
    expect(decision.status).toBe("under-threshold");
  });

  it("fires the gate when contradiction rate strictly exceeds threshold and sample is adequate", () => {
    const decision = evaluateCalibrationGate(
      baseAggregate({
        byVerdict: { pass: 10, pass_with_warnings: 0, fail: 0, absent: 0 },
        passContradictionCount: 4,
        passContradictionRate: 0.4,
      }),
      { thresholdRate: 0.25, minSample: 8 },
    );
    expect(decision.status).toBe("gated");
    expect(decision.reason).toContain("40.0%");
    expect(decision.reason).toContain("25.0%");
  });

  it("uses documented defaults", () => {
    expect(DEFAULT_CALIBRATION_THRESHOLD_RATE).toBe(0.25);
    expect(DEFAULT_CALIBRATION_MIN_SAMPLE).toBe(8);
  });
});
