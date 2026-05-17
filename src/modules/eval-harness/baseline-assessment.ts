/**
 * Glue between `evaluateRegressionGate` and the persistent baseline store.
 *
 * The cadence workflow hands this function the prior persisted baseline and
 * the fresh candidate aggregate; the function returns a typed decision the
 * caller uses to: (a) decide whether to emit the regression event, and
 * (b) decide whether to roll the baseline forward. Keeping the decision
 * pure makes the cadence workflow's side-effectful glue trivially testable.
 */

import type { PersistedBaseline } from "./baseline-store.js";
import type {
  ExecutionProfileNonGatingReason,
  ExecutionProfilePreflightResult,
  ExecutionProfileRejectionReason,
  ResourceProfile,
} from "./fixture-run.js";
import { resourceProfileFromExecutionProfile } from "./fixture-run.js";
import {
  DEFAULT_NOISE_BAND_PP,
  evaluateRegressionGate,
  type RegressionGateDecision,
} from "./noise-band.js";
import type { AggregateScore } from "./scoring.js";

export type CandidateAssessment = {
  aggregate: AggregateScore;
  executionProfile: ExecutionProfilePreflightResult;
  runArtifactBaseDir: string;
  /** ISO timestamp of the cadence run that produced the candidate. */
  recordedAt: string;
  /** Optional override of the default noise band. */
  noiseBandPercentagePoints?: number;
};

export type BaselineAssessment =
  | {
      status: "non-gating";
      reason: ExecutionProfileNonGatingReason | ExecutionProfileRejectionReason;
      resourceProfile: ResourceProfile;
      runArtifactBaseDir: string;
      recordedAt: string;
    }
  | {
      status: "first-run";
      /** The caller MUST persist this baseline so the next cadence has a comparison point. */
      baselineToRecord: PersistedBaseline;
    }
  | {
      status: "not-gated";
      reason: Extract<RegressionGateDecision, { status: "not-gated" }>["reason"];
      dropPercentagePoints: number;
      /**
       * Candidate accepted: the caller MUST persist this as the new baseline
       * so regressions are measured from the most recent accepted result.
       */
      baselineToRecord: PersistedBaseline;
      noiseBandPercentagePoints: number;
    }
  | {
      status: "gated";
      reason: string;
      dropPercentagePoints: number;
      /**
       * Prior baseline the gate judged against. The caller MUST NOT overwrite
       * the stored baseline on `gated` — the previous baseline stays the next
       * comparison point until the regression is acknowledged.
       */
      priorBaseline: PersistedBaseline;
      noiseBandPercentagePoints: number;
    };

export function assessAgainstBaseline(
  prior: PersistedBaseline | null,
  candidate: CandidateAssessment,
): BaselineAssessment {
  const candidateResourceProfile = resourceProfileFromExecutionProfile(
    candidate.executionProfile,
  );
  if (!candidate.executionProfile.gateEligible) {
    const reason =
      candidate.executionProfile.status === "rejected"
        ? candidate.executionProfile.rejectionReason
        : candidate.executionProfile.nonGatingReason;
    return {
      status: "non-gating",
      reason,
      resourceProfile: candidateResourceProfile,
      runArtifactBaseDir: candidate.runArtifactBaseDir,
      recordedAt: candidate.recordedAt,
    };
  }

  const candidateBaseline: PersistedBaseline = {
    aggregate: candidate.aggregate,
    resourceProfile: candidateResourceProfile,
    recordedAt: candidate.recordedAt,
    runArtifactBaseDir: candidate.runArtifactBaseDir,
  };

  if (prior === null) {
    return { status: "first-run", baselineToRecord: candidateBaseline };
  }

  const noiseBandPercentagePoints =
    candidate.noiseBandPercentagePoints ?? DEFAULT_NOISE_BAND_PP;

  const decision = evaluateRegressionGate({
    baseline: prior.aggregate,
    candidate: candidate.aggregate,
    baselineResourceProfile: prior.resourceProfile,
    candidateResourceProfile,
    noiseBandPercentagePoints,
  });

  if (decision.status === "gated") {
    return {
      status: "gated",
      reason: decision.reason,
      dropPercentagePoints: decision.dropPercentagePoints,
      priorBaseline: prior,
      noiseBandPercentagePoints,
    };
  }

  return {
    status: "not-gated",
    reason: decision.reason,
    dropPercentagePoints: decision.dropPercentagePoints,
    baselineToRecord: candidateBaseline,
    noiseBandPercentagePoints,
  };
}
