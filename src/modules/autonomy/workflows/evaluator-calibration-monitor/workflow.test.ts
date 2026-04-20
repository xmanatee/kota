import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import evaluatorCalibrationMonitor from "./workflow.js";

type SeedOverrides = Partial<
  Pick<EvaluatorCalibrationArtifact, "verdict" | "sourceFilesChanged">
>;

function seedCalibration(
  runsDir: string,
  runId: string,
  completedAt: string,
  overrides: SeedOverrides,
): void {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const artifact: EvaluatorCalibrationArtifact = {
    runId,
    workflow: "builder",
    completedAt,
    verdict: overrides.verdict ?? "pass",
    warningCount: 0,
    criticalIssueCount: 0,
    repairIterations: 1,
    finalIterationFailures: [],
    terminalRunStatus: "success",
    taskId: null,
    taskFinalState: null,
    sourceFilesChanged: overrides.sourceFilesChanged ?? [],
  };
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify(artifact, null, 2),
  );
}

describe("evaluator-calibration-monitor workflow", () => {
  let projectDir: string;
  let runsDir: string;
  const originalThreshold =
    process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE;
  const originalMinSample = process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "cal-monitor-"));
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (originalThreshold === undefined) {
      delete process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE;
    } else {
      process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE = originalThreshold;
    }
    if (originalMinSample === undefined) {
      delete process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE;
    } else {
      process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = originalMinSample;
    }
  });

  it("registers with a single trigger on workflow.build.committed", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/evaluator-calibration-monitor/workflow.ts",
      evaluatorCalibrationMonitor,
    );
    expect(registered.name).toBe("evaluator-calibration-monitor");
    expect(registered.triggers).toHaveLength(1);
    expect(registered.triggers[0].event).toBe("workflow.build.committed");
  });

  it("emits evaluator-calibration.regression.detected when the contradiction rate crosses the threshold", async () => {
    process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE = "0.25";
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = "2";

    // Two pass verdicts, the older one contradicted by a later run touching
    // overlapping files. 50% contradiction rate clears the 25% threshold.
    const now = new Date();
    const hour = 60 * 60 * 1000;
    const older = new Date(now.getTime() - 5 * hour).toISOString();
    const newer = new Date(now.getTime() - 1 * hour).toISOString();

    seedCalibration(runsDir, "run-older", older, {
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedCalibration(runsDir, "run-newer", newer, {
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: {
        event: "workflow.build.committed",
        payload: {
          runId: "run-newer",
          taskId: null,
          commitMessage: "",
          costUsd: null,
          durationMs: null,
        },
      },
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(1);
    expect(regression[0].payload.passContradictionCount).toBe(1);
    expect(regression[0].payload.thresholdRate).toBe(0.25);
  });

  it("does not emit when the sample size is below minSample", async () => {
    process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE = "0.25";
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = "10";

    const now = new Date();
    const hour = 60 * 60 * 1000;
    seedCalibration(
      runsDir,
      "run-a",
      new Date(now.getTime() - 2 * hour).toISOString(),
      {
        verdict: "pass",
        sourceFilesChanged: ["src/core/a.ts"],
      },
    );
    seedCalibration(
      runsDir,
      "run-b",
      new Date(now.getTime() - 1 * hour).toISOString(),
      {
        verdict: "pass",
        sourceFilesChanged: ["src/core/a.ts"],
      },
    );

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: {
        event: "workflow.build.committed",
        payload: {
          runId: "run-b",
          taskId: null,
          commitMessage: "",
          costUsd: null,
          durationMs: null,
        },
      },
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(0);
  });

  it("does not emit when the contradiction rate is under threshold", async () => {
    process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE = "0.9";
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = "2";

    const now = new Date();
    const hour = 60 * 60 * 1000;
    seedCalibration(
      runsDir,
      "run-older",
      new Date(now.getTime() - 2 * hour).toISOString(),
      {
        verdict: "pass",
        sourceFilesChanged: ["src/core/a.ts"],
      },
    );
    seedCalibration(
      runsDir,
      "run-newer",
      new Date(now.getTime() - 1 * hour).toISOString(),
      {
        verdict: "pass",
        sourceFilesChanged: ["src/core/a.ts"],
      },
    );

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: {
        event: "workflow.build.committed",
        payload: {
          runId: "run-newer",
          taskId: null,
          commitMessage: "",
          costUsd: null,
          durationMs: null,
        },
      },
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(0);
  });
});
