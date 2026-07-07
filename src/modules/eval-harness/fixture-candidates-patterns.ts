import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { redactSensitive } from "./fixture-candidates-commands.js";
import {
  asArray,
  isJsonObject,
  readJsonValue,
} from "./fixture-candidates-json.js";
import type {
  FixtureCandidateEvaluatorType,
  JsonValue,
  RunMetadata,
  RunPatternSignal,
} from "./fixture-candidates-types.js";

const TRAJECTORY_DIAGNOSTICS_SUFFIX = ".trajectory-diagnostics.json";
const WORKFLOW_VALIDATION_FAILURE =
  /\b(?:WorkflowDefinitionError|workflow(?:\s+\w+){0,4}\s+(?:schema|validation)|(?:schema|validation)(?:\s+\w+){0,4}\s+(?:fail|error|invalid)|validation failed)\b/i;
const REPAIR_LOOP_FAILURE =
  /\b(?:repair-loop|repair loop|repairIterations|repair check|repair-check|exhaustion)\b/i;

function truncateSingleLine(value: string, max = 180): string {
  const single = redactSensitive(value).text.replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 3)}...`;
}

function runArtifactPath(metadata: RunMetadata, relativePath: string): string {
  return `.kota/runs/${metadata.id}/${relativePath}`;
}

function listJsonArtifactPaths(runDir: string): readonly string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(runDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) paths.push(entry.name);
  }
  const stepsDir = join(runDir, "steps");
  if (existsSync(stepsDir)) {
    for (const entry of readdirSync(stepsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        paths.push(`steps/${entry.name}`);
      }
    }
  }
  return paths.sort();
}

function stepIdFromTrajectoryArtifact(path: string): string {
  const fileName = basename(path);
  return fileName.slice(0, -TRAJECTORY_DIAGNOSTICS_SUFFIX.length);
}

function pushPatternSignal(
  signals: RunPatternSignal[],
  signal: RunPatternSignal,
): void {
  if (!signals.some((existing) => existing.signature === signal.signature)) {
    signals.push(signal);
  }
}

function stringFromJson(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberFromJson(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trajectoryDiagnosticSignals(
  metadata: RunMetadata,
  relativePath: string,
  value: JsonValue,
): readonly RunPatternSignal[] {
  if (!relativePath.endsWith(TRAJECTORY_DIAGNOSTICS_SUFFIX) || !isJsonObject(value)) {
    return [];
  }
  const diagnostics = asArray(value.diagnostics).filter(isJsonObject);
  const warningCount = numberFromJson(isJsonObject(value.counts) ? value.counts.warningCount : undefined) ?? diagnostics.length;
  if (warningCount <= 0) return [];
  const stepId = stepIdFromTrajectoryArtifact(relativePath);
  if (diagnostics.length === 0) {
    const signature = ["trajectory", metadata.workflow, stepId, "warning"].join(":");
    return [{
      kind: "recurring-trajectory-warning",
      signature,
      title: `Recurring trajectory warning in ${metadata.workflow}/${stepId}`,
      summary: `${warningCount} trajectory warning(s) recorded in ${relativePath}.`,
      evidencePaths: [runArtifactPath(metadata, relativePath)],
      suggestedEvaluator: "trajectory-check",
    }];
  }
  return diagnostics.map((diagnostic) => {
    const code = stringFromJson(diagnostic.code) ?? "warning";
    const summary = truncateSingleLine(stringFromJson(diagnostic.summary) ?? code);
    const signature = [
      "trajectory",
      metadata.workflow,
      stepId,
      code,
      summary,
    ].join(":");
    return {
      kind: "recurring-trajectory-warning",
      signature,
      title: `Recurring trajectory warning: ${code}`,
      summary,
      evidencePaths: [runArtifactPath(metadata, relativePath)],
      suggestedEvaluator: "trajectory-check" satisfies FixtureCandidateEvaluatorType,
    };
  });
}

function hasThinAcceptance(value: JsonValue | undefined): boolean {
  if (Array.isArray(value)) return value.some(hasThinAcceptance);
  if (!isJsonObject(value)) return false;
  if (value.thinAcceptance === true) return true;
  const thinAcceptances = numberFromJson(value.thinAcceptances);
  if (thinAcceptances !== null && thinAcceptances > 0) return true;
  if (asArray(value.thinAcceptanceRefs).length > 0) return true;
  return Object.values(value).some(hasThinAcceptance);
}

function reviewScrutinySignal(
  metadata: RunMetadata,
  relativePath: string,
  value: JsonValue,
): RunPatternSignal | null {
  if (!/review-scrutiny\.json$/.test(relativePath) && !hasThinAcceptance(value)) {
    return null;
  }
  if (!hasThinAcceptance(value)) return null;
  return {
    kind: "review-scrutiny-thin-acceptance",
    signature: ["review-scrutiny", metadata.workflow, relativePath].join(":"),
    title: `Review-scrutiny thin acceptance in ${metadata.workflow}`,
    summary: `Review-scrutiny evidence in ${relativePath} records a thin acceptance.`,
    evidencePaths: [runArtifactPath(metadata, relativePath)],
    suggestedEvaluator: "artifact-schema-check",
  };
}

function hasRepairFailure(value: JsonValue | undefined): boolean {
  if (Array.isArray(value)) return value.some(hasRepairFailure);
  if (!isJsonObject(value)) return false;
  const repairIterations = asArray(value.repairIterations);
  if (
    repairIterations.some((iteration) =>
      isJsonObject(iteration) && asArray(iteration.failures).length > 0
    )
  ) {
    return true;
  }
  if (Object.hasOwn(value, "failures") && asArray(value.failures).length > 0) {
    return true;
  }
  return Object.values(value).some(hasRepairFailure);
}

function failedStepIds(metadata: RunMetadata): readonly string[] {
  return metadata.steps
    .filter((step) => step.status === "failed")
    .map((step) => step.id)
    .sort();
}

function firstMatchingLine(text: string, pattern: RegExp): string | null {
  for (const lineText of text.split("\n")) {
    if (pattern.test(lineText)) return truncateSingleLine(lineText);
  }
  return null;
}

function repairLoopSignal(
  metadata: RunMetadata,
  textEvidence: string,
): RunPatternSignal | null {
  const stepIds = metadata.steps
    .filter((step) => step.status === "failed" && hasRepairFailure(step.output))
    .map((step) => step.id)
    .sort();
  if (stepIds.length === 0 && !(metadata.status === "failed" && REPAIR_LOOP_FAILURE.test(textEvidence))) {
    return null;
  }
  const failedSteps = stepIds.length > 0 ? stepIds : failedStepIds(metadata);
  const signalId = failedSteps.join(",") || "workflow";
  return {
    kind: "repair-loop-failure",
    signature: ["repair-loop", metadata.workflow, signalId].join(":"),
    title: `Repair-loop failure in ${metadata.workflow}`,
    summary: firstMatchingLine(textEvidence, REPAIR_LOOP_FAILURE) ??
      `Failed ${metadata.workflow} run includes repair-loop failure evidence.`,
    evidencePaths: [runArtifactPath(metadata, "metadata.json")],
    suggestedEvaluator: "deterministic-predicate",
  };
}

function workflowValidationSignal(
  metadata: RunMetadata,
  textEvidence: string,
): RunPatternSignal | null {
  if (metadata.status !== "failed" || !WORKFLOW_VALIDATION_FAILURE.test(textEvidence)) {
    return null;
  }
  const failedSteps = failedStepIds(metadata);
  const signalId = failedSteps.join(",") || "workflow";
  return {
    kind: "workflow-schema-validation-failure",
    signature: ["workflow-validation", metadata.workflow, signalId].join(":"),
    title: `Workflow validation failure in ${metadata.workflow}`,
    summary: firstMatchingLine(textEvidence, WORKFLOW_VALIDATION_FAILURE) ??
      `Failed ${metadata.workflow} run includes workflow validation evidence.`,
    evidencePaths: [runArtifactPath(metadata, "metadata.json")],
    suggestedEvaluator: "artifact-schema-check",
  };
}

export function collectPatternSignals(
  runDir: string,
  metadata: RunMetadata,
  textEvidence: string,
): readonly RunPatternSignal[] {
  const signals: RunPatternSignal[] = [];
  const repairSignal = repairLoopSignal(metadata, textEvidence);
  if (repairSignal !== null) pushPatternSignal(signals, repairSignal);
  const validationSignal = workflowValidationSignal(metadata, textEvidence);
  if (validationSignal !== null) pushPatternSignal(signals, validationSignal);
  for (const relativePath of listJsonArtifactPaths(runDir)) {
    try {
      const value = readJsonValue(join(runDir, relativePath));
      for (const signal of trajectoryDiagnosticSignals(metadata, relativePath, value)) {
        pushPatternSignal(signals, signal);
      }
      const scrutinySignal = reviewScrutinySignal(metadata, relativePath, value);
      if (scrutinySignal !== null) pushPatternSignal(signals, scrutinySignal);
    } catch {
    }
  }
  return signals.sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.signature.localeCompare(b.signature)
  );
}
