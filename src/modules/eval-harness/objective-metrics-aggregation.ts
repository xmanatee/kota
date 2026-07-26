import { resourceProfilesComparable } from "./fixture-run.js";
import { compareObjectiveMetricToBaseline } from "./objective-metrics-evaluation.js";
import {
  type AggregateObjectiveMetric,
  type ObjectiveMetricComparison,
  type ObjectiveMetricExecutionComparison,
  type ObjectiveMetricResourceComparison,
  ObjectiveMetricValidationError,
  type ObservedObjectiveMetric,
} from "./objective-metrics-types.js";

function uniqueByJson<T>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function resourceComparison(
  metrics: readonly ObservedObjectiveMetric[],
): ObjectiveMetricResourceComparison {
  const first = metrics[0].resourceProfile;
  if (
    metrics.every((metric) =>
      resourceProfilesComparable(first, metric.resourceProfile),
    )
  ) {
    return { status: "comparable", resourceProfile: first };
  }
  return {
    status: "not-comparable",
    reason: "mixed-resource-profiles",
    resourceProfiles: uniqueByJson(metrics.map((metric) => metric.resourceProfile)),
  };
}

function executionComparison(
  metrics: readonly ObservedObjectiveMetric[],
): ObjectiveMetricExecutionComparison {
  const profiles = metrics.map((metric) => metric.executionProfile);
  if (profiles.some((profile) => !profile.gateEligible)) {
    return {
      status: "not-comparable",
      reason: "non-gating-execution-profile",
      executionProfiles: uniqueByJson(profiles),
    };
  }
  const first = profiles[0];
  if (
    profiles.every(
      (profile) =>
        profile.status === first.status &&
        profile.backendKind === first.backendKind &&
        profile.verification === first.verification &&
        profile.gateEligible === first.gateEligible,
    )
  ) {
    return { status: "comparable", executionProfile: first };
  }
  return {
    status: "not-comparable",
    reason: "mixed-execution-profiles",
    executionProfiles: uniqueByJson(profiles),
  };
}

function assertMetricIdentityStable(
  fixtureId: string,
  name: string,
  metrics: readonly ObservedObjectiveMetric[],
): void {
  const first = metrics[0];
  for (const metric of metrics) {
    if (metric.unit !== first.unit || metric.direction !== first.direction) {
      throw new ObjectiveMetricValidationError(
        "malformed-declaration",
        `Objective metric "${name}" for fixture "${fixtureId}" has inconsistent unit or direction across runs.`,
        { fixtureId, metricName: name },
      );
    }
    if (
      JSON.stringify(metric.comparisonBaseline ?? null) !==
      JSON.stringify(first.comparisonBaseline ?? null)
    ) {
      throw new ObjectiveMetricValidationError(
        "environment-incomparable",
        `Objective metric "${name}" for fixture "${fixtureId}" has inconsistent comparison baselines across runs.`,
        { fixtureId, metricName: name },
      );
    }
  }
}

export function aggregateObjectiveMetrics(
  runs: readonly { objectiveMetrics: readonly ObservedObjectiveMetric[] }[],
): AggregateObjectiveMetric[] {
  const grouped = new Map<string, ObservedObjectiveMetric[]>();
  for (const run of runs) {
    for (const metric of run.objectiveMetrics) {
      const key = `${metric.fixtureId}\u0000${metric.name}`;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(metric);
      else grouped.set(key, [metric]);
    }
  }

  const aggregates: AggregateObjectiveMetric[] = [];
  for (const bucket of grouped.values()) {
    const first = bucket[0];
    assertMetricIdentityStable(first.fixtureId, first.name, bucket);
    const values = bucket.map((metric) => metric.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const profileComparison = resourceComparison(bucket);
    const executionProfileComparison = executionComparison(bucket);
    let comparison: ObjectiveMetricComparison | undefined;
    if (first.comparisonBaseline !== undefined) {
      if (profileComparison.status !== "comparable") {
        comparison = {
          status: "not-compared",
          reason: "resource-profile-incomparable",
          baselineValue: first.comparisonBaseline.value,
          currentValue: mean,
          direction: first.direction,
          baselineResourceProfile: first.comparisonBaseline.resourceProfile,
          currentResourceProfile: bucket[0].resourceProfile,
          baselineExecutionProfile: first.comparisonBaseline.executionProfile,
          currentExecutionProfile: bucket[0].executionProfile,
        };
      } else if (executionProfileComparison.status !== "comparable") {
        comparison = {
          status: "not-compared",
          reason: "execution-profile-incomparable",
          baselineValue: first.comparisonBaseline.value,
          currentValue: mean,
          direction: first.direction,
          baselineResourceProfile: first.comparisonBaseline.resourceProfile,
          currentResourceProfile: profileComparison.resourceProfile,
          baselineExecutionProfile: first.comparisonBaseline.executionProfile,
          currentExecutionProfile: bucket[0].executionProfile,
        };
      } else {
        comparison = compareObjectiveMetricToBaseline({
          value: mean,
          direction: first.direction,
          baseline: first.comparisonBaseline,
          currentResourceProfile: profileComparison.resourceProfile,
          currentExecutionProfile: executionProfileComparison.executionProfile,
        });
      }
    }
    aggregates.push({
      fixtureId: first.fixtureId,
      name: first.name,
      unit: first.unit,
      direction: first.direction,
      sampleCount: values.length,
      values,
      min,
      max,
      mean,
      resourceProfileComparison: profileComparison,
      executionProfileComparison,
      ...(first.comparisonBaseline !== undefined && {
        comparisonBaseline: first.comparisonBaseline,
      }),
      ...(comparison !== undefined && { comparison }),
    });
  }
  return aggregates.sort((a, b) =>
    `${a.fixtureId}.${a.name}`.localeCompare(`${b.fixtureId}.${b.name}`),
  );
}
