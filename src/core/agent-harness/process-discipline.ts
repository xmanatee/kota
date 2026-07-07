import { aggregateDimensions } from "./process-discipline-aggregate.js";
import { buildDimensionRecord } from "./process-discipline-dimensions.js";
import {
  PROCESS_DISCIPLINE_DIMENSIONS,
  PROCESS_DISCIPLINE_RUBRIC_VERSION,
  type ProcessDisciplineAbstentionEvidence,
  type ProcessDisciplineAggregate,
  type ProcessDisciplineDimension,
  type ProcessDisciplineDimensionRecord,
  type ProcessDisciplineDimensionStatus,
  type ProcessDisciplineEvidence,
  type ProcessDisciplineGrade,
  type ProcessDisciplineRecord,
  type ProcessDisciplineSourceKind,
  type ProcessDisciplineSourceRef,
} from "./process-discipline-types.js";
import type {
  TrajectoryDiagnosticsProjectionArtifact,
} from "./trajectory-diagnostics-projection.js";

export type {
  ProcessDisciplineAbstentionEvidence,
  ProcessDisciplineAggregate,
  ProcessDisciplineDimension,
  ProcessDisciplineDimensionRecord,
  ProcessDisciplineDimensionStatus,
  ProcessDisciplineEvidence,
  ProcessDisciplineGrade,
  ProcessDisciplineRecord,
  ProcessDisciplineSourceKind,
  ProcessDisciplineSourceRef,
};
export {
  PROCESS_DISCIPLINE_DIMENSIONS,
  PROCESS_DISCIPLINE_RUBRIC_VERSION,
};

export function buildProcessDisciplineRecord(args: {
  diagnostics: TrajectoryDiagnosticsProjectionArtifact;
  source: ProcessDisciplineSourceRef;
  abstention?: ProcessDisciplineAbstentionEvidence;
}): ProcessDisciplineRecord {
  const dimensions = PROCESS_DISCIPLINE_DIMENSIONS.map((dimension) =>
    buildDimensionRecord(dimension, args.diagnostics, args.abstention),
  );
  return {
    version: 1,
    rubricVersion: PROCESS_DISCIPLINE_RUBRIC_VERSION,
    source: args.source,
    aggregate: aggregateDimensions(dimensions),
    dimensions,
  };
}
