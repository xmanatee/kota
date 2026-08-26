import { existsSync, readFileSync } from "node:fs";
import type {
  HarnessParityMatrixRow,
  HarnessParityMatrixVerificationSummary,
} from "./client.js";
import type { MatrixModelSpec } from "./model-matrix-models.js";
import type { HarnessParityArtifact } from "./runner.js";
import { scaffoldEvidenceForRow } from "./scaffold-evidence.js";

type TrajectoryFrameLike = {
  type?: string;
  toolName?: string;
  message?: {
    type?: string;
    toolName?: string;
  };
};

type TrajectoryArtifactLike = {
  frames?: TrajectoryFrameLike[];
};

function sumStageToolCount(
  artifact: HarnessParityArtifact,
  field: "toolCallCount" | "toolResultCount",
): number {
  return artifact.stages.reduce(
    (sum, stage) => sum + stage.trajectory[field],
    0,
  );
}

function readTrajectoryArtifact(path: string): TrajectoryArtifactLike | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as TrajectoryArtifactLike;
  } catch {
    return null;
  }
}

function countApprovalRequests(artifact: HarnessParityArtifact): number {
  let count = 0;
  for (const stage of artifact.stages) {
    const trajectory = readTrajectoryArtifact(stage.trajectory.artifactPath);
    if (!trajectory?.frames) continue;
    for (const frame of trajectory.frames) {
      const type = frame.type ?? frame.message?.type;
      const toolName = frame.toolName ?? frame.message?.toolName ?? "";
      if (type !== "tool_call") continue;
      if (/approval|approve|ask[_-]?owner|owner[_-]?decision/i.test(toolName)) {
        count += 1;
      }
    }
  }
  return count;
}

function verificationSummary(
  artifact: HarnessParityArtifact,
): HarnessParityMatrixVerificationSummary {
  return {
    passed: artifact.verification.passed,
    exitStatus: artifact.verification.exitStatus,
    timedOut: artifact.verification.timedOut,
    command: artifact.verification.command,
  };
}

export function rowFromArtifact(args: {
  spec: MatrixModelSpec;
  harnessName: string;
  scenarioId: string;
  repeatIndex: number;
  repeatCount: number;
  rowId: string;
  artifact: HarnessParityArtifact;
}): HarnessParityMatrixRow {
  const { artifact } = args;
  const status = artifact.verification.passed
    ? "passed"
    : artifact.isError
      ? "error"
      : "failed";
  const scaffoldEvidence = scaffoldEvidenceForRow({
    harnessName: args.harnessName,
    scenarioId: args.scenarioId,
    status,
  });
  return {
    rowId: args.rowId,
    targetKind: "harness-parity-scenario",
    role: args.spec.role,
    label: args.spec.label,
    provider: args.spec.provider,
    model: args.spec.model,
    requestedModel: args.spec.requestedModel,
    harnessName: args.harnessName,
    scenarioId: args.scenarioId,
    repeatIndex: args.repeatIndex,
    repeatCount: args.repeatCount,
    status,
    capabilityMetadata: args.spec.capabilityMetadata,
    durationMs: artifact.durationMs,
    turns: artifact.turns,
    tokenUsage: {
      inputTokens: artifact.usage.tokens.state === "unknown"
        ? null
        : artifact.usage.tokens.inputTokens,
      outputTokens: artifact.usage.tokens.state === "unknown"
        ? null
        : artifact.usage.tokens.outputTokens,
    },
    estimatedCostUsd: artifact.usage.cost.state === "complete"
      ? artifact.usage.cost.usd
      : null,
    toolCounts: {
      toolCalls: sumStageToolCount(artifact, "toolCallCount"),
      toolResults: sumStageToolCount(artifact, "toolResultCount"),
    },
    approvalCounts: {
      approvalRequests: countApprovalRequests(artifact),
    },
    verification: verificationSummary(artifact),
    trajectoryDiagnostics: {
      warningCount: artifact.trajectoryDiagnostics.warningCount,
      missingStreamingFramesCount:
        artifact.trajectoryDiagnostics.missingStreamingFramesCount,
      unsupportedTrajectoryCount:
        artifact.trajectoryDiagnostics.unsupportedTrajectoryCount,
    },
    ...(scaffoldEvidence !== undefined ? { scaffoldEvidence } : {}),
    changedFiles: [...artifact.changedFiles],
    artifactDir: artifact.artifactDir,
  };
}

export function skippedRow(args: {
  spec: MatrixModelSpec;
  targetKind?: HarnessParityMatrixRow["targetKind"];
  harnessName: string;
  scenarioId: string;
  repeatIndex: number;
  repeatCount: number;
  rowId: string;
  skipReason: string;
}): HarnessParityMatrixRow {
  const status = "skipped";
  const scaffoldEvidence = scaffoldEvidenceForRow({
    harnessName: args.harnessName,
    scenarioId: args.scenarioId,
    status,
  });
  return {
    rowId: args.rowId,
    targetKind: args.targetKind ?? "harness-parity-scenario",
    role: args.spec.role,
    label: args.spec.label,
    provider: args.spec.provider,
    model: args.spec.model,
    requestedModel: args.spec.requestedModel,
    harnessName: args.harnessName,
    scenarioId: args.scenarioId,
    repeatIndex: args.repeatIndex,
    repeatCount: args.repeatCount,
    status,
    skipReason: args.skipReason,
    capabilityMetadata: args.spec.capabilityMetadata,
    durationMs: 0,
    turns: 0,
    tokenUsage: {
      inputTokens: null,
      outputTokens: null,
    },
    estimatedCostUsd: null,
    toolCounts: {
      toolCalls: 0,
      toolResults: 0,
    },
    approvalCounts: {
      approvalRequests: 0,
    },
    verification: null,
    trajectoryDiagnostics: null,
    ...(scaffoldEvidence !== undefined ? { scaffoldEvidence } : {}),
    changedFiles: [],
  };
}
