import {
  DEFAULT_SUPERVISION_LOAD_THRESHOLDS,
  type SupervisionLoadCounts,
  type SupervisionLoadEvidence,
  type SupervisionLoadScore,
} from "./supervision-load-types.js";

export function scoreSupervisionLoad(
  counts: SupervisionLoadCounts,
  evidence: readonly SupervisionLoadEvidence[],
): SupervisionLoadScore {
  let knownScore = 0;
  for (const key of Object.keys(
    DEFAULT_SUPERVISION_LOAD_THRESHOLDS.weights,
  ) as (keyof SupervisionLoadCounts)[]) {
    const count = counts[key];
    if (count === null) continue;
    knownScore += count * DEFAULT_SUPERVISION_LOAD_THRESHOLDS.weights[key];
  }

  const unknownEvidenceCount = evidence.filter(
    (item) => item.status !== "available",
  ).length;
  if (unknownEvidenceCount > 0) {
    return {
      status: "unknown",
      score: null,
      knownScore,
      unknownEvidenceCount,
    };
  }

  if (knownScore >= DEFAULT_SUPERVISION_LOAD_THRESHOLDS.overloadedAt) {
    return {
      status: "overloaded",
      score: knownScore,
      knownScore,
      unknownEvidenceCount,
    };
  }
  if (knownScore >= DEFAULT_SUPERVISION_LOAD_THRESHOLDS.busyAt) {
    return {
      status: "busy",
      score: knownScore,
      knownScore,
      unknownEvidenceCount,
    };
  }
  return {
    status: "normal",
    score: knownScore,
    knownScore,
    unknownEvidenceCount,
  };
}
