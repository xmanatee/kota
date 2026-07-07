import type {
  TrajectoryDiagnosticsArtifact,
  TrajectoryDiagnosticsCounts,
  TrajectoryDiagnosticsMetadata,
} from "./trajectory-diagnostics.js";

export type StagedTrajectoryDiagnosticsArtifact = {
  version: 1;
  status: "staged";
  counts: TrajectoryDiagnosticsCounts;
  stages: readonly {
    stageId: string;
    diagnostics: TrajectoryDiagnosticsMetadata;
  }[];
};

export type TrajectoryDiagnosticsProjectionArtifact =
  | TrajectoryDiagnosticsArtifact
  | StagedTrajectoryDiagnosticsArtifact;
