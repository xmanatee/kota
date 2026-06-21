
import { FixtureVerifierCalibrationError } from "./fixture-errors.js";
import {
  type FixtureSpecFile,
  isSingleWorkflowFixtureSpec,
  isSkillAblationFixtureSpec,
} from "./fixture-spec-types.js";
import type { ObjectiveMetricSpec } from "./objective-metrics.js";
import type { FixturePredicate } from "./predicates.js";

export function predicateCanUseVerifierCalibration(
  predicate: FixturePredicate,
): boolean {
  return (
    predicate.kind === "shell-succeeds" ||
    predicate.kind === "shell-fails" ||
    predicate.kind === "lx12-scientific-claim-result"
  );
}

function predicateRequiresVerifierCalibration(
  predicate: FixturePredicate,
): boolean {
  return predicateCanUseVerifierCalibration(predicate);
}

function objectiveMetricsForSpec(spec: FixtureSpecFile): ObjectiveMetricSpec[] {
  if (isSingleWorkflowFixtureSpec(spec)) {
    return [...(spec.objectiveMetrics ?? [])];
  }
  if (isSkillAblationFixtureSpec(spec)) {
    return [];
  }
  return [
    ...spec.rounds.flatMap((round) => round.objectiveMetrics ?? []),
    ...(spec.aggregateObjectiveMetrics ?? []),
  ];
}

function requiredVerifierCalibrationObjectiveMetricsForSpec(
  spec: FixtureSpecFile,
): ObjectiveMetricSpec[] {
  return objectiveMetricsForSpec(spec);
}

function uniquePredicates(predicates: readonly FixturePredicate[]): FixturePredicate[] {
  const seen = new Set<string>();
  const unique: FixturePredicate[] = [];
  for (const predicate of predicates) {
    const key = JSON.stringify(predicate);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(predicate);
  }
  return unique;
}

export function verifierCalibrationPredicatesForSpec(
  spec: FixtureSpecFile,
): FixturePredicate[] {
  const predicates = isSingleWorkflowFixtureSpec(spec)
    ? spec.predicates
    : isSkillAblationFixtureSpec(spec)
      ? spec.variants.flatMap((variant) => variant.predicates)
      : [
        ...spec.rounds.flatMap((round) => round.predicates),
        ...(spec.aggregatePredicates ?? []),
      ];
  return uniquePredicates(predicates.filter(predicateCanUseVerifierCalibration));
}

function requiredVerifierCalibrationPredicatesForSpec(
  spec: FixtureSpecFile,
): FixturePredicate[] {
  return verifierCalibrationPredicatesForSpec(spec).filter(
    predicateRequiresVerifierCalibration,
  );
}

export function assertRequiredVerifierCalibration(
  spec: FixtureSpecFile,
  fixtureDir: string,
): void {
  const requiredPredicates = requiredVerifierCalibrationPredicatesForSpec(spec);
  const requiredMetrics = requiredVerifierCalibrationObjectiveMetricsForSpec(spec);
  if (
    (requiredPredicates.length === 0 && requiredMetrics.length === 0) ||
    spec.verifierCalibration !== undefined
  ) {
    return;
  }
  const required = [
    ...(requiredPredicates.length > 0
      ? [
          `calibrated predicate kind(s): ${[
            ...new Set(requiredPredicates.map((predicate) => predicate.kind)),
          ].join(", ")}`,
        ]
      : []),
    ...(requiredMetrics.length > 0
      ? [
          `objective metric(s): ${[
            ...new Set(requiredMetrics.map((metric) => metric.name)),
          ].join(", ")}`,
        ]
      : []),
  ];
  throw new FixtureVerifierCalibrationError(
    fixtureDir,
    "missing-required",
    `missing null, golden, and adversarial cases for ${required.join("; ")}.`,
  );
}
