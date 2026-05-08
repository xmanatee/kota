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
  DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
  evaluateCalibrationGate,
  writeCalibrationArtifact,
} from "./evaluator-calibration.js";

const TEST_PROMPT_HASH = "promptv0test";

type CalibrationSeed = {
  runId: string;
  completedAt: string;
  verdict: EvaluatorCalibrationArtifact["verdict"];
  sourceFilesChanged: string[];
  warningCount?: number;
  criticalIssueCount?: number;
  repairIterations?: number;
  finalIterationFailures?: string[];
  criticFailureCount?: number;
  taskId?: string | null;
  taskFinalState?: EvaluatorCalibrationArtifact["taskFinalState"];
  criticPromptHash?: string;
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
    criticFailureCount: seed.criticFailureCount ?? 0,
    terminalRunStatus: "success",
    taskId: seed.taskId ?? null,
    taskFinalState: seed.taskFinalState ?? null,
    sourceFilesChanged: seed.sourceFilesChanged,
    criticPromptHash: seed.criticPromptHash ?? TEST_PROMPT_HASH,
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
    expect(artifact.criticFailureCount).toBe(1);
    expect(artifact.taskId).toBe("task-1");
    expect(artifact.sourceFilesChanged).toEqual([
      "src/modules/autonomy/evaluator-calibration.ts",
      "src/modules/autonomy/critic.ts",
    ]);
  });

  it("counts critic-review failures across all repair iterations", () => {
    writeFileSync(
      join(runDir, "critic-review.json"),
      JSON.stringify({ verdict: "pass", critical_issues: [], warnings: [], summary: "ok" }),
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
            { attempt: 1, failures: [{ id: "test" }] },
            { attempt: 2, failures: [{ id: "critic-review" }] },
            { attempt: 3, failures: [{ id: "critic-review" }, { id: "lint" }] },
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
    expect(artifact.criticFailureCount).toBe(2);
    expect(artifact.repairIterations).toBe(3);
  });

  it("records the diagnostic finalIterationFailures even when the critic was never the failing check", () => {
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
    // typecheck/lint repair is iteration noise — not a critic catch.
    expect(artifact.criticFailureCount).toBe(0);
  });

  it("embeds the active critic prompt hash so aggregation can filter prior versions", () => {
    writeFileSync(
      join(runDir, "critic-review.json"),
      JSON.stringify({ verdict: "pass", critical_issues: [], warnings: [], summary: "ok" }),
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

    const artifact = writeCalibrationArtifact(ctx, {
      criticPromptHash: "promptvfixed",
    });
    expect(artifact.criticPromptHash).toBe("promptvfixed");
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

  it("flags pass-verdict contradiction when a later overlapping run itself failed", () => {
    seedRun(runsDir, {
      runId: "2026-04-20T10-00-00-000Z-builder-a",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts", "src/core/b.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T12-00-00-000Z-builder-b",
      completedAt: "2026-04-20T12:00:00.000Z",
      verdict: "fail",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:30:00.000Z"),
    });
    expect(agg.totalRuns).toBe(2);
    expect(agg.byVerdict.pass).toBe(1);
    expect(agg.byVerdict.fail).toBe(1);
    expect(agg.passContradictionCount).toBe(1);
    expect(agg.passContradictionRate).toBeCloseTo(1, 5);
  });

  it("does not flag contradiction for healthy iteration chains where every overlapping run also passes", () => {
    // Core-shrink style chain: three builder runs in a row touch the same
    // files and all pass. Overlap alone would have counted two
    // contradictions; the tightened definition counts zero because no later
    // overlapping run carries a failure signal.
    seedRun(runsDir, {
      runId: "2026-04-20T09-00-00-000Z-builder-a",
      completedAt: "2026-04-20T09:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts", "src/core/b.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T10-00-00-000Z-builder-b",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T11-00-00-000Z-builder-c",
      completedAt: "2026-04-20T11:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/b.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    expect(agg.byVerdict.pass).toBe(3);
    expect(agg.passContradictionCount).toBe(0);
    expect(agg.passContradictionRate).toBe(0);
  });

  it("flags contradiction when the later overlapping run's critic itself failed", () => {
    // The later overlapping run has a pass verdict but its build's critic
    // ran more than once because it flagged something the agent had to
    // repair. That critic catch is the evaluator-quality failure signal.
    seedRun(runsDir, {
      runId: "2026-04-20T10-00-00-000Z-builder-a",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T11-00-00-000Z-builder-b",
      completedAt: "2026-04-20T11:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
      criticFailureCount: 1,
    });

    const agg = aggregateCalibration(runsDir, {
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    expect(agg.byVerdict.pass).toBe(2);
    expect(agg.passContradictionCount).toBe(1);
  });

  it("does not flag contradiction when the later overlapping run only needed mechanical-check repair", () => {
    // typecheck/test/lint repair is healthy iteration, not evaluator drift.
    seedRun(runsDir, {
      runId: "2026-04-20T10-00-00-000Z-builder-a",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T11-00-00-000Z-builder-b",
      completedAt: "2026-04-20T11:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
      finalIterationFailures: ["test", "lint"],
      criticFailureCount: 0,
    });

    const agg = aggregateCalibration(runsDir, {
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    expect(agg.byVerdict.pass).toBe(2);
    expect(agg.passContradictionCount).toBe(0);
  });

  it("excludes pre-versioned artifacts that lack a criticPromptHash", () => {
    // Pre-prompt-version artifacts on disk do not declare the hash. They
    // were generated under an unknown critic prompt and cannot be safely
    // aggregated against the running prompt's calibration. Filtering them
    // out is the correct behavior — the alternative (treating them as
    // matching) would let stale data dominate the rolling window after a
    // prompt fix and re-fire the gate for the rest of the window.
    seedRun(runsDir, {
      runId: "2026-04-20T11-00-00-000Z-builder-current",
      completedAt: "2026-04-20T11:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    const legacyRun = "2026-04-20T10-00-00-000Z-builder-legacy";
    const legacyDir = join(runsDir, legacyRun);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, EVALUATOR_CALIBRATION_ARTIFACT),
      JSON.stringify({
        runId: legacyRun,
        workflow: "builder",
        completedAt: "2026-04-20T10:00:00.000Z",
        verdict: "pass",
        warningCount: 0,
        criticalIssueCount: 0,
        repairIterations: 1,
        finalIterationFailures: [],
        criticFailureCount: 0,
        terminalRunStatus: "success",
        taskId: null,
        taskFinalState: null,
        sourceFilesChanged: ["src/core/a.ts"],
      }),
    );

    const agg = aggregateCalibration(runsDir, {
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    // Only the seeded matching-hash artifact counts.
    expect(agg.totalRuns).toBe(1);
    expect(agg.byVerdict.pass).toBe(1);
  });

  it("excludes artifacts whose criticPromptHash does not match the running prompt", () => {
    // A prior critic prompt (older hash) and the running critic prompt
    // (current hash) coexist in the runs directory. Aggregation must only
    // see runs from the running prompt — that is the contract that lets a
    // prompt fix take effect immediately without dragging stale data into
    // the rolling window.
    seedRun(runsDir, {
      runId: "2026-04-20T09-00-00-000Z-builder-old-prompt",
      completedAt: "2026-04-20T09:00:00.000Z",
      verdict: "pass_with_warnings",
      sourceFilesChanged: ["src/core/a.ts"],
      criticPromptHash: "olderpromptv0",
    });
    seedRun(runsDir, {
      runId: "2026-04-20T10-00-00-000Z-builder-current-a",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T11-00-00-000Z-builder-current-b",
      completedAt: "2026-04-20T11:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    expect(agg.totalRuns).toBe(2);
    expect(agg.byVerdict.pass).toBe(2);
    expect(agg.byVerdict.pass_with_warnings).toBe(0);
  });

  it("flags pass_with_warnings escalation when the later overlapping run is itself hedging", () => {
    seedRun(runsDir, {
      runId: "2026-04-20T10-00-00-000Z-builder-a",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass_with_warnings",
      sourceFilesChanged: ["src/modules/x.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-20T11-00-00-000Z-builder-b",
      completedAt: "2026-04-20T11:00:00.000Z",
      verdict: "pass_with_warnings",
      sourceFilesChanged: ["src/modules/x.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    expect(agg.byVerdict.pass_with_warnings).toBe(2);
    expect(agg.passWithWarningsFollowUpCount).toBe(1);
    expect(agg.passWithWarningsFollowUpRate).toBe(0.5);
    expect(agg.passContradictionCount).toBe(0);
  });

  it("does not flag pass_with_warnings escalation when the later overlapping run closed cleanly", () => {
    // The critic hedged once, the next run touching the same files passed
    // cleanly with no critic catch — the warning closed out, healthy shape.
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
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    expect(agg.byVerdict.pass_with_warnings).toBe(1);
    expect(agg.passWithWarningsFollowUpCount).toBe(0);
    expect(agg.passWithWarningsFollowUpRate).toBe(0);
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
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:00:00.000Z"),
    });
    expect(agg.passContradictionCount).toBe(0);
  });

  it("ignores follow-ups outside the follow-up window", () => {
    // The later run carries a failure signal, so only the follow-up-window
    // bound prevents it from counting as contradiction.
    seedRun(runsDir, {
      runId: "2026-04-15T10-00-00-000Z-builder-a",
      completedAt: "2026-04-15T10:00:00.000Z",
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedRun(runsDir, {
      runId: "2026-04-19T10-00-00-000Z-builder-b",
      completedAt: "2026-04-19T10:00:00.000Z",
      verdict: "fail",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const agg = aggregateCalibration(runsDir, {
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 2 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T00:00:00.000Z"),
    });
    expect(agg.byVerdict.pass).toBe(1);
    expect(agg.byVerdict.fail).toBe(1);
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
      criticPromptHash: TEST_PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T00:00:00.000Z"),
    });
    expect(agg.totalRuns).toBe(1);
  });

  it("handles a missing runs directory by returning zeros", () => {
    const agg = aggregateCalibration(join(root, "does-not-exist"), {
      criticPromptHash: TEST_PROMPT_HASH,
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
        | "byVerdict"
        | "passContradictionCount"
        | "passContradictionRate"
        | "passWithWarningsFollowUpCount"
        | "passWithWarningsFollowUpRate"
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
      passWithWarningsFollowUpCount: overrides.passWithWarningsFollowUpCount ?? 0,
      passWithWarningsFollowUpRate: overrides.passWithWarningsFollowUpRate ?? 0,
    };
  }

  const baseConfig = {
    thresholdRate: 0.25,
    minSample: 8,
    passWithWarningsThresholdRate: 0.4,
    passWithWarningsMinSample: 5,
  };

  it("reports insufficient-sample when both samples are below their minimums", () => {
    const decision = evaluateCalibrationGate(
      baseAggregate({
        byVerdict: { pass: 3, pass_with_warnings: 1, fail: 0, absent: 0 },
      }),
      baseConfig,
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
      baseConfig,
    );
    expect(decision.status).toBe("under-threshold");
  });

  it("fires the gate with kind pass-contradiction when contradiction rate exceeds threshold and sample is adequate", () => {
    const decision = evaluateCalibrationGate(
      baseAggregate({
        byVerdict: { pass: 10, pass_with_warnings: 0, fail: 0, absent: 0 },
        passContradictionCount: 4,
        passContradictionRate: 0.4,
      }),
      baseConfig,
    );
    expect(decision.status).toBe("gated");
    if (decision.status !== "gated") return;
    expect(decision.kinds).toEqual(["pass-contradiction"]);
    expect(decision.reason).toContain("40.0%");
    expect(decision.reason).toContain("25.0%");
  });

  it("fires the gate with kind pass-with-warnings-escalation when warnings follow-up rate exceeds its threshold", () => {
    const decision = evaluateCalibrationGate(
      baseAggregate({
        byVerdict: { pass: 0, pass_with_warnings: 10, fail: 0, absent: 0 },
        passWithWarningsFollowUpCount: 6,
        passWithWarningsFollowUpRate: 0.6,
      }),
      baseConfig,
    );
    expect(decision.status).toBe("gated");
    if (decision.status !== "gated") return;
    expect(decision.kinds).toEqual(["pass-with-warnings-escalation"]);
    expect(decision.reason).toContain("60.0%");
    expect(decision.reason).toContain("40.0%");
  });

  it("can fire on both kinds at once", () => {
    const decision = evaluateCalibrationGate(
      baseAggregate({
        byVerdict: { pass: 10, pass_with_warnings: 10, fail: 0, absent: 0 },
        passContradictionCount: 4,
        passContradictionRate: 0.4,
        passWithWarningsFollowUpCount: 6,
        passWithWarningsFollowUpRate: 0.6,
      }),
      baseConfig,
    );
    expect(decision.status).toBe("gated");
    if (decision.status !== "gated") return;
    expect(decision.kinds).toEqual([
      "pass-contradiction",
      "pass-with-warnings-escalation",
    ]);
  });

  it("only fires the kinds whose sample is adequate", () => {
    const decision = evaluateCalibrationGate(
      baseAggregate({
        // adequate pass sample with drift, but warnings sample below minimum
        byVerdict: { pass: 10, pass_with_warnings: 2, fail: 0, absent: 0 },
        passContradictionCount: 4,
        passContradictionRate: 0.4,
        passWithWarningsFollowUpCount: 2,
        passWithWarningsFollowUpRate: 1,
      }),
      baseConfig,
    );
    expect(decision.status).toBe("gated");
    if (decision.status !== "gated") return;
    expect(decision.kinds).toEqual(["pass-contradiction"]);
  });

  it("uses documented defaults", () => {
    expect(DEFAULT_CALIBRATION_THRESHOLD_RATE).toBe(0.25);
    expect(DEFAULT_CALIBRATION_MIN_SAMPLE).toBe(8);
    // The 0.75 PWW threshold is a deliberate retune from 0.4 — autonomous
    // loops concentrate work on shared files (autonomy module, scoped
    // AGENTS.md, critic.ts), producing a high natural overlap rate
    // independent of evaluator drift. Lowering it reintroduces the
    // false-positive churn that gated the loop in early May 2026.
    expect(DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE).toBe(0.75);
    expect(DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE).toBe(5);
  });
});
