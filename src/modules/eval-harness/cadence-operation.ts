import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  defineWorkflowBlockingOperation,
  type WorkflowBlockingOperationContext,
} from "#core/workflow/blocking-operation.js";
import {
  assessAgainstBaseline,
  type BaselineAssessment,
} from "./baseline-assessment.js";
import { loadBaseline, saveBaseline } from "./baseline-store.js";
import { runEvalSet } from "./eval-set.js";
import type { EvalHarnessSetCompletedPayload } from "./events.js";
import { loadAllFixtures } from "./fixture.js";
import type { FixtureDiagnosticAggregate } from "./scoring.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
  type SubprocessIsolationBackend,
} from "./subprocess-executor.js";

const CADENCE_HOST_CLASS = "autonomy-cadence";
const CADENCE_REPEAT_COUNT = 3;
const CADENCE_PROGRESS_INTERVAL_MS = 30_000;

export type EvalHarnessCadenceResult = {
  fixtureCount: number;
  repeatCount: number;
  passAtK: number;
  passHatK: number;
  fixtureDiagnostics: FixtureDiagnosticAggregate;
  runArtifactBaseDir: string;
  assessmentStatus: BaselineAssessment["status"];
};

export type EvalHarnessRegressionPayload = {
  baseline: {
    fixtureCount: number;
    repeatCount: number;
    passAtK: number;
    passHatK: number;
  };
  candidate: {
    fixtureCount: number;
    repeatCount: number;
    passAtK: number;
    passHatK: number;
  };
  hostClass: string;
  noiseBandPercentagePoints: number;
  dropPercentagePoints: number;
  runArtifactBaseDir: string;
  reason: string;
};

export type EvalHarnessCadenceOperationInput = {
  projectDir: string;
  runDirPath: string;
  isolationBackend: Extract<SubprocessIsolationBackend, { kind: "container" }>;
};

export type EvalHarnessCadenceOperationOutput = {
  result: EvalHarnessCadenceResult;
  completedEvent: EvalHarnessSetCompletedPayload;
  regressionEvent: EvalHarnessRegressionPayload | null;
};

function summarizeAssessment(assessment: BaselineAssessment) {
  if (assessment.status === "non-gating") {
    if (assessment.kind === "run-configuration") {
      return {
        status: "non-gating" as const,
        kind: assessment.kind,
        reason: assessment.reason,
        comparison: assessment.comparison,
      };
    }
    return {
      status: "non-gating" as const,
      kind: assessment.kind,
      reason: assessment.reason,
      resourceProfile: assessment.resourceProfile,
    };
  }
  if (assessment.status === "first-run") {
    return { status: "first-run" as const };
  }
  if (assessment.status === "gated") {
    return {
      status: "gated" as const,
      reason: assessment.reason,
      dropPercentagePoints: assessment.dropPercentagePoints,
      noiseBandPercentagePoints: assessment.noiseBandPercentagePoints,
    };
  }
  return {
    status: "not-gated" as const,
    reason: assessment.reason,
    dropPercentagePoints: assessment.dropPercentagePoints,
    noiseBandPercentagePoints: assessment.noiseBandPercentagePoints,
  };
}

function regressionPayload(
  assessment: Extract<BaselineAssessment, { status: "gated" }>,
  result: EvalHarnessCadenceResult,
  hostClass: string,
): EvalHarnessRegressionPayload {
  return {
    baseline: {
      fixtureCount: assessment.priorBaseline.aggregate.fixtureCount,
      repeatCount: assessment.priorBaseline.aggregate.repeatCount ?? 0,
      passAtK: assessment.priorBaseline.aggregate.passAtK,
      passHatK: assessment.priorBaseline.aggregate.passHatK,
    },
    candidate: {
      fixtureCount: result.fixtureCount,
      repeatCount: result.repeatCount,
      passAtK: result.passAtK,
      passHatK: result.passHatK,
    },
    hostClass,
    noiseBandPercentagePoints: assessment.noiseBandPercentagePoints,
    dropPercentagePoints: assessment.dropPercentagePoints,
    runArtifactBaseDir: result.runArtifactBaseDir,
    reason: assessment.reason,
  };
}

export async function runEvalHarnessCadenceInWorker(
  input: EvalHarnessCadenceOperationInput,
  context: WorkflowBlockingOperationContext,
): Promise<EvalHarnessCadenceOperationOutput> {
  context.signal.throwIfAborted();
  context.reportProgress("loading eval-harness cadence fixtures");
  const fixturesRoot = join(input.projectDir, "src/modules/eval-harness/fixtures");
  const fixtures = loadAllFixtures(fixturesRoot);
  if (fixtures.length === 0) {
    throw new Error(
      `eval-harness cadence has no fixtures under "${fixturesRoot}". ` +
        "Add at least one fixture before enabling the cadence workflow.",
    );
  }

  const executor = createSubprocessExecutor({
    kotaBinaryPath: resolve(join(input.projectDir, "bin/kota.mjs")),
    isolationBackend: input.isolationBackend,
    signal: context.signal,
  });
  const runArtifactBaseDir = join(input.runDirPath, "eval-runs");
  const requestedProfile =
    detectHostSubprocessResourceProfile(CADENCE_HOST_CLASS);
  const priorBaseline = loadBaseline(input.projectDir);
  const progressHeartbeat = setInterval(
    () => context.reportProgress("eval-harness cadence fixtures running"),
    CADENCE_PROGRESS_INTERVAL_MS,
  );
  progressHeartbeat.unref();

  try {
    const report = await runEvalSet({
      projectDir: input.projectDir,
      fixtures,
      executor,
      requestedProfile,
      runArtifactBaseDir,
      repeatCount: CADENCE_REPEAT_COUNT,
      priorBaseline,
    });
    context.signal.throwIfAborted();

    const assessment = assessAgainstBaseline(priorBaseline, {
      aggregate: report.aggregate,
      executionProfile: report.executionProfile,
      runConfiguration: report.runConfiguration,
      componentAttribution: report.componentAttribution,
      runArtifactBaseDir: report.runArtifactBaseDir,
      recordedAt: report.completedAt,
    });

    if (
      assessment.status === "first-run" ||
      assessment.status === "not-gated" ||
      (assessment.status === "non-gating" &&
        assessment.kind === "run-configuration")
    ) {
      saveBaseline(input.projectDir, assessment.baselineToRecord);
    }

    writeFileSync(
      join(input.runDirPath, "ran-at.json"),
      JSON.stringify(
        {
          fixtureCount: report.aggregate.fixtureCount,
          repeatCount: report.repeatCount,
          passAtK: report.aggregate.passAtK,
          passHatK: report.aggregate.passHatK,
          fixtureDiagnostics: report.fixtureDiagnostics.aggregate,
          resourceProfile: report.resourceProfile,
          executionProfile: report.executionProfile,
          runConfiguration: report.runConfiguration,
          componentAttribution: report.componentAttribution,
          startedAt: report.startedAt,
          completedAt: report.completedAt,
          assessment: summarizeAssessment(assessment),
        },
        null,
        2,
      ),
    );

    const result: EvalHarnessCadenceResult = {
      fixtureCount: report.aggregate.fixtureCount,
      repeatCount: report.repeatCount,
      passAtK: report.aggregate.passAtK,
      passHatK: report.aggregate.passHatK,
      fixtureDiagnostics: report.fixtureDiagnostics.aggregate,
      runArtifactBaseDir: report.runArtifactBaseDir,
      assessmentStatus: assessment.status,
    };
    const completedEvent: EvalHarnessSetCompletedPayload = {
      fixtureCount: result.fixtureCount,
      repeatCount: result.repeatCount,
      passAtK: result.passAtK,
      passHatK: result.passHatK,
      fixtureDiagnostics: result.fixtureDiagnostics,
      hostClass: report.resourceProfile.hostClass,
      runArtifactBaseDir: result.runArtifactBaseDir,
      runConfigurationFingerprint: report.runConfiguration.fingerprint,
      runConfigurationSummary: report.runConfiguration.summary,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
    };
    context.reportProgress("eval-harness cadence complete");
    return {
      result,
      completedEvent,
      regressionEvent:
        assessment.status === "gated"
          ? regressionPayload(assessment, result, report.resourceProfile.hostClass)
          : null,
    };
  } finally {
    clearInterval(progressHeartbeat);
  }
}

export const evalHarnessCadenceOperation = defineWorkflowBlockingOperation<
  EvalHarnessCadenceOperationInput,
  EvalHarnessCadenceOperationOutput
>(import.meta.url, "runEvalHarnessCadenceInWorker");
