import {
  AUTH_WALLED,
  HOST_SPECIFIC,
  NETWORK_COMMAND,
  VERIFY_COMMAND,
} from "./fixture-candidates-commands.js";
import type {
  CalibrationArtifact,
  FixtureCandidateReasonCode,
  FixtureCandidateRecord,
  FixtureCandidateReproducibility,
  FixtureCandidateSafety,
  FixtureCandidateStatus,
  FixtureCandidateVerifierHints,
  RunEvidence,
  RunSummaryArtifact,
} from "./fixture-candidates-types.js";
import { stableUnique } from "./fixture-candidates-types.js";

const GENERATED_ARTIFACT =
  /\.(?:json|jsonl|txt|md|html|png|csv)$/;
const TASK_PATH = /data\/tasks\/(?:ready|doing|done|blocked|backlog|dropped)\/(task-[A-Za-z0-9_.-]+)\.md/g;

function verifierHintsFor(evidence: RunEvidence): FixtureCandidateVerifierHints {
  const stateTargets = stableUnique([
    ...evidence.changedPaths.filter((path) => !path.startsWith("data/tasks/")),
    ...evidence.structuredArtifacts
      .filter((artifact) => artifact.kind === "json")
      .map((artifact) => `.kota/runs/<run-id>/${artifact.path}`),
  ]).slice(0, 12);
  const objectiveMetricCandidates = evidence.structuredArtifacts
    .filter((artifact) => artifact.kind === "json" && /metric|diagnostic|verification|summary|calibration/i.test(artifact.path))
    .map((artifact) => `${artifact.path}: numeric fields or counts`);
  const noOpChecks = stateTargets.length > 0
    ? stateTargets.map((target) => `no-op leaves ${target} absent or unchanged`).slice(0, 4)
    : [];
  const partialAblationChecks = evidence.commands
    .filter((command) => VERIFY_COMMAND.test(command.command))
    .map((command) => `drop or perturb ${command.command} and expect verifier failure`)
    .slice(0, 4);
  return {
    stateTargets,
    objectiveMetricCandidates,
    noOpChecks,
    partialAblationChecks,
  };
}

function classifyEvidence(
  evidence: RunEvidence,
  duplicateFixtures: readonly string[],
): {
  status: FixtureCandidateStatus;
  reasonCodes: readonly FixtureCandidateReasonCode[];
  safety: FixtureCandidateSafety;
  reproducibility: FixtureCandidateReproducibility;
  verifierHints: FixtureCandidateVerifierHints;
} {
  const reasons = new Set<FixtureCandidateReasonCode>();
  if (duplicateFixtures.length > 0) reasons.add("duplicate-existing-fixture");
  if (evidence.malformedArtifacts.length > 0) reasons.add("artifact-malformed");
  if (evidence.operatorCaptureMentioned) reasons.add("operator-capture-required");
  if (evidence.commands.length === 0) reasons.add("trace-too-sparse");
  for (const command of evidence.commands) {
    for (const risk of command.risk) reasons.add(risk);
  }
  const redactionCount = evidence.commands.filter((command) =>
    command.risk.includes("privacy-secret-like-value"),
  ).length;
  if (redactionCount > 0) reasons.add("privacy-secret-like-value");
  const verifierHints = verifierHintsFor(evidence);
  const verificationCommands = evidence.commands.filter((command) =>
    VERIFY_COMMAND.test(command.command),
  );
  if (verifierHints.stateTargets.length === 0 || verificationCommands.length === 0) {
    reasons.add("verifier-no-state-signal");
  }
  const requiredServices = stableUnique(
    evidence.commands
      .filter((command) => NETWORK_COMMAND.test(command.command) || AUTH_WALLED.test(command.command))
      .map((command) => command.command.split(/\s+/)[0]),
  );
  const hostAssumptions = stableUnique(
    evidence.commands
      .filter((command) => HOST_SPECIFIC.test(command.command))
      .map((command) => command.command),
  );
  const generatedArtifacts = stableUnique(
    [...evidence.changedPaths, ...evidence.structuredArtifacts.map((artifact) => artifact.path)]
      .filter((path) => GENERATED_ARTIFACT.test(path)),
  );
  const hardRejects: readonly FixtureCandidateReasonCode[] = [
    "artifact-malformed",
    "duplicate-existing-fixture",
    "operator-capture-required",
    "privacy-secret-like-value",
    "reproducibility-auth-walled",
    "reproducibility-network-bound",
    "safety-destructive-command",
    "trace-too-sparse",
  ];
  let status: FixtureCandidateStatus = "viable";
  if ([...reasons].some((reason) => hardRejects.includes(reason))) {
    status = "rejected";
  } else if (
    reasons.has("reproducibility-host-specific") ||
    reasons.has("verifier-no-state-signal")
  ) {
    status = "needs-review";
  }
  return {
    status,
    reasonCodes: [...reasons].sort(),
    safety: {
      redactionCount,
      findings: [...reasons]
        .filter((reason) => reason.startsWith("privacy-") || reason.startsWith("safety-"))
        .sort(),
    },
    reproducibility: {
      localOnly: requiredServices.length === 0,
      requiredServices,
      generatedArtifacts,
      hostAssumptions,
    },
    verifierHints,
  };
}

function reasonSummary(
  status: FixtureCandidateStatus,
  reasonCodes: readonly FixtureCandidateReasonCode[],
): string {
  if (status === "viable") {
    return "Local terminal trace with verification commands and state-based verifier targets.";
  }
  return `${status}: ${reasonCodes.join(", ")}`;
}

function inferTaskId(
  summary: RunSummaryArtifact | null,
  calibration: CalibrationArtifact | null,
  changedPaths: readonly string[],
): string | null {
  if (summary?.taskId !== null && summary?.taskId !== undefined) return summary.taskId;
  if (calibration?.taskId !== null && calibration?.taskId !== undefined) {
    return calibration.taskId;
  }
  const taskIds = new Set<string>();
  for (const path of changedPaths) {
    for (const match of path.matchAll(TASK_PATH)) taskIds.add(match[1]);
  }
  return taskIds.size === 1 ? [...taskIds][0] : null;
}

export function toCandidate(
  evidence: RunEvidence,
  duplicateFixtures: readonly string[],
): FixtureCandidateRecord {
  const classification = classifyEvidence(evidence, duplicateFixtures);
  const verificationCommands = evidence.commands
    .filter((command) => VERIFY_COMMAND.test(command.command))
    .map((command) => command.command);
  return {
    runId: evidence.metadata.id,
    workflow: evidence.metadata.workflow,
    runStatus: evidence.metadata.status,
    taskId: inferTaskId(evidence.summary, evidence.calibration, evidence.changedPaths),
    taskFinalState: evidence.calibration?.taskFinalState ?? null,
    status: classification.status,
    reasonCodes: classification.reasonCodes,
    reasonSummary: reasonSummary(classification.status, classification.reasonCodes),
    terminalEvidence: {
      commandCount: evidence.commands.length,
      commands: evidence.commands,
      verificationCommands: stableUnique(verificationCommands),
      taskStateMoves: evidence.taskStateMoves,
    },
    changedPaths: evidence.changedPaths,
    structuredArtifacts: evidence.structuredArtifacts,
    safety: classification.safety,
    reproducibility: classification.reproducibility,
    verifierHints: classification.verifierHints,
    duplicateCoverage: {
      covered: duplicateFixtures.length > 0,
      fixtureIds: duplicateFixtures,
    },
  };
}

export function malformedCandidate(runId: string, message: string): FixtureCandidateRecord {
  return {
    runId,
    workflow: "unknown",
    runStatus: "unknown",
    taskId: null,
    taskFinalState: null,
    status: "rejected",
    reasonCodes: ["artifact-malformed"],
    reasonSummary: `rejected: artifact-malformed (${message})`,
    terminalEvidence: {
      commandCount: 0,
      commands: [],
      verificationCommands: [],
      taskStateMoves: [],
    },
    changedPaths: [],
    structuredArtifacts: [],
    safety: { redactionCount: 0, findings: [] },
    reproducibility: {
      localOnly: false,
      requiredServices: [],
      generatedArtifacts: [],
      hostAssumptions: [],
    },
    verifierHints: {
      stateTargets: [],
      objectiveMetricCandidates: [],
      noOpChecks: [],
      partialAblationChecks: [],
    },
    duplicateCoverage: { covered: false, fixtureIds: [] },
  };
}
