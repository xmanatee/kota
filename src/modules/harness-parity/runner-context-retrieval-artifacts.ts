import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  HarnessCapabilitySnapshot,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";
import {
  buildContextRetrievalDiagnosticsArtifact,
  CONTEXT_RETRIEVAL_DIAGNOSTICS_ARTIFACT_NAME,
  type ContextRetrievalDiagnosticsMetadata,
  contextRetrievalDiagnosticsMetadata,
} from "./context-retrieval-diagnostics.js";
import type { HarnessParityArtifact } from "./runner-types.js";
import type { ScenarioStageSpec } from "./scenario.js";

export function writeContextRetrievalDiagnosticsArtifact(args: {
  artifactDir: string;
  capability: HarnessCapabilitySnapshot;
  messages: readonly KotaAgentMessage[];
  stage: ScenarioStageSpec;
}): ContextRetrievalDiagnosticsMetadata | undefined {
  if (args.stage.contextRetrieval === undefined) return undefined;
  const artifactPath = join(
    args.artifactDir,
    CONTEXT_RETRIEVAL_DIAGNOSTICS_ARTIFACT_NAME,
  );
  const artifact = buildContextRetrievalDiagnosticsArtifact({
    capability: args.capability,
    messages: args.messages,
    expectation: args.stage.contextRetrieval,
  });
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return contextRetrievalDiagnosticsMetadata(artifact, artifactPath);
}

export function writeStagedContextRetrievalDiagnosticsArtifact(
  artifact: HarnessParityArtifact,
): void {
  if (artifact.contextRetrievalDiagnostics === undefined) return;
  writeFileSync(
    join(artifact.artifactDir, CONTEXT_RETRIEVAL_DIAGNOSTICS_ARTIFACT_NAME),
    JSON.stringify(
      {
        version: 1,
        status: "staged",
        counts: {
          expectedTargetCount:
            artifact.contextRetrievalDiagnostics.expectedTargetCount,
          reachedTargetCount:
            artifact.contextRetrievalDiagnostics.reachedTargetCount,
          missedTargetCount:
            artifact.contextRetrievalDiagnostics.missedTargetCount,
          retrievalActionCount:
            artifact.contextRetrievalDiagnostics.retrievalActionCount,
          relevantRetrievalActionCount:
            artifact.contextRetrievalDiagnostics.relevantRetrievalActionCount,
          preEditRelevantRetrievalActionCount:
            artifact.contextRetrievalDiagnostics
              .preEditRelevantRetrievalActionCount,
          lateRelevantRetrievalActionCount:
            artifact.contextRetrievalDiagnostics
              .lateRelevantRetrievalActionCount,
          noisyIrrelevantReadCount:
            artifact.contextRetrievalDiagnostics.noisyIrrelevantReadCount,
          unsupportedTrajectoryFrameCount:
            artifact.contextRetrievalDiagnostics.unsupportedTrajectoryFrameCount,
          warningCount: artifact.contextRetrievalDiagnostics.warningCount,
        },
        stages: artifact.stages
          .filter((stage) => stage.contextRetrievalDiagnostics !== undefined)
          .map((stage) => ({
            stageId: stage.stageId,
            diagnostics: stage.contextRetrievalDiagnostics,
          })),
      },
      null,
      2,
    ),
  );
}
