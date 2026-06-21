
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { LoadedFixture, VerifierCalibrationCaseSpec, VerifierCalibrationSetupOperation } from "./fixture.js";
import type { ExecutionProfilePreflightResult } from "./fixture-run.js";
import { evaluateObjectiveMetrics, type ObjectiveMetricSpec, ObjectiveMetricValidationError, type ObservedObjectiveMetric } from "./objective-metrics.js";
import type { FixturePredicate } from "./predicates.js";
import { evaluatePredicates } from "./predicates.js";
import { materializeFixtureWorkingDir, relativePathInside } from "./runner-materialize.js";
import type { SerializedCalibrationError, VerifierCalibrationCaseResult } from "./runner-types.js";

function serializeCalibrationError(error: Error): SerializedCalibrationError {
  if (error instanceof ObjectiveMetricValidationError) {
    return {
      name: error.name,
      message: error.message,
      reason: error.reason,
      fixtureId: error.fixtureId,
      metricName: error.metricName,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return {
    name: "NonErrorThrown",
    message: String(error),
  };
}

function applyVerifierCalibrationSetup(params: {
  fixtureDir: string;
  workingDir: string;
  operation: VerifierCalibrationSetupOperation;
}): void {
  switch (params.operation.kind) {
    case "copy-fixture-file": {
      const source = relativePathInside(
        params.fixtureDir,
        params.operation.sourcePath,
        "verifierCalibration setup sourcePath",
      );
      const target = relativePathInside(
        params.workingDir,
        params.operation.targetPath,
        "verifierCalibration setup targetPath",
      );
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target);
      break;
    }
  }
}

export function evaluateVerifierCalibrationCase(params: {
  fixture: LoadedFixture;
  caseSpec: VerifierCalibrationCaseSpec;
  predicates: readonly FixturePredicate[];
  objectiveMetricSpecs: readonly ObjectiveMetricSpec[];
  executionProfile: ExecutionProfilePreflightResult;
  runIndex: number;
  repeatCount: number;
}): VerifierCalibrationCaseResult {
  const { workingDir } = materializeFixtureWorkingDir(params.fixture);
  try {
    for (const operation of params.caseSpec.setup) {
      applyVerifierCalibrationSetup({
        fixtureDir: params.fixture.fixtureDir,
        workingDir,
        operation,
      });
    }
    const predicateEvaluation = evaluatePredicates(workingDir, params.predicates);
    let objectiveMetrics: ObservedObjectiveMetric[] = [];
    let objectiveMetricError: SerializedCalibrationError | undefined;
    try {
      objectiveMetrics = evaluateObjectiveMetrics({
        fixtureId: params.fixture.spec.id,
        metricSpecs: params.objectiveMetricSpecs,
        workingDir,
        executionProfile: params.executionProfile,
        runIndex: params.runIndex,
        repeatCount: params.repeatCount,
      });
    } catch (error) {
      objectiveMetricError =
        error instanceof Error
          ? serializeCalibrationError(error)
          : {
              name: "NonErrorThrown",
              message: String(error),
            };
    }
    const hasPredicates = params.predicates.length > 0;
    const scoringPassed = hasPredicates
      ? predicateEvaluation.passed
      : objectiveMetricError === undefined;
    const expectedPassed = params.caseSpec.expected === "pass";
    const expectedMatched = hasPredicates
      ? scoringPassed === expectedPassed
      : expectedPassed
        ? objectiveMetricError === undefined
        : true;
    const metricsMatched = !expectedPassed || objectiveMetricError === undefined;
    const passed = expectedMatched && metricsMatched;
    const detail = passed
      ? `case "${params.caseSpec.id}" matched expected verifier ${params.caseSpec.expected}`
      : `case "${params.caseSpec.id}" expected verifier ${params.caseSpec.expected} but observed ${scoringPassed ? "pass" : "fail"}${
          expectedPassed && objectiveMetricError !== undefined
            ? ` with objective metric error: ${objectiveMetricError.message}`
            : ""
        }`;
    return {
      id: params.caseSpec.id,
      caseKind: params.caseSpec.caseKind,
      expected: params.caseSpec.expected,
      setup: params.caseSpec.setup,
      passed,
      scoringPassed,
      predicateResults: predicateEvaluation.results,
      objectiveMetrics,
      ...(objectiveMetricError !== undefined && { objectiveMetricError }),
      detail,
    };
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
}
