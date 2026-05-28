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
import { isAbsolute, join, resolve } from "node:path";
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
import type { FixtureDiagnosticAggregate } from "./scoring.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
  type SubprocessIsolationBackend,
} from "./subprocess-executor.js";

type CadenceResult = {
  fixtureCount: number;
  repeatCount: number;
  passAtK: number;
  passHatK: number;
  fixtureDiagnostics: FixtureDiagnosticAggregate;
  runArtifactBaseDir: string;
  assessmentStatus: BaselineAssessment["status"];
};

const CADENCE_HOST_CLASS = "autonomy-cadence";
const CADENCE_REPEAT_COUNT = 3;
export const EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV =
  "KOTA_EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE";
export const EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV =
  "KOTA_EVAL_HARNESS_CADENCE_CONTAINER_IMAGE";
export const EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV =
  "KOTA_EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH";

export function resolveCadenceIsolationBackend(
  env: NodeJS.ProcessEnv = process.env,
): SubprocessIsolationBackend {
  const executable = env[EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV];
  const image = env[EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV];
  const kotaBinaryPath =
    env[EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV];
  if (
    executable === undefined &&
    image === undefined &&
    kotaBinaryPath === undefined
  ) {
    return { kind: "host-subprocess" };
  }
  if (
    executable === undefined ||
    image === undefined ||
    kotaBinaryPath === undefined ||
    executable.length === 0 ||
    image.length === 0 ||
    kotaBinaryPath.length === 0
  ) {
    throw new Error(
      `${EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV}, ${EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV}, and ${EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV} must be set together.`,
    );
  }
  if (!isAbsolute(kotaBinaryPath)) {
    throw new Error(
      `${EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV} must be an absolute container path.`,
    );
  }
  return { kind: "container", executable, image, kotaBinaryPath };
}

const runHarness = typedCodeStep<CadenceResult>({
  id: "run-harness",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<CadenceResult>(raw, [
      "fixtureCount",
      "repeatCount",
      "passAtK",
      "passHatK",
      "fixtureDiagnostics",
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
      isolationBackend: resolveCadenceIsolationBackend(),
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
          fixtureDiagnostics: report.fixtureDiagnostics.aggregate,
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
      fixtureDiagnostics: report.fixtureDiagnostics.aggregate,
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
      fixtureDiagnostics: report.fixtureDiagnostics.aggregate,
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
