import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type AgentHarness,
  buildTrajectoryDiagnosticsArtifact,
  type HarnessCapabilitySnapshot,
  type KotaAgentMessage,
  TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME,
  type TrajectoryDiagnosticsMetadata,
  trajectoryDiagnosticsMetadata,
} from "#core/agent-harness/index.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";

type AgentTrajectoryDiagnosticsCapability = Pick<
  HarnessCapabilitySnapshot,
  "emitsAgentMessageStream"
>;

type PersistedTrajectoryDiagnosticsCapability = {
  emitsAgentMessageStream?: boolean;
};

export function readAgentTrajectoryDiagnosticsCapabilityArtifact(args: {
  stepId: string;
  runDir: string;
  projectDir: string;
}): AgentTrajectoryDiagnosticsCapability | null {
  const filePath = resolve(
    args.projectDir,
    args.runDir,
    "steps",
    `${args.stepId}.harness-capability.json`,
  );
  const artifact =
    readOptionalJsonFile<PersistedTrajectoryDiagnosticsCapability>(filePath);
  if (typeof artifact?.emitsAgentMessageStream !== "boolean") return null;
  return { emitsAgentMessageStream: artifact.emitsAgentMessageStream };
}

export function writeAgentTrajectoryDiagnosticsArtifact(args: {
  stepId: string;
  runDir: string;
  projectDir: string;
  harness: AgentHarness;
  messages: readonly KotaAgentMessage[];
  changedFiles: readonly string[];
}): TrajectoryDiagnosticsMetadata {
  return writeAgentTrajectoryDiagnosticsArtifactFromCapability({
    stepId: args.stepId,
    runDir: args.runDir,
    projectDir: args.projectDir,
    capability: {
      emitsAgentMessageStream: args.harness.emitsAgentMessageStream,
    },
    messages: args.messages,
    changedFiles: args.changedFiles,
  });
}

export function writeAgentTrajectoryDiagnosticsArtifactFromCapability(args: {
  stepId: string;
  runDir: string;
  projectDir: string;
  capability: AgentTrajectoryDiagnosticsCapability;
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
    capability: args.capability,
    messages: args.messages,
    changedFiles: args.changedFiles,
  });
  writeFileSync(filePath, JSON.stringify(artifact, null, 2), "utf-8");
  return trajectoryDiagnosticsMetadata(artifact, relativeArtifactPath);
}
