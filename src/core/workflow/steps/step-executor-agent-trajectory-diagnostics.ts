import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type AgentHarness,
  buildTrajectoryDiagnosticsArtifact,
  type KotaAgentMessage,
  TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME,
  type TrajectoryDiagnosticsMetadata,
  trajectoryDiagnosticsMetadata,
} from "#core/agent-harness/index.js";

export function writeAgentTrajectoryDiagnosticsArtifact(args: {
  stepId: string;
  runDir: string;
  projectDir: string;
  harness: AgentHarness;
  messages: readonly KotaAgentMessage[];
  changedFiles: readonly string[];
}): TrajectoryDiagnosticsMetadata {
  const relativeArtifactPath = join(
    args.runDir,
    "steps",
    `${args.stepId}.${TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME}`,
  );
  const filePath = resolve(args.projectDir, relativeArtifactPath);
  mkdirSync(dirname(filePath), { recursive: true });
  const artifact = buildTrajectoryDiagnosticsArtifact({
    capability: {
      emitsAgentMessageStream: args.harness.emitsAgentMessageStream,
    },
    messages: args.messages,
    changedFiles: args.changedFiles,
  });
  writeFileSync(filePath, JSON.stringify(artifact, null, 2), "utf-8");
  return trajectoryDiagnosticsMetadata(artifact, relativeArtifactPath);
}
