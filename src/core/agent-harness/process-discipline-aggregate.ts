import type {
  ProcessDisciplineAggregate,
  ProcessDisciplineDimensionRecord,
  ProcessDisciplineGrade,
} from "./process-discipline-types.js";

export function aggregateDimensions(
  dimensions: readonly ProcessDisciplineDimensionRecord[],
): ProcessDisciplineAggregate {
  const supported = dimensions.filter((dimension) => dimension.status === "supported");
  const possible = supported.reduce((sum, dimension) => sum + dimension.maxScore, 0);
  const earned = supported.reduce((sum, dimension) => sum + (dimension.score ?? 0), 0);
  const score = possible > 0 ? Math.round((earned / possible) * 100) : null;
  const missingEvidenceDimensions = dimensions.filter(
    (dimension) => dimension.status === "missing-evidence",
  ).length;
  const unsupportedDimensions = dimensions.filter(
    (dimension) => dimension.status === "unsupported",
  ).length;
  return {
    score,
    maxScore: 100,
    grade: gradeFor(score, missingEvidenceDimensions, unsupportedDimensions),
    supportedDimensions: supported.length,
    missingEvidenceDimensions,
    unsupportedDimensions,
  };
}

function gradeFor(
  score: number | null,
  missingEvidenceDimensions: number,
  unsupportedDimensions: number,
): ProcessDisciplineGrade {
  if (score === null) return "unsupported";
  if (score >= 90 && missingEvidenceDimensions === 0 && unsupportedDimensions === 0) {
    return "excellent";
  }
  if (score >= 80) return "good";
  if (score >= 60) return "caution";
  return "weak";
}
