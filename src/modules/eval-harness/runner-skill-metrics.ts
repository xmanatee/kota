
import type { SkillAblationFixtureSpecFile, SkillAblationVariantSpec } from "./fixture.js";
import type { ExecutionProfilePreflightResult, FixtureRunOutcome, SkillAblationObjectiveMetric, SkillAblationVariantRun } from "./fixture-run.js";
import { resourceProfileFromExecutionProfile } from "./fixture-run.js";
import type { ObservedObjectiveMetric } from "./objective-metrics.js";
import type { PredicateEvalResult } from "./predicates.js";
import type { WorkflowExecutionOutcome } from "./runner-types.js";

export function skillAblationObjectiveMetrics(
  variant: SkillAblationVariantSpec,
  predicateResults: readonly PredicateEvalResult[],
): SkillAblationObjectiveMetric[] {
  const passedCount = predicateResults.filter((result) => result.passed).length;
  const total = predicateResults.length;
  return [
    {
      name: `${variant.id}.predicate_pass_rate`,
      unit: "ratio",
      direction: "higher_is_better",
      source: "predicate-results",
      value: total === 0 ? 0 : passedCount / total,
    },
  ];
}

export function topLevelObjectiveMetricsForSkillAblation(params: {
  fixtureId: string;
  variantRuns: readonly SkillAblationVariantRun[];
  executionProfile: ExecutionProfilePreflightResult;
  runIndex: number;
  repeatCount: number;
}): ObservedObjectiveMetric[] {
  const resourceProfile = resourceProfileFromExecutionProfile(
    params.executionProfile,
  );
  const executionProfile =
    params.executionProfile.status === "verified"
      ? {
          status: params.executionProfile.status,
          backendKind: params.executionProfile.backendKind,
          verification: params.executionProfile.verification,
          gateEligible: params.executionProfile.gateEligible,
          reason: params.executionProfile.eligibilityReason,
        }
      : params.executionProfile.status === "rejected"
        ? {
            status: params.executionProfile.status,
            backendKind: params.executionProfile.backendKind,
            verification: params.executionProfile.verification,
            gateEligible: params.executionProfile.gateEligible,
            reason: params.executionProfile.rejectionReason,
          }
        : {
            status: params.executionProfile.status,
            backendKind: params.executionProfile.backendKind,
            verification: params.executionProfile.verification,
            gateEligible: params.executionProfile.gateEligible,
            reason: params.executionProfile.nonGatingReason,
          };
  return params.variantRuns.flatMap((variantRun) =>
    variantRun.objectiveMetrics.map((metric) => ({
      fixtureId: params.fixtureId,
      name: metric.name,
      unit: metric.unit,
      direction: metric.direction,
      source: {
        kind: "text-file" as const,
        path: `skill-ablation:${variantRun.id}`,
      },
      value: metric.value,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      resourceProfile,
      executionProfile,
    })),
  );
}

export function evaluateSkillAblationDirection(params: {
  spec: SkillAblationFixtureSpecFile;
  variants: readonly SkillAblationVariantRun[];
}): boolean {
  const byId = new Map(params.variants.map((variant) => [variant.id, variant]));
  const direction = params.spec.expectedDirection;
  const control = byId.get(direction.controlVariantId);
  const treatment = byId.get(direction.treatmentVariantId);
  if (control === undefined || treatment === undefined) return false;
  return control.observedOutcome === "fail" && treatment.observedOutcome === "pass";
}

export function summarizeSkillAblationOutcome(
  variants: readonly SkillAblationVariantRun[],
  directionPassed: boolean,
): FixtureRunOutcome {
  if (variants.some((variant) => variant.observedOutcome === "error")) {
    return "error";
  }
  if (variants.some((variant) => variant.observedOutcome === "timeout")) {
    return "timeout";
  }
  if (
    variants.some((variant) => variant.observedOutcome === "configuration-error")
  ) {
    return "configuration-error";
  }
  return variants.every((variant) => variant.expectationPassed) && directionPassed
    ? "pass"
    : "fail";
}

export function skillAblationExecutionOutcome(
  outcome: FixtureRunOutcome,
  durationMs: number,
): WorkflowExecutionOutcome {
  if (outcome === "timeout") {
    return { kind: "timeout", durationMs, runArtifactPath: null };
  }
  if (outcome === "error") {
    return {
      kind: "error",
      durationMs,
      message: "one or more skill-ablation variants errored",
      runArtifactPath: null,
    };
  }
  if (outcome === "configuration-error") {
    return {
      kind: "not-started",
      durationMs,
      reason: "pre-run-sanity-failed",
      runArtifactPath: null,
    };
  }
  return { kind: "completed", durationMs, runArtifactPath: null };
}
