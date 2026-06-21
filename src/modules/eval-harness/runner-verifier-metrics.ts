
import type { VerifierCalibrationCaseSpec } from "./fixture.js";
import type { ObjectiveMetricDirection, ObjectiveMetricSpec } from "./objective-metrics.js";
import type { VerifierCalibrationCaseResult, VerifierCalibrationObjectiveMetricComparison } from "./runner-types.js";

function metricValue(
  caseResult: VerifierCalibrationCaseResult,
  metricName: string,
): number | undefined {
  return caseResult.objectiveMetrics.find((metric) => metric.name === metricName)
    ?.value;
}

function metricIsBetter(params: {
  direction: ObjectiveMetricDirection;
  goldenValue: number;
  candidateValue: number;
}): boolean {
  return params.direction === "higher_is_better"
    ? params.goldenValue > params.candidateValue
    : params.goldenValue < params.candidateValue;
}

function appendMetricFailure(
  failures: Map<VerifierCalibrationCaseSpec["id"], string[]>,
  caseId: VerifierCalibrationCaseSpec["id"],
  detail: string,
): void {
  const existing = failures.get(caseId) ?? [];
  existing.push(detail);
  failures.set(caseId, existing);
}

export function compareObjectiveMetricCalibration(params: {
  objectiveMetricSpecs: readonly ObjectiveMetricSpec[];
  cases: readonly VerifierCalibrationCaseResult[];
}): {
  cases: readonly VerifierCalibrationCaseResult[];
  comparisons: readonly VerifierCalibrationObjectiveMetricComparison[];
} {
  if (params.objectiveMetricSpecs.length === 0) {
    return { cases: params.cases, comparisons: [] };
  }

  const casesById = new Map(params.cases.map((caseResult) => [caseResult.id, caseResult]));
  const golden = casesById.get("golden");
  const metricFailures = new Map<VerifierCalibrationCaseSpec["id"], string[]>();
  const comparisons = params.objectiveMetricSpecs.map((metricSpec) => {
    const goldenValue =
      golden === undefined ? undefined : metricValue(golden, metricSpec.name);
    const acceptedAlternativeCases = params.cases.filter(
      (caseResult) => caseResult.caseKind === "accepted-alternative",
    );
    const acceptedAlternativeValues = acceptedAlternativeCases.map((caseResult) => ({
      caseId: caseResult.id,
      ...(metricValue(caseResult, metricSpec.name) !== undefined && {
        value: metricValue(caseResult, metricSpec.name),
      }),
    }));
    const values: {
      goldenValue?: number;
      nullValue?: number;
      adversarialValue?: number;
    } = {
      ...(goldenValue !== undefined && { goldenValue }),
    };

    if (goldenValue === undefined) {
      appendMetricFailure(
        metricFailures,
        "golden",
        `golden case did not produce objective metric "${metricSpec.name}"`,
      );
      return {
        name: metricSpec.name,
        direction: metricSpec.direction,
        passed: false,
        acceptedAlternativeValues,
        ...values,
        detail: `golden case did not produce objective metric "${metricSpec.name}"`,
      };
    }

    const failedCaseDetails: string[] = [];
    for (const caseResult of acceptedAlternativeCases) {
      if (caseResult.objectiveMetricError !== undefined) {
        continue;
      }
      if (metricValue(caseResult, metricSpec.name) !== undefined) {
        continue;
      }
      const detail = `accepted alternative "${caseResult.id}" did not produce objective metric "${metricSpec.name}"`;
      appendMetricFailure(metricFailures, caseResult.id, detail);
      failedCaseDetails.push(detail);
    }
    for (const caseId of ["null", "adversarial"] as const) {
      const caseResult = casesById.get(caseId);
      if (caseResult === undefined || caseResult.objectiveMetricError !== undefined) {
        continue;
      }
      const candidateValue = metricValue(caseResult, metricSpec.name);
      if (candidateValue === undefined) {
        const detail = `${caseId} case did not produce objective metric "${metricSpec.name}"`;
        appendMetricFailure(metricFailures, caseId, detail);
        failedCaseDetails.push(detail);
        continue;
      }
      if (caseId === "null") {
        values.nullValue = candidateValue;
      } else {
        values.adversarialValue = candidateValue;
      }
      if (
        !metricIsBetter({
          direction: metricSpec.direction,
          goldenValue,
          candidateValue,
        })
      ) {
        const detail = `${caseId} objective metric "${metricSpec.name}" value ${candidateValue} was not worse than golden value ${goldenValue}`;
        appendMetricFailure(metricFailures, caseId, detail);
        failedCaseDetails.push(detail);
      }
    }

    return {
      name: metricSpec.name,
      direction: metricSpec.direction,
      passed: failedCaseDetails.length === 0,
      acceptedAlternativeValues,
      ...values,
      detail:
        failedCaseDetails.length === 0
          ? `golden objective metric "${metricSpec.name}" was better than null and adversarial numeric values, or those cases failed metric evaluation`
          : failedCaseDetails.join("; "),
    };
  });

  return {
    cases: params.cases.map((caseResult) => {
      const failures = metricFailures.get(caseResult.id) ?? [];
      if (failures.length === 0) return caseResult;
      return {
        ...caseResult,
        passed: false,
        detail: `${caseResult.detail}; objective metric calibration failed: ${failures.join("; ")}`,
      };
    }),
    comparisons,
  };
}
