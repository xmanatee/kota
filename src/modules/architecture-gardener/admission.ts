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
  relevantObservationIds?: readonly string[];
  followUpFingerprints: readonly string[];
  reviewedTaskEvidence: readonly string[];
}): AdmissionEvaluation {
  const structural = input.observations.filter((observation) =>
    observation.category === "dependency-boundary" || observation.category === "canonical-ownership" ||
    observation.kind === "duplicated-implementation-chunk");
  const selected = new Set(input.relevantObservationIds ?? []);
  const cohort = combineFingerprints([
    ...structural.filter((observation) => !selected.has(observation.id)).map((observation) => observation.fingerprint),
    ...[...selected].map((id) =>
      input.observations.find((observation) => observation.id === id)?.fingerprint ?? `absent:${id}`),
    ...input.followUpFingerprints,
  ]);
  const friction = input.observations.some((o) => o.category === "delivery");
  const newTaskEvidence = input.followUpFingerprints.some((fingerprint) => !input.reviewedTaskEvidence.includes(fingerprint));
  const changedSettledEvidence = input.previousCohort !== undefined && cohort !== input.previousCohort;
  const reason = cohort === input.previousCohort
    ? "This evidence cohort has already been investigated."
    : input.explicitRequest
      ? "Explicit request for investigation; no improvement is verified."
      : newTaskEvidence
        ? "Linked implementation has settled; inspect its actual outcome."
        : changedSettledEvidence || (structural.length > 0 && friction)
          ? "Structural evidence or delivery evidence selected by the settled judgment changed."
          : "Automatic investigation needs structural evidence and delivery friction; metrics alone are diagnostic.";
  return {
    targetScope: input.targetScope,
    cohort,
    admitted: cohort !== input.previousCohort &&
      (input.explicitRequest || changedSettledEvidence || (structural.length > 0 && friction) || newTaskEvidence),
    reason,
  };
}
