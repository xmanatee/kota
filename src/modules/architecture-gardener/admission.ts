import { combineFingerprints } from "./fingerprint.js";
import type { ArchitectureObservation, SettledGardenerReview } from "./types.js";

export type AdmissionEvaluation = {
  targetScope: string;
  admitted: boolean;
  reason: string;
  cohort: string;
  structuralCohort: string;
};

export function relevantDeliveryCohort(
  observations: readonly ArchitectureObservation[],
  issueKeys: readonly string[],
): string {
  return combineFingerprints(observations.filter((o) =>
    o.category === "delivery" && issueKeys.includes(o.id)).map((o) => o.fingerprint));
}

export function evaluateAdmission(input: {
  targetScope: string;
  observations: readonly ArchitectureObservation[];
  idle: boolean;
  explicitRequest: boolean;
  requestFingerprint: string | null;
  previousReview: SettledGardenerReview | undefined;
  followUpFingerprints: readonly string[];
  reviewedTaskEvidence: readonly string[];
}): AdmissionEvaluation {
  const structuralObservations = input.observations.filter((o) =>
    o.category === "dependency-boundary" || o.category === "canonical-ownership" || o.kind === "duplicated-implementation-chunk");
  const structuralCohort = combineFingerprints(structuralObservations.map((o) => o.fingerprint));
  const previous = input.previousReview;
  const deliveryCohort = relevantDeliveryCohort(input.observations, previous?.decision.revisit.deliveryIssueKeys ?? []);
  const changedStructure = previous?.structuralCohort !== structuralCohort;
  const changedRelevantDelivery = previous !== undefined && previous.deliveryCohort !== deliveryCohort;
  const newTaskEvidence = input.followUpFingerprints.some((fingerprint) => !input.reviewedTaskEvidence.includes(fingerprint));
  const newRequest = input.explicitRequest && (!previous ||
    (input.requestFingerprint !== null && input.requestFingerprint !== previous.requestFingerprint));
  const automatic = previous
    ? changedStructure || changedRelevantDelivery
    : structuralObservations.length > 0 && (input.idle || input.observations.some((o) => o.category === "delivery"));
  const admitted = newRequest || newTaskEvidence || automatic;
  return {
    targetScope: input.targetScope,
    structuralCohort,
    cohort: combineFingerprints([structuralCohort, deliveryCohort, ...input.followUpFingerprints]),
    admitted,
    reason: newRequest
      ? "Explicit justified request for investigation; no improvement is verified."
      : newTaskEvidence
        ? "Linked implementation has settled; inspect its actual outcome and any deferred proposal."
        : admitted && !previous && input.idle
          ? "Idle capacity permits investigation of unreviewed structural evidence; no improvement is verified."
          : admitted
            ? "Structural evidence or the settled judgment's relevant delivery evidence changed."
            : previous
              ? `Settled judgment remains current. Revisit: ${previous.decision.revisit.reason}`
              : "Automatic investigation needs structural evidence and either idle capacity or delivery friction; metrics alone are diagnostic.",
  };
}
