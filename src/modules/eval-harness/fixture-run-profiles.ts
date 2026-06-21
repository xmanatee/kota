import type {
  ExecutionProfileNonGatingReason,
  ExecutionProfilePreflightResult,
  ExecutionProfileRejectionReason,
  ResourceProfile,
} from "./fixture-run.js";

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
