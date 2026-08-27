import {
  AUTH_WALLED,
  HOST_SPECIFIC,
  NETWORK_COMMAND,
  VERIFY_COMMAND,
} from "./fixture-candidates-commands.js";
import { isJsonObject } from "./fixture-candidates-json.js";
import {
  type CandidateClassificationContext,
  duplicateReferencesFor,
  fixtureCandidateFingerprint,
  minimalFixtureInputs,
  preservationRationale,
  primaryPattern,
} from "./fixture-candidates-proposals.js";
import type {
  CalibrationArtifact,
  FixtureCandidateDisposition,
  FixtureCandidateDuplicateReference,
  FixtureCandidatePattern,
  FixtureCandidateReasonCode,
  FixtureCandidateRecord,
  FixtureCandidateReproducibility,
  FixtureCandidateSafety,
  FixtureCandidateStatus,
  FixtureCandidateVerifierHints,
  RunEvidence,
  RunMetadata,
} from "./fixture-candidates-types.js";
import { stableUnique } from "./fixture-candidates-types.js";

const GENERATED_ARTIFACT = /\.(?:json|jsonl|txt|md|html|png|csv)$/;
const TASK_PATH = /data\/tasks\/(?:archive\/)?(task-[A-Za-z0-9_.-]+)\.md/g;

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
  duplicateReferences: readonly FixtureCandidateDuplicateReference[],
): {
  status: FixtureCandidateStatus;
  disposition: FixtureCandidateDisposition;
  reasonCodes: readonly FixtureCandidateReasonCode[];
  safety: FixtureCandidateSafety;
  reproducibility: FixtureCandidateReproducibility;
  verifierHints: FixtureCandidateVerifierHints;
} {
  const reasons = new Set<FixtureCandidateReasonCode>();
  if (duplicateReferences.some((reference) => reference.kind === "fixture")) {
    reasons.add("duplicate-existing-fixture");
  }
  if (duplicateReferences.some((reference) => reference.kind === "task")) {
    reasons.add("duplicate-existing-task");
  }
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
    "duplicate-existing-task",
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
  const disposition = candidateDisposition(status, reasons);
  return {
    status,
    disposition,
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

function candidateDisposition(
  status: FixtureCandidateStatus,
  reasons: ReadonlySet<FixtureCandidateReasonCode>,
): FixtureCandidateDisposition {
  if (reasons.has("duplicate-existing-fixture") || reasons.has("duplicate-existing-task")) {
    return "duplicate";
  }
  if (reasons.has("operator-capture-required")) return "needs-owner-evidence";
  if (status === "rejected") return "rejected";
  return "proposed";
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
  metadata: RunMetadata,
  calibration: CalibrationArtifact | null,
  changedPaths: readonly string[],
): string | null {
  const payload = metadata.trigger?.payload;
  if (
    isJsonObject(payload) &&
    typeof payload.taskId === "string" &&
    payload.taskId.length > 0
  ) {
    return payload.taskId;
  }
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
  context: CandidateClassificationContext,
): FixtureCandidateRecord {
  const duplicateReferences = duplicateReferencesFor(
    context.duplicateFixtures,
    context.duplicateTaskReferences,
  );
  const pattern = primaryPattern(evidence, context.patternOccurrenceCounts);
  const proposalFingerprint = fixtureCandidateFingerprint({
    runId: evidence.metadata.id,
    workflow: evidence.metadata.workflow,
    patternSignature: pattern.signature,
  });
  const classification = classifyEvidence(evidence, duplicateReferences);
  const verificationCommands = evidence.commands
    .filter((command) => VERIFY_COMMAND.test(command.command))
    .map((command) => command.command);
  const duplicateTaskIds = duplicateReferences
    .filter((reference) => reference.kind === "task")
    .map((reference) => reference.id);
  return {
    runId: evidence.metadata.id,
    workflow: evidence.metadata.workflow,
    runStatus: evidence.metadata.status,
    taskId: inferTaskId(evidence.metadata, evidence.calibration, evidence.changedPaths),
    taskFinalState: evidence.calibration?.taskFinalState ?? null,
    status: classification.status,
    disposition: classification.disposition,
    proposalFingerprint,
    failurePattern: pattern,
    reasonCodes: classification.reasonCodes,
    reasonSummary: reasonSummary(classification.status, classification.reasonCodes),
    preservationRationale: preservationRationale(pattern),
    minimalFixtureInputs: minimalFixtureInputs(evidence, pattern),
    suggestedEvaluator: evidence.patternSignals.find((signal) =>
      signal.signature === pattern.signature
    )?.suggestedEvaluator ?? "deterministic-predicate",
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
      covered: duplicateReferences.length > 0,
      fixtureIds: context.duplicateFixtures,
      taskIds: stableUnique(duplicateTaskIds),
    },
    duplicateReferences,
    acceptedAction: null,
  };
}

export function malformedCandidate(runId: string, message: string): FixtureCandidateRecord {
  const failurePattern: FixtureCandidatePattern = {
    kind: "terminal-trace",
    signature: ["malformed", runId].join(":"),
    title: "Malformed run artifact",
    summary: `Run artifacts could not be parsed: ${message}`,
    evidencePaths: [`.kota/runs/${runId}/metadata.json`],
    occurrenceCount: 1,
  };
  return {
    runId,
    workflow: "unknown",
    runStatus: "unknown",
    taskId: null,
    taskFinalState: null,
    status: "rejected",
    disposition: "rejected",
    proposalFingerprint: fixtureCandidateFingerprint({
      runId,
      workflow: "unknown",
      patternSignature: failurePattern.signature,
    }),
    failurePattern,
    reasonCodes: ["artifact-malformed"],
    reasonSummary: `rejected: artifact-malformed (${message})`,
    preservationRationale: "Malformed run artifacts cannot become a safe eval candidate until the artifact boundary is repaired.",
    minimalFixtureInputs: [`.kota/runs/${runId}/metadata.json`],
    suggestedEvaluator: "artifact-schema-check",
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
    duplicateCoverage: { covered: false, fixtureIds: [], taskIds: [] },
    duplicateReferences: [],
    acceptedAction: null,
  };
}
