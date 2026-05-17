/**
 * Weekly cadence workflow that runs the eval harness set, compares the fresh
 * aggregate against the persisted baseline, emits a typed regression event
 * when the gate fires, and rolls the baseline forward on accepted outcomes.
 *
 * The cadence is the one surface where baseline persistence applies. The
 * CLI and HTTP entry points are unchanged — a caller that passes its own
 * baseline there still owns the comparison.
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  assessAgainstBaseline,
  type BaselineAssessment,
} from "./baseline-assessment.js";
import { loadBaseline, saveBaseline } from "./baseline-store.js";
import { runEvalSet } from "./eval-set.js";
import { evalHarnessSetCompleted } from "./events.js";
import { loadAllFixtures } from "./fixture.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
} from "./subprocess-executor.js";

type CadenceResult = {
  fixtureCount: number;
  repeatCount: number;
  passAtK: number;
  passHatK: number;
  runArtifactBaseDir: string;
  assessmentStatus: BaselineAssessment["status"];
};

const CADENCE_HOST_CLASS = "autonomy-cadence";
const CADENCE_REPEAT_COUNT = 3;

const runHarness = typedCodeStep<CadenceResult>({
  id: "run-harness",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<CadenceResult>(raw, [
      "fixtureCount",
      "repeatCount",
      "passAtK",
      "passHatK",
      "runArtifactBaseDir",
      "assessmentStatus",
    ]),
  run: async ({ projectDir, workflow, emit }) => {
    const fixturesRoot = join(projectDir, "src/modules/eval-harness/fixtures");
    const fixtures = loadAllFixtures(fixturesRoot);
    if (fixtures.length === 0) {
      throw new Error(
        `eval-harness cadence has no fixtures under "${fixturesRoot}". ` +
          "Add at least one fixture before enabling the cadence workflow.",
      );
    }
    const executor = createSubprocessExecutor({
      kotaBinaryPath: resolve(join(projectDir, "bin/kota.mjs")),
    });
    const runArtifactBaseDir = join(workflow.runDirPath, "eval-runs");
    const requestedProfile =
      detectHostSubprocessResourceProfile(CADENCE_HOST_CLASS);
    const report = await runEvalSet({
      fixtures,
      executor,
      requestedProfile,
      runArtifactBaseDir,
      repeatCount: CADENCE_REPEAT_COUNT,
    });

    const priorBaseline = loadBaseline(projectDir);
    const assessment = assessAgainstBaseline(priorBaseline, {
      aggregate: report.aggregate,
      executionProfile: report.executionProfile,
      runArtifactBaseDir: report.runArtifactBaseDir,
      recordedAt: report.completedAt,
    });

    if (assessment.status === "gated") {
      emit("eval-harness.regression.detected", {
        baseline: {
          fixtureCount: assessment.priorBaseline.aggregate.fixtureCount,
          repeatCount: assessment.priorBaseline.aggregate.repeatCount ?? 0,
          passAtK: assessment.priorBaseline.aggregate.passAtK,
          passHatK: assessment.priorBaseline.aggregate.passHatK,
        },
        candidate: {
          fixtureCount: report.aggregate.fixtureCount,
          repeatCount: report.repeatCount,
          passAtK: report.aggregate.passAtK,
          passHatK: report.aggregate.passHatK,
        },
        hostClass: report.resourceProfile.hostClass,
        noiseBandPercentagePoints: assessment.noiseBandPercentagePoints,
        dropPercentagePoints: assessment.dropPercentagePoints,
        runArtifactBaseDir: report.runArtifactBaseDir,
        reason: assessment.reason,
      });
    } else if (
      assessment.status === "first-run" ||
      assessment.status === "not-gated"
    ) {
      saveBaseline(projectDir, assessment.baselineToRecord);
    }

    writeFileSync(
      join(workflow.runDirPath, "ran-at.json"),
      JSON.stringify(
        {
          fixtureCount: report.aggregate.fixtureCount,
          repeatCount: report.repeatCount,
          passAtK: report.aggregate.passAtK,
          passHatK: report.aggregate.passHatK,
          resourceProfile: report.resourceProfile,
          executionProfile: report.executionProfile,
          startedAt: report.startedAt,
          completedAt: report.completedAt,
          assessment: summarizeAssessment(assessment),
        },
        null,
        2,
      ),
    );

    emit(evalHarnessSetCompleted.name, {
      fixtureCount: report.aggregate.fixtureCount,
      repeatCount: report.repeatCount,
      passAtK: report.aggregate.passAtK,
      passHatK: report.aggregate.passHatK,
      hostClass: report.resourceProfile.hostClass,
      runArtifactBaseDir: report.runArtifactBaseDir,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
    });

    return {
      fixtureCount: report.aggregate.fixtureCount,
      repeatCount: report.repeatCount,
      passAtK: report.aggregate.passAtK,
      passHatK: report.aggregate.passHatK,
      runArtifactBaseDir: report.runArtifactBaseDir,
      assessmentStatus: assessment.status,
    };
  },
});

function summarizeAssessment(
  assessment: BaselineAssessment,
): Record<string, unknown> {
  if (assessment.status === "non-gating") {
    return {
      status: "non-gating",
      reason: assessment.reason,
      resourceProfile: assessment.resourceProfile,
    };
  }
  if (assessment.status === "first-run") {
    return { status: "first-run" };
  }
  if (assessment.status === "gated") {
    return {
      status: "gated",
      reason: assessment.reason,
      dropPercentagePoints: assessment.dropPercentagePoints,
      noiseBandPercentagePoints: assessment.noiseBandPercentagePoints,
    };
  }
  return {
    status: "not-gated",
    reason: assessment.reason,
    dropPercentagePoints: assessment.dropPercentagePoints,
    noiseBandPercentagePoints: assessment.noiseBandPercentagePoints,
  };
}

const evalHarnessCadence: WorkflowDefinitionInput = {
  name: "eval-harness-cadence",
  description:
    "Run the autonomy eval harness fixture set on a weekly cadence and emit aggregate telemetry.",
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      // Sunday 07:00 local — off-hours so a long run does not clash with
      // interactive autonomy; operators can adjust per deployment.
      schedule: "0 7 * * 0",
    },
  ],
  steps: [runHarness],
};

export default evalHarnessCadence;
