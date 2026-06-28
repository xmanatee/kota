import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  HarnessCapabilitySnapshot,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";
import {
  TRAJECTORY_ARTIFACT_NAME,
  TRAJECTORY_SUMMARY_NAME,
} from "./runner-constants.js";
import {
  buildTrajectoryFrames,
  countTrajectoryFrames,
  emptyTrajectoryCounts,
} from "./runner-trajectory-sanitize.js";
import type {
  HarnessParityArtifact,
  HarnessParityTrajectoryCounts,
  HarnessParityTrajectoryFrame,
  HarnessParityTrajectoryMetadata,
} from "./runner-types.js";
import type { ScenarioVerification } from "./scenario.js";
import {
  buildTrajectoryDiagnosticsArtifact,
  type HarnessParityTrajectoryDiagnosticsMetadata,
  TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME,
  trajectoryDiagnosticsMetadata,
} from "./trajectory-diagnostics.js";

type SupportedTrajectoryArtifact = {
  version: 1;
  status: "supported";
  emitsAgentMessageStream: true;
  frames: HarnessParityTrajectoryFrame[];
  counts: HarnessParityTrajectoryCounts;
};

type UnsupportedTrajectoryArtifact = {
  version: 1;
  status: "unsupported";
  emitsAgentMessageStream: false;
  reason: string;
  frames: [];
  counts: HarnessParityTrajectoryCounts;
};

type TrajectoryArtifact =
  | SupportedTrajectoryArtifact
  | UnsupportedTrajectoryArtifact;

function buildSupportedTrajectoryArtifact(
  frames: readonly HarnessParityTrajectoryFrame[],
): SupportedTrajectoryArtifact {
  return {
    version: 1,
    status: "supported",
    emitsAgentMessageStream: true,
    frames: [...frames],
    counts: countTrajectoryFrames(frames),
  };
}

function buildUnsupportedTrajectoryArtifact(reason: string): UnsupportedTrajectoryArtifact {
  return {
    version: 1,
    status: "unsupported",
    emitsAgentMessageStream: false,
    reason,
    frames: [],
    counts: emptyTrajectoryCounts(),
  };
}

export function writeTrajectoryArtifacts(args: {
  artifactDir: string;
  capability: HarnessCapabilitySnapshot;
  messages: readonly KotaAgentMessage[];
  changedFiles: readonly string[];
  verification: ScenarioVerification;
}): {
  trajectory: HarnessParityTrajectoryMetadata;
  trajectoryDiagnostics: HarnessParityTrajectoryDiagnosticsMetadata;
} {
  const artifactPath = join(args.artifactDir, TRAJECTORY_ARTIFACT_NAME);
  const summaryPath = join(args.artifactDir, TRAJECTORY_SUMMARY_NAME);
  const diagnosticsPath = join(
    args.artifactDir,
    TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME,
  );
  const diagnosticsArtifact = buildTrajectoryDiagnosticsArtifact({
    capability: args.capability,
    messages: args.messages,
    changedFiles: args.changedFiles,
    verificationCommand: args.verification.command,
    verificationCommandDetailLabel: "scenarioVerification",
  });
  writeFileSync(diagnosticsPath, JSON.stringify(diagnosticsArtifact, null, 2));
  const trajectoryDiagnostics = trajectoryDiagnosticsMetadata(
    diagnosticsArtifact,
    diagnosticsPath,
  );

  if (!args.capability.emitsAgentMessageStream) {
    const reason =
      "Harness capability snapshot declares emitsAgentMessageStream=false.";
    const artifact = buildUnsupportedTrajectoryArtifact(reason);
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    writeFileSync(
      summaryPath,
      buildTrajectorySummary(artifact, trajectoryDiagnostics),
    );
    return {
      trajectory: {
        status: "unsupported",
        emitsAgentMessageStream: false,
        artifactPath,
        summaryPath,
        reason,
        ...artifact.counts,
      },
      trajectoryDiagnostics,
    };
  }

  const artifact = buildSupportedTrajectoryArtifact(
    buildTrajectoryFrames(args.messages),
  );
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  writeFileSync(
    summaryPath,
    buildTrajectorySummary(artifact, trajectoryDiagnostics),
  );
  return {
    trajectory: {
      status: "supported",
      emitsAgentMessageStream: true,
      artifactPath,
      summaryPath,
      ...artifact.counts,
    },
    trajectoryDiagnostics,
  };
}

function buildTrajectorySummary(
  artifact: TrajectoryArtifact,
  diagnostics: HarnessParityTrajectoryDiagnosticsMetadata,
): string {
  const lines: string[] = [];
  lines.push("# Trajectory");
  lines.push("");
  lines.push(`- status: ${artifact.status}`);
  lines.push(
    `- emitsAgentMessageStream: ${artifact.emitsAgentMessageStream}`,
  );
  if (artifact.status === "unsupported") {
    lines.push(`- reason: ${artifact.reason}`);
  }
  lines.push(`- frames: ${artifact.counts.frameCount}`);
  lines.push(`- toolCalls: ${artifact.counts.toolCallCount}`);
  lines.push(`- toolResults: ${artifact.counts.toolResultCount}`);
  lines.push(`- statusFrames: ${artifact.counts.statusCount}`);
  lines.push(`- resultFrames: ${artifact.counts.resultCount}`);
  lines.push(`- truncatedFrames: ${artifact.counts.truncatedFrameCount}`);
  renderTrajectoryDiagnosticsSummary(lines, diagnostics);
  if (artifact.status === "unsupported") return `${lines.join("\n")}\n`;

  lines.push("");
  lines.push("## Sequence");
  lines.push("");
  if (artifact.frames.length === 0) {
    lines.push("- no frames captured");
    return `${lines.join("\n")}\n`;
  }

  for (const frame of artifact.frames) {
    lines.push(`- ${formatTrajectoryFrame(frame)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderTrajectoryDiagnosticsSummary(
  lines: string[],
  diagnostics: HarnessParityTrajectoryDiagnosticsMetadata,
): void {
  lines.push(`- diagnosticWarnings: ${diagnostics.warningCount}`);
  lines.push(`- diagnosticsArtifact: ${diagnostics.artifactPath}`);
  lines.push(
    `- diagnosticCounts: unsupported=${diagnostics.unsupportedTrajectoryCount}, missingFrames=${diagnostics.missingStreamingFramesCount}, missingFinalVerification=${diagnostics.missingFinalVerificationAfterEditCount}, repeatedFailingCommand=${diagnostics.repeatedIdenticalFailingCommandCount}, editAfterPass=${diagnostics.editAfterSuccessfulVerificationCount}, longPreamble=${diagnostics.longPreambleWithoutTaskTouchCount}`,
  );
}

function formatTrajectoryFrame(frame: HarnessParityTrajectoryFrame): string {
  const truncated =
    frame.truncatedFields.length > 0
      ? ` truncated=${frame.truncatedFields.join(",")}`
      : "";
  if (frame.message.type === "tool_call") {
    return `${frame.index}. tool_call ${frame.message.toolName} (${frame.message.toolUseId})${truncated}`;
  }
  if (frame.message.type === "tool_result") {
    const tool = frame.toolName !== undefined ? ` ${frame.toolName}` : "";
    return `${frame.index}. tool_result${tool} (${frame.message.toolUseId}) isError=${frame.message.isError}${truncated}`;
  }
  if (frame.message.type === "status") {
    return `${frame.index}. status ${frame.message.category}${truncated}`;
  }
  if (frame.message.type === "result") {
    return `${frame.index}. result isError=${frame.message.isError}${truncated}`;
  }
  return `${frame.index}. ${frame.message.type}${truncated}`;
}

function buildStagedTrajectorySummary(artifact: HarnessParityArtifact): string {
  const lines: string[] = [];
  lines.push("# Staged Trajectory");
  lines.push("");
  lines.push(`- status: staged`);
  lines.push(`- stages: ${artifact.stages.length}`);
  lines.push(
    `- emitsAgentMessageStream: ${artifact.capability.emitsAgentMessageStream}`,
  );
  renderTrajectoryDiagnosticsSummary(lines, artifact.trajectoryDiagnostics);
  for (const stage of artifact.stages) {
    lines.push(
      `- ${stage.stageId}: ${stage.trajectory.status}, frames=${stage.trajectory.frameCount}, diagnostics=${stage.trajectoryDiagnostics.warningCount}, artifact=${stage.trajectory.artifactPath}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function writeStagedTrajectoryArtifacts(artifact: HarnessParityArtifact): void {
  writeFileSync(
    join(artifact.artifactDir, TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME),
    JSON.stringify(
      {
        version: 1,
        status: "staged",
        counts: {
          warningCount: artifact.trajectoryDiagnostics.warningCount,
          unsupportedTrajectoryCount:
            artifact.trajectoryDiagnostics.unsupportedTrajectoryCount,
          missingStreamingFramesCount:
            artifact.trajectoryDiagnostics.missingStreamingFramesCount,
          missingFinalVerificationAfterEditCount:
            artifact.trajectoryDiagnostics
              .missingFinalVerificationAfterEditCount,
          repeatedIdenticalFailingCommandCount:
            artifact.trajectoryDiagnostics.repeatedIdenticalFailingCommandCount,
          editAfterSuccessfulVerificationCount:
            artifact.trajectoryDiagnostics.editAfterSuccessfulVerificationCount,
          longPreambleWithoutTaskTouchCount:
            artifact.trajectoryDiagnostics.longPreambleWithoutTaskTouchCount,
        },
        stages: artifact.stages.map((stage) => ({
          stageId: stage.stageId,
          diagnostics: stage.trajectoryDiagnostics,
        })),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(artifact.artifactDir, TRAJECTORY_ARTIFACT_NAME),
    JSON.stringify(
      {
        version: 1,
        status: "staged",
        emitsAgentMessageStream: artifact.capability.emitsAgentMessageStream,
        stages: artifact.stages.map((stage) => ({
          stageId: stage.stageId,
          trajectory: stage.trajectory,
        })),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(artifact.artifactDir, TRAJECTORY_SUMMARY_NAME),
    buildStagedTrajectorySummary(artifact),
  );
}
