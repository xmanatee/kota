import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME,
  type TrajectoryDiagnostic,
  type TrajectoryDiagnosticCode,
  type TrajectoryDiagnosticsArtifact,
  type TrajectoryDiagnosticsCounts,
} from "#core/agent-harness/index.js";

const DIAGNOSTIC_ARTIFACT_SUFFIX = `.${TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME}`;

const DIAGNOSTIC_CODES = new Set<TrajectoryDiagnosticCode>([
  "unsupported_trajectory",
  "missing_streaming_frames",
  "missing_final_verification_after_edit",
  "repeated_identical_failing_command",
  "edit_after_successful_verification",
  "long_preamble_without_task_touch",
]);

const NON_ESCALATABLE_DIAGNOSTIC_CODES = new Set<TrajectoryDiagnosticCode>([
  "unsupported_trajectory",
]);

type TrajectoryDiagnosticsArtifactCandidate = Partial<
  Omit<TrajectoryDiagnosticsArtifact, "counts" | "status">
> & {
  counts?: Partial<TrajectoryDiagnosticsCounts>;
  status?: string;
};

function emptyTrajectoryDiagnosticsCounts(): TrajectoryDiagnosticsCounts {
  return {
    warningCount: 0,
    unsupportedTrajectoryCount: 0,
    missingStreamingFramesCount: 0,
    missingFinalVerificationAfterEditCount: 0,
    repeatedIdenticalFailingCommandCount: 0,
    editAfterSuccessfulVerificationCount: 0,
    longPreambleWithoutTaskTouchCount: 0,
  };
}

function legacyCleanTrajectoryDiagnosticsArtifact(
  raw: TrajectoryDiagnosticsArtifactCandidate,
): TrajectoryDiagnosticsArtifact | null {
  // Older control-monitor evidence fixtures wrote a clean-only shape before
  // trajectory diagnostics had a versioned artifact schema. They carry no
  // warning evidence, so normalize them into an empty observation instead of
  // letting one retained historical artifact abort every detector pass.
  if (
    raw.version !== undefined ||
    raw.status !== "ok" ||
    raw.counts?.warningCount !== 0 ||
    raw.diagnostics !== undefined
  ) {
    return null;
  }
  return {
    version: 1,
    status: "supported",
    emitsAgentMessageStream: true,
    counts: emptyTrajectoryDiagnosticsCounts(),
    diagnostics: [],
  };
}

export function readTrajectoryDiagnosticsArtifact(
  artifactPath: string,
): TrajectoryDiagnosticsArtifact {
  const raw = JSON.parse(
    readFileSync(artifactPath, "utf-8"),
  ) as TrajectoryDiagnosticsArtifactCandidate;
  const legacyClean = legacyCleanTrajectoryDiagnosticsArtifact(raw);
  if (legacyClean) return legacyClean;
  if (
    raw.version !== 1 ||
    (raw.status !== "supported" && raw.status !== "unsupported") ||
    typeof raw.emitsAgentMessageStream !== "boolean" ||
    !raw.counts ||
    !Array.isArray(raw.diagnostics)
  ) {
    throw new Error(`Malformed trajectory diagnostics artifact: ${artifactPath}`);
  }
  for (const diagnostic of raw.diagnostics) {
    if (
      !diagnostic ||
      !DIAGNOSTIC_CODES.has(diagnostic.code as TrajectoryDiagnosticCode) ||
      diagnostic.severity !== "warning" ||
      typeof diagnostic.summary !== "string" ||
      !Array.isArray(diagnostic.frameIndexes) ||
      !Array.isArray(diagnostic.details) ||
      !diagnostic.details.every((detail: string) => typeof detail === "string")
    ) {
      throw new Error(
        `Malformed trajectory diagnostic entry in artifact: ${artifactPath}`,
      );
    }
  }
  return raw as TrajectoryDiagnosticsArtifact;
}

export function listStepTrajectoryArtifacts(
  runsDir: string,
  runId: string,
): string[] {
  const stepsDir = join(runsDir, runId, "steps");
  let entries: string[];
  try {
    entries = readdirSync(stepsDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(DIAGNOSTIC_ARTIFACT_SUFFIX))
    .sort()
    .map((entry) => join(stepsDir, entry));
}

export function repoRelativeTrajectoryArtifactPath(
  runsDir: string,
  artifactPath: string,
): string {
  const scopeRoot = dirname(dirname(runsDir));
  return relative(scopeRoot, artifactPath).split("\\").join("/");
}

export function stepIdFromArtifactPath(artifactPath: string): string {
  const file = artifactPath.split("/").pop() ?? artifactPath;
  return file.slice(0, -DIAGNOSTIC_ARTIFACT_SUFFIX.length);
}

export function isEscalatableDiagnosticArtifact(
  artifact: TrajectoryDiagnosticsArtifact,
): boolean {
  return artifact.status === "supported";
}

export function isEscalatableDiagnostic(
  diagnostic: TrajectoryDiagnostic,
): boolean {
  return !NON_ESCALATABLE_DIAGNOSTIC_CODES.has(diagnostic.code);
}
