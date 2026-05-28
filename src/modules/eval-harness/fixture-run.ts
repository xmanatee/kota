/**
 * Fixture-run contract for the autonomy eval harness.
 *
 * Every harness fixture produces one or more FixtureRun records. The shape is
 * deliberately opinionated: every run records its resource profile, its index
 * within the repeat set, and a timing envelope so that later scoring can
 * distinguish real regressions from host drift.
 */

import type { ObservedObjectiveMetric } from "./objective-metrics.js";

/**
 * Container resource configuration observed for a single fixture run.
 *
 * `*Allocation` is the guaranteed resource floor (e.g. Docker cpuset / memory
 * reservation). `*KillThreshold` is the hard ceiling that would terminate the
 * run (e.g. cgroup hard cap). They are kept as separate fields on purpose:
 * the Anthropic Mar 2026 infrastructure-noise post shows that collapsing them
 * to a single cap can swing a score by more than a model-level gap.
 */
export type ResourceProfile = {
  cpuAllocationCores: number;
  cpuKillThresholdCores: number;
  memoryAllocationMB: number;
  memoryKillThresholdMB: number;
  /**
   * Free-form host class label (e.g. "laptop-m3", "ci-standard-4x16") that
   * operators use to partition runs before comparing scores.
   */
  hostClass: string;
};

export type ExecutionBackendKind =
  | "host-subprocess"
  | "container"
  | "missing-isolation-backend";

export type ExecutionProfileVerification =
  | "enforced"
  | "observed"
  | "unverified";

export type ExecutionProfileDiagnostic = {
  severity: "info" | "warning";
  message: string;
};

export type ExecutionProfileNonGatingReason =
  | "host-subprocess-unverified"
  | "isolation-backend-unavailable"
  | "isolation-backend-config-invalid";

export type ExecutionProfileRejectionReason = "requested-observed-mismatch";

export type ExecutionProfilePreflightResult =
  | {
      status: "verified";
      backendKind: Exclude<ExecutionBackendKind, "missing-isolation-backend">;
      requestedProfile: ResourceProfile;
      observedOrEnforcedProfile: ResourceProfile;
      verification: Exclude<ExecutionProfileVerification, "unverified">;
      gateEligible: true;
      eligibilityReason: "verified-profile";
      diagnostics: ExecutionProfileDiagnostic[];
    }
  | {
      status: "non-gating";
      backendKind: ExecutionBackendKind;
      requestedProfile: ResourceProfile;
      observedOrEnforcedProfile: ResourceProfile;
      verification: ExecutionProfileVerification;
      gateEligible: false;
      nonGatingReason: ExecutionProfileNonGatingReason;
      diagnostics: ExecutionProfileDiagnostic[];
    }
  | {
      status: "rejected";
      backendKind: ExecutionBackendKind;
      requestedProfile: ResourceProfile;
      observedOrEnforcedProfile: ResourceProfile;
      verification: Extract<ExecutionProfileVerification, "observed">;
      gateEligible: false;
      rejectionReason: ExecutionProfileRejectionReason;
      diagnostics: ExecutionProfileDiagnostic[];
    };

export type TimingEnvelope = {
  /** ISO 8601 timestamp when the run started. */
  startedAt: string;
  /** Observed wall-clock duration of the run in milliseconds. */
  durationMs: number;
  /** Explicit budget for this run in milliseconds (the planned kill deadline). */
  budgetMs: number;
};

export type FixtureRunOutcome =
  | "pass"
  | "fail"
  | "timeout"
  | "error"
  | "configuration-error";

export type FixtureRoundRun = {
  roundId: string;
  /** 0-based index within the fixture's ordered round list. */
  roundIndex: number;
  workflowName: string;
  outcome: FixtureRunOutcome;
  objectiveMetrics: readonly ObservedObjectiveMetric[];
  timing: TimingEnvelope;
  /** Workflow run artifact path reported by the executor for this round. */
  runArtifactPath: string | null;
};

export type FixtureRun = {
  fixtureId: string;
  /** 0-based index of this run within a repeat set for the same fixture. */
  runIndex: number;
  /** Total number of runs planned for this fixture in this repeat set. */
  repeatCount: number;
  outcome: FixtureRunOutcome;
  resourceProfile: ResourceProfile;
  executionProfile: ExecutionProfilePreflightResult;
  /**
   * Deterministic numeric objective evidence observed for this run. Empty
   * when the fixture declares no objective metrics.
   */
  objectiveMetrics: readonly ObservedObjectiveMetric[];
  /**
   * Present only for persistent multi-round fixtures. The top-level fixture
   * remains one scored run; round records preserve diagnostic outcomes.
   */
  rounds?: readonly FixtureRoundRun[];
  timing: TimingEnvelope;
  /** Absolute path to the run artifact directory under `.kota/runs/`. */
  runArtifactPath: string;
};

/**
 * Two resource profiles are comparable when they share the same host class
 * and their allocation and kill-threshold values match. Fixture scores from
 * non-comparable profiles must not be diffed directly — the Mar 2026 post
 * documents >3pp swings from config drift alone.
 */
export function resourceProfilesComparable(
  a: ResourceProfile,
  b: ResourceProfile,
): boolean {
  return (
    a.hostClass === b.hostClass &&
    a.cpuAllocationCores === b.cpuAllocationCores &&
    a.cpuKillThresholdCores === b.cpuKillThresholdCores &&
    a.memoryAllocationMB === b.memoryAllocationMB &&
    a.memoryKillThresholdMB === b.memoryKillThresholdMB
  );
}

export function resourceProfileFromExecutionProfile(
  preflight: ExecutionProfilePreflightResult,
): ResourceProfile {
  return preflight.observedOrEnforcedProfile;
}

export function executionProfileGateReason(
  preflight: ExecutionProfilePreflightResult,
): "verified-profile" | ExecutionProfileNonGatingReason | ExecutionProfileRejectionReason {
  if (preflight.status === "verified") {
    return preflight.eligibilityReason;
  }
  if (preflight.status === "rejected") {
    return preflight.rejectionReason;
  }
  return preflight.nonGatingReason;
}

export function assertExecutionProfileCanScore(
  preflight: ExecutionProfilePreflightResult,
): void {
  if (preflight.status !== "rejected") return;
  throw new Error(
    `eval-harness execution profile rejected before scoring: ${preflight.rejectionReason}. ` +
      `Requested ${JSON.stringify(preflight.requestedProfile)} but observed ` +
      `${JSON.stringify(preflight.observedOrEnforcedProfile)}.`,
  );
}
