import type {
  ExecutionProfilePreflightResult,
  FixtureRunOutcome,
  ResourceProfile,
} from "./fixture-run.js";
import {
  resourceProfileFromExecutionProfile,
  resourceProfilesComparable,
} from "./fixture-run.js";
import { extractObjectiveMetricValue } from "./objective-metrics-source.js";
import {
  type ObjectiveMetricComparison,
  type ObjectiveMetricComparisonBaseline,
  type ObjectiveMetricDirection,
  type ObjectiveMetricEvaluation,
  type ObjectiveMetricExecutionProfileSummary,
  type ObjectiveMetricObservationError,
  type ObjectiveMetricSpec,
  ObjectiveMetricValidationError,
  type ObservedObjectiveMetric,
} from "./objective-metrics-types.js";
import type { PredicateEvaluationContext } from "./predicates.js";

function summarizeExecutionProfile(
  profile: ExecutionProfilePreflightResult,
): ObjectiveMetricExecutionProfileSummary {
  if (profile.status === "verified") {
    return {
      status: profile.status,
      backendKind: profile.backendKind,
      verification: profile.verification,
      gateEligible: profile.gateEligible,
      reason: profile.eligibilityReason,
    };
  }
  if (profile.status === "rejected") {
    return {
      status: profile.status,
      backendKind: profile.backendKind,
      verification: profile.verification,
      gateEligible: profile.gateEligible,
      reason: profile.rejectionReason,
    };
  }
  return {
    status: profile.status,
    backendKind: profile.backendKind,
    verification: profile.verification,
    gateEligible: profile.gateEligible,
    reason: profile.nonGatingReason,
  };
}

function executionProfilesComparable(
  baseline: ObjectiveMetricComparisonBaseline["executionProfile"],
  current: ObjectiveMetricExecutionProfileSummary,
): boolean {
  return (
    current.gateEligible &&
    current.status === baseline.status &&
    current.backendKind === baseline.backendKind &&
    current.verification === baseline.verification
  );
}

export function compareObjectiveMetricToBaseline(params: {
  value: number;
  direction: ObjectiveMetricDirection;
  baseline: ObjectiveMetricComparisonBaseline;
  currentResourceProfile: ResourceProfile;
  currentExecutionProfile: ObjectiveMetricExecutionProfileSummary;
}): ObjectiveMetricComparison {
  const common = {
    baselineValue: params.baseline.value,
    currentValue: params.value,
    direction: params.direction,
    baselineResourceProfile: params.baseline.resourceProfile,
    currentResourceProfile: params.currentResourceProfile,
    baselineExecutionProfile: params.baseline.executionProfile,
    currentExecutionProfile: params.currentExecutionProfile,
  };
  if (
    !resourceProfilesComparable(
      params.baseline.resourceProfile,
      params.currentResourceProfile,
    )
  ) {
    return {
      status: "not-compared",
      reason: "resource-profile-incomparable",
      ...common,
    };
  }
  if (
    !executionProfilesComparable(
      params.baseline.executionProfile,
      params.currentExecutionProfile,
    )
  ) {
    return {
      status: "not-compared",
      reason: "execution-profile-incomparable",
      ...common,
    };
  }
  const delta = params.value - params.baseline.value;
  const improved =
    params.direction === "lower_is_better"
      ? params.value < params.baseline.value
      : params.value > params.baseline.value;
  return {
    status: "compared",
    delta,
    improved,
    ...common,
  };
}

export async function evaluateObjectiveMetrics(params: {
  fixtureId: string;
  metricSpecs: readonly ObjectiveMetricSpec[];
  workingDir: string;
  executionProfile: ExecutionProfilePreflightResult;
  runIndex: number;
  repeatCount: number;
  scoringContext?: PredicateEvaluationContext;
}): Promise<ObservedObjectiveMetric[]> {
  const resourceProfile = resourceProfileFromExecutionProfile(
    params.executionProfile,
  );
  const executionProfile = summarizeExecutionProfile(params.executionProfile);
  const metrics: ObservedObjectiveMetric[] = [];
  for (const spec of params.metricSpecs) {
    const value = await extractObjectiveMetricValue(
      params.workingDir,
      params.fixtureId,
      spec,
      params.scoringContext,
    );
    const comparison =
      spec.comparisonBaseline === undefined
        ? undefined
        : compareObjectiveMetricToBaseline({
            value,
            direction: spec.direction,
            baseline: spec.comparisonBaseline,
            currentResourceProfile: resourceProfile,
            currentExecutionProfile: executionProfile,
          });
    metrics.push({
      fixtureId: params.fixtureId,
      name: spec.name,
      unit: spec.unit,
      direction: spec.direction,
      source: spec.source,
      value,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      resourceProfile,
      executionProfile,
      ...(spec.comparisonBaseline !== undefined && {
        comparisonBaseline: spec.comparisonBaseline,
      }),
      ...(comparison !== undefined && { comparison }),
    });
  }
  return metrics;
}

/**
 * Capability failure is already a scored outcome, so an unavailable advisory
 * metric must not abort the remaining eval set. Preserve the extraction error
 * as run evidence. Passing runs keep the strict metric contract.
 */
export async function evaluateObjectiveMetricsForOutcome(params: {
  fixtureId: string;
  metricSpecs: readonly ObjectiveMetricSpec[];
  workingDir: string;
  executionProfile: ExecutionProfilePreflightResult;
  runIndex: number;
  repeatCount: number;
  outcome: FixtureRunOutcome;
  scoringContext?: PredicateEvaluationContext;
}): Promise<ObjectiveMetricEvaluation> {
  if (params.outcome === "pass") {
    return {
      objectiveMetrics: await evaluateObjectiveMetrics(params),
      objectiveMetricErrors: [],
    };
  }

  const objectiveMetrics: ObservedObjectiveMetric[] = [];
  const objectiveMetricErrors: ObjectiveMetricObservationError[] = [];
  for (const metricSpec of params.metricSpecs) {
    try {
      objectiveMetrics.push(
        ...(await evaluateObjectiveMetrics({
          ...params,
          metricSpecs: [metricSpec],
        })),
      );
    } catch (error) {
      if (!(error instanceof ObjectiveMetricValidationError)) throw error;
      objectiveMetricErrors.push({
        fixtureId: params.fixtureId,
        metricName: metricSpec.name,
        source: metricSpec.source,
        reason: error.reason,
        message: error.message,
      });
    }
  }
  return { objectiveMetrics, objectiveMetricErrors };
}
