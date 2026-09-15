import type { GardenerDecision } from "./decision.js";
import { combineFingerprints } from "./fingerprint.js";
import type { ArchitectureObservation, GardenerAssessment, SettledGardenerReview } from "./types.js";

export type AdmissionEvaluation = {
  targetScope: string;
  admitted: boolean;
  reason: string;
  cohort: string;
  structuralCohort: string;
  unreviewedObservationFingerprints: string[];
};

export function relevantDeliveryCohort(
  observations: readonly ArchitectureObservation[],
  issueKeys: readonly string[],
): string {
  return combineFingerprints(observations.filter((o) =>
    o.category === "delivery" && issueKeys.includes(o.id)).map((o) => o.fingerprint));
}

function reviewAssessments(review: SettledGardenerReview | undefined): readonly GardenerAssessment[] {
  return review?.assessments ?? (review ? [{
    observationFingerprints: [], evidenceRefs: review.decision.evidenceRefs,
    revisit: review.decision.revisit, deliveryCohort: review.deliveryCohort,
  }] : []);
}

function isStructuralObservation(observation: ArchitectureObservation): boolean {
  return observation.category === "dependency-boundary" || observation.category === "canonical-ownership" ||
    observation.kind === "duplicated-implementation-chunk";
}

export function settleGardenerAssessments(
  previous: SettledGardenerReview | undefined,
  observations: readonly ArchitectureObservation[],
  decision: GardenerDecision,
): GardenerAssessment[] {
  const available = new Set(observations.filter(isStructuralObservation).map((observation) => observation.fingerprint));
  const assessed = decision.evidenceRefs.filter((ref) => available.has(ref));
  const retained = reviewAssessments(previous).flatMap((assessment) => {
    const fingerprints = previous?.assessments === undefined
      ? assessment.evidenceRefs.filter((ref) => available.has(ref)) : assessment.observationFingerprints;
    if (fingerprints.length === 0) {
      // Older/source-only judgments have no observation identity. Only a review
      // citing their evidence can replace them; unrelated work keeps their baseline.
      return assessment.evidenceRefs.some((ref) => decision.evidenceRefs.includes(ref)) ? [] : [assessment];
    }
    // Absence is changed evidence, not a disposition. A review may cite the old
    // fingerprint to settle a removed or replaced observation after inspecting it.
    const remaining = fingerprints.filter((fingerprint) => !decision.evidenceRefs.includes(fingerprint));
    return remaining.length > 0 ? [{ ...assessment, observationFingerprints: remaining }] : [];
  });
  return [...retained, { observationFingerprints: assessed, evidenceRefs: decision.evidenceRefs,
    revisit: decision.revisit, deliveryCohort: relevantDeliveryCohort(observations, decision.revisit.deliveryIssueKeys) }];
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
  repositoryFingerprint?: string | null;
}): AdmissionEvaluation {
  const structuralObservations = input.observations.filter(isStructuralObservation);
  const structuralCohort = combineFingerprints(structuralObservations.map((o) => o.fingerprint));
  const previous = input.previousReview;
  const assessments = reviewAssessments(previous);
  const deliveryCohort = relevantDeliveryCohort(input.observations, assessments.flatMap((assessment) => assessment.revisit.deliveryIssueKeys));
  const assessed = previous?.assessments?.flatMap((assessment) => assessment.observationFingerprints) ?? previous?.decision.evidenceRefs ?? [];
  const unreviewedObservationFingerprints = structuralObservations
    .filter((observation) => !assessed.includes(observation.fingerprint)).map((observation) => observation.fingerprint);
  const unreviewedIdleEvidence = input.idle && unreviewedObservationFingerprints.length > 0;
  const currentStructural = new Set(structuralObservations.map((observation) => observation.fingerprint));
  const changedStructure = previous?.structuralCohort !== structuralCohort || assessments.some((assessment) =>
    assessment.observationFingerprints.some((fingerprint) => !currentStructural.has(fingerprint)));
  const changedRelevantDelivery = assessments.some((assessment) =>
    assessment.deliveryCohort !== relevantDeliveryCohort(input.observations, assessment.revisit.deliveryIssueKeys));
  const newTaskEvidence = input.followUpFingerprints.some((fingerprint) => !input.reviewedTaskEvidence.includes(fingerprint));
  const newRequest = input.explicitRequest && (!previous ||
    (input.requestFingerprint !== null && input.requestFingerprint !== previous.requestFingerprint));
  const idleSourceChange = input.idle && input.repositoryFingerprint != null &&
    input.repositoryFingerprint !== previous?.repositoryFingerprint;
  const automatic = previous
    ? changedStructure || changedRelevantDelivery
    : structuralObservations.length > 0 && (input.idle || input.observations.some((o) => o.category === "delivery"));
  const admitted = newRequest || newTaskEvidence || unreviewedIdleEvidence || idleSourceChange || automatic;
  return {
    targetScope: input.targetScope,
    structuralCohort,
    unreviewedObservationFingerprints,
    cohort: combineFingerprints([structuralCohort, deliveryCohort, ...input.followUpFingerprints]),
    admitted,
    reason: newRequest
      ? "Explicit justified request for investigation; no improvement is verified."
      : newTaskEvidence
        ? "Linked implementation has settled; inspect its actual outcome and any deferred proposal."
        : unreviewedIdleEvidence
          ? "Idle capacity permits investigation of unreviewed structural evidence; no improvement is verified."
          : idleSourceChange
            ? "Source changed since the last maintenance investigation; use idle capacity to inspect architecture beyond scanner findings."
          : admitted
            ? "Structural evidence or the settled judgment's relevant delivery evidence changed."
            : previous
              ? unreviewedObservationFingerprints.length > 0
                ? "Unreviewed structural opportunities remain; investigation awaits idle capacity or changed relevant evidence."
                : "Known opportunities are settled for this source and evidence; prior assessments retain their individual revisit conditions."
              : "Automatic investigation needs structural evidence and either idle capacity or delivery friction; metrics alone are diagnostic.",
  };
}
