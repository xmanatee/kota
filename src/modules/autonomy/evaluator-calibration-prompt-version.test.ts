import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateCalibration,
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
  evaluateCalibrationGate,
} from "./evaluator-calibration.js";

function seedRun(
  runsDir: string,
  runId: string,
  completedAt: string,
  verdict: EvaluatorCalibrationArtifact["verdict"],
  sourceFilesChanged: string[],
  criticPromptHash: string,
): void {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const artifact: EvaluatorCalibrationArtifact = {
    runId,
    workflow: "builder",
    completedAt,
    verdict,
    warningCount: 0,
    criticalIssueCount: verdict === "fail" ? 1 : 0,
    repairIterations: 1,
    finalIterationFailures: [],
    criticFailureCount: 0,
    terminalRunStatus: "success",
    taskId: null,
    taskFinalState: null,
    sourceRevision: "1111111111111111111111111111111111111111",
    sourceFilesChanged,
    criticPromptHash,
  };
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify(artifact),
  );
}

describe("evaluator calibration prompt versions", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resets stale samples after the critic prompt is tightened", () => {
    const root = mkdtempSync(join(tmpdir(), "cal-prompt-version-"));
    roots.push(root);
    const runsDir = join(root, "runs");
    const baseTime = Date.parse("2026-08-06T16:00:00.000Z");
    const priorPromptHash = "priorprompt0";
    for (let index = 0; index < 8; index++) {
      seedRun(
        runsDir,
        `2026-08-0${6 + Math.floor(index / 2)}T${16 + index}-00-00-000Z-builder-pass-${index}`,
        new Date(baseTime + index * 60 * 60 * 1000).toISOString(),
        "pass",
        index < 3
          ? ["src/modules/autonomy/critic.ts"]
          : [`src/core/pass-${index}.ts`],
        priorPromptHash,
      );
    }
    seedRun(
      runsDir,
      "2026-08-07T01-00-00-000Z-builder-stale-fail",
      new Date(baseTime + 9 * 60 * 60 * 1000).toISOString(),
      "fail",
      ["src/modules/autonomy/critic.ts"],
      priorPromptHash,
    );
    for (let index = 0; index < 4; index++) {
      seedRun(
        runsDir,
        `2026-08-07T0${2 + index}-00-00-000Z-builder-absent-${index}`,
        new Date(baseTime + (10 + index) * 60 * 60 * 1000).toISOString(),
        "absent",
        [],
        priorPromptHash,
      );
    }

    const aggregate = aggregateCalibration(runsDir, {
      criticPromptHash: "promptv0test",
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: baseTime + 14 * 60 * 60 * 1000,
    });
    expect(aggregate).toMatchObject({
      totalRuns: 0,
      byVerdict: { pass: 0, pass_with_warnings: 0, fail: 0, absent: 0 },
      passContradictionCount: 0,
      passContradictionRate: 0,
    });
    expect(
      evaluateCalibrationGate(aggregate, {
        thresholdRate: 0.25,
        minSample: 8,
        passWithWarningsThresholdRate: 0.75,
        passWithWarningsMinSample: 5,
      }),
    ).toMatchObject({ status: "insufficient-sample" });
  });
});
