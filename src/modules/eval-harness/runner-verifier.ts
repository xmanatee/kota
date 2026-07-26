
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMultiRoundFixtureSpec, isSkillAblationFixtureSpec, type LoadedFixture, verifierCalibrationPredicatesForSpec } from "./fixture.js";
import type { ExecutionProfilePreflightResult, FixtureRunConfigurationError } from "./fixture-run.js";
import type { ObjectiveMetricSpec } from "./objective-metrics.js";
import type { PredicateEvaluationContext } from "./predicates.js";
import type {
  VerifierCalibrationCaseResult,
  VerifierCalibrationRunResult,
} from "./runner-types.js";
import { evaluateVerifierCalibrationCase } from "./runner-verifier-case.js";
import { compareObjectiveMetricCalibration } from "./runner-verifier-metrics.js";

function collectObjectiveMetricSpecs(
  spec: LoadedFixture["spec"],
): ObjectiveMetricSpec[] {
  if (isMultiRoundFixtureSpec(spec)) {
    return [
      ...spec.rounds.flatMap((round) => round.objectiveMetrics ?? []),
      ...(spec.aggregateObjectiveMetrics ?? []),
    ];
  }
  if (isSkillAblationFixtureSpec(spec)) {
    return [];
  }
  return [...(spec.objectiveMetrics ?? [])];
}

export async function evaluateVerifierCalibration(params: {
  fixture: LoadedFixture;
  executionProfile: ExecutionProfilePreflightResult;
  predicateContext?: PredicateEvaluationContext;
  runIndex: number;
  repeatCount: number;
}): Promise<VerifierCalibrationRunResult | undefined> {
  const spec = params.fixture.spec.verifierCalibration;
  if (spec === undefined) return undefined;
  const predicates = verifierCalibrationPredicatesForSpec(params.fixture.spec);
  const objectiveMetricSpecs = collectObjectiveMetricSpecs(params.fixture.spec);
  const cases: VerifierCalibrationCaseResult[] = [];
  for (const caseSpec of spec.cases) {
    cases.push(
      await evaluateVerifierCalibrationCase({
        fixture: params.fixture,
        caseSpec,
        predicates,
        objectiveMetricSpecs,
        executionProfile: params.executionProfile,
        predicateContext: params.predicateContext,
        runIndex: params.runIndex,
        repeatCount: params.repeatCount,
      }),
    );
  }
  const objectiveMetricCalibration = compareObjectiveMetricCalibration({
    objectiveMetricSpecs,
    cases,
  });
  return {
    fixtureId: params.fixture.spec.id,
    passed:
      objectiveMetricCalibration.cases.every((entry) => entry.passed) &&
      objectiveMetricCalibration.comparisons.every((entry) => entry.passed),
    calibratedPredicates: predicates,
    objectiveMetricCount: objectiveMetricSpecs.length,
    objectiveMetricComparisons: objectiveMetricCalibration.comparisons,
    cases: objectiveMetricCalibration.cases,
  };
}

export function writeVerifierCalibrationArtifact(
  runArtifactDir: string,
  result: VerifierCalibrationRunResult,
): void {
  mkdirSync(runArtifactDir, { recursive: true });
  writeFileSync(
    join(runArtifactDir, "verifier-calibration.json"),
    JSON.stringify(result, null, 2),
  );
}

export function verifierCalibrationConfigurationError(
  result: VerifierCalibrationRunResult,
): FixtureRunConfigurationError {
  const failedCases = result.cases.filter((caseResult) => !caseResult.passed);
  const failedComparisons = result.objectiveMetricComparisons.filter(
    (comparison) => !comparison.passed,
  );
  const details = [
    ...(failedCases.length > 0
      ? [
          `failed case(s): ${failedCases
            .map((caseResult) => `${caseResult.id} (${caseResult.caseKind})`)
            .join(", ")}`,
        ]
      : []),
    ...(failedComparisons.length > 0
      ? [
          `failed objective metric comparison(s): ${failedComparisons
            .map((comparison) => `${comparison.name}: ${comparison.detail}`)
            .join("; ")}`,
        ]
      : []),
  ];
  return {
    reason: "verifier-calibration-failed",
    detail:
      details.length > 0
        ? `verifier calibration failed; ${details.join("; ")}`
        : "verifier calibration failed",
  };
}
