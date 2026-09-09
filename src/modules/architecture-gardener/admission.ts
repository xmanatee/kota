import { combineFingerprints } from "./fingerprint.js";
import type { ArchitectureObservation } from "./types.js";

export type AdmissionEvaluation = {
  targetScope: string;
  admitted: boolean;
  reason: string;
  cohort: string;
};

export function evaluateAdmission(input: {
  targetScope: string;
  observations: readonly ArchitectureObservation[];
  explicitRequest: boolean;
  previousCohort: string | undefined;
  followUpFingerprints: readonly string[];
  reviewedTaskEvidence: readonly string[];
}): AdmissionEvaluation {
  const cohort = combineFingerprints([
    ...input.observations.map((observation) => observation.fingerprint),
    ...input.followUpFingerprints,
  ]);
  const structural = input.observations.some((o) =>
    o.category === "dependency-boundary" || o.category === "canonical-ownership" || o.kind === "duplicated-implementation-chunk");
  const friction = input.observations.some((o) => o.category === "delivery");
  const newTaskEvidence = input.followUpFingerprints.some((fingerprint) => !input.reviewedTaskEvidence.includes(fingerprint));
  const reason = cohort === input.previousCohort
    ? "This evidence cohort has already been investigated."
    : input.explicitRequest
      ? "Explicit request for investigation; no improvement is verified."
      : newTaskEvidence
        ? "Linked implementation has settled; inspect its actual outcome."
        : structural && friction
          ? "Changed structural and delivery-friction evidence warrants investigation of possible shared causes."
          : "Automatic investigation needs structural evidence and delivery friction; metrics alone are diagnostic.";
  return {
    targetScope: input.targetScope,
    cohort,
    admitted: cohort !== input.previousCohort &&
      (input.explicitRequest || (structural && friction) || newTaskEvidence),
    reason,
  };
}
