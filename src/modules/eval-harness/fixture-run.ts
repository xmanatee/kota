/**
 * Fixture-run contract for the autonomy eval harness.
 *
 * Every harness fixture produces one or more FixtureRun records. The shape is
 * deliberately opinionated: every run records its resource profile, its index
 * within the repeat set, and a timing envelope so that later scoring can
 * distinguish real regressions from host drift.
 */

import type { CodeHealthDiagnostics } from "./code-health-diagnostics.js";
import type {
  ObjectiveMetricObservationError,
  ObservedObjectiveMetric,
} from "./objective-metrics.js";
import type { ExecutionNetworkPolicy } from "./provider-egress.js";

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
  | "isolation-backend-config-invalid"
  | "provider-egress-enforcement-unavailable"
  | "provider-egress-policy-invalid"
  | "provider-egress-task-boundary-unverified";

export type ExecutionProfileRejectionReason = "requested-observed-mismatch";

export type ExecutionProfilePreflightResult =
  | {
      status: "verified";
      backendKind: Exclude<ExecutionBackendKind, "missing-isolation-backend">;
      requestedProfile: ResourceProfile;
      observedOrEnforcedProfile: ResourceProfile;
      verification: Exclude<ExecutionProfileVerification, "unverified">;
      networkPolicy: ExecutionNetworkPolicy;
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
      networkPolicy: ExecutionNetworkPolicy;
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
      networkPolicy: ExecutionNetworkPolicy;
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

export type FixtureRunExecutionMode = "live";

export type FixtureRunConfigurationError = {
  reason: "pre-run-sanity-failed" | "verifier-calibration-failed";
  detail: string;
};

export type FixtureRoundRun = {
  roundId: string;
  /** 0-based index within the fixture's ordered round list. */
  roundIndex: number;
  workflowName: string;
  outcome: FixtureRunOutcome;
  objectiveMetrics: readonly ObservedObjectiveMetric[];
  objectiveMetricErrors: readonly ObjectiveMetricObservationError[];
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
  /** Capability measurements always use live model calls. */
  executionMode: FixtureRunExecutionMode;
  outcome: FixtureRunOutcome;
  resourceProfile: ResourceProfile;
  executionProfile: ExecutionProfilePreflightResult;
  /**
   * Deterministic numeric objective evidence observed for this run. Empty
   * when the fixture declares no objective metrics.
   */
  objectiveMetrics: readonly ObservedObjectiveMetric[];
  /**
   * Metric extraction failures retained after a non-passing capability
   * outcome. Passing runs reject these errors before producing a run record.
   */
  objectiveMetricErrors: readonly ObjectiveMetricObservationError[];
  /**
   * Optional deterministic source-tree diagnostics for fixtures that
   * explicitly opt in. Advisory only; pass/fail scoring remains predicate
   * based.
   */
  codeHealthDiagnostics?: CodeHealthDiagnostics;
  /**
   * Present only for persistent multi-round fixtures. The top-level fixture
   * remains one scored run; round records preserve diagnostic outcomes.
   */
  rounds?: readonly FixtureRoundRun[];
  /**
   * Present when outcome is configuration-error and the runner can name the
   * fixture-owned configuration failure directly.
   */
  configurationError?: FixtureRunConfigurationError;
  timing: TimingEnvelope;
  /** Absolute path to the run artifact directory under `.kota/runs/`. */
  runArtifactPath: string;
};

export {
  assertExecutionProfileCanScore,
  executionProfileGateReason,
  resourceProfileFromExecutionProfile,
  resourceProfilesComparable,
} from "./fixture-run-profiles.js";
