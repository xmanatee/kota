import { createHash } from "node:crypto";
import type {
  FixtureCandidateDuplicateReference,
  FixtureCandidatePattern,
  RunEvidence,
  RunPatternSignal,
} from "./fixture-candidates-types.js";
import { stableUnique } from "./fixture-candidates-types.js";

export type CandidateClassificationContext = {
  duplicateFixtures: readonly string[];
  duplicateTaskReferences: readonly FixtureCandidateDuplicateReference[];
  patternOccurrenceCounts: ReadonlyMap<string, number>;
};

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fixtureCandidateFingerprint(args: {
  runId: string;
  workflow: string;
  patternSignature: string;
}): string {
  return [
    "fixture-candidate",
    args.workflow,
    stableHash(`${args.runId}\0${args.patternSignature}`).slice(0, 16),
  ].join(":");
}

const PATTERN_PRIORITY: readonly RunPatternSignal["kind"][] = [
  "recurring-trajectory-warning",
  "review-scrutiny-thin-acceptance",
  "repair-loop-failure",
  "workflow-schema-validation-failure",
  "terminal-trace",
];

function fallbackTerminalPattern(evidence: RunEvidence): RunPatternSignal {
  return {
    kind: "terminal-trace",
    signature: ["terminal-trace", evidence.metadata.workflow, evidence.metadata.status].join(":"),
    title: `Terminal trace from ${evidence.metadata.workflow}`,
    summary: "Terminal run trace with commands, artifacts, and changed-path evidence.",
    evidencePaths: [`.kota/runs/${evidence.metadata.id}/metadata.json`],
    suggestedEvaluator: "deterministic-predicate",
  };
}

export function primaryPattern(
  evidence: RunEvidence,
  occurrenceCounts: ReadonlyMap<string, number>,
): FixtureCandidatePattern {
  const signals = evidence.patternSignals.length > 0
    ? [...evidence.patternSignals]
    : [fallbackTerminalPattern(evidence)];
  signals.sort((a, b) =>
    PATTERN_PRIORITY.indexOf(a.kind) - PATTERN_PRIORITY.indexOf(b.kind) ||
    a.signature.localeCompare(b.signature)
  );
  const selected = signals[0];
  return {
    kind: selected.kind,
    signature: selected.signature,
    title: selected.title,
    summary: selected.summary,
    evidencePaths: selected.evidencePaths,
    occurrenceCount: occurrenceCounts.get(selected.signature) ?? 1,
  };
}

export function duplicateReferencesFor(
  duplicateFixtures: readonly string[],
  duplicateTaskReferences: readonly FixtureCandidateDuplicateReference[],
): readonly FixtureCandidateDuplicateReference[] {
  return [
    ...duplicateFixtures.map((id): FixtureCandidateDuplicateReference => ({
      kind: "fixture",
      id,
      path: `src/modules/eval-harness/fixtures/${id}/fixture.json`,
      reason: "eval fixture already has real-failure provenance for this source run",
    })),
    ...duplicateTaskReferences,
  ].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path) || a.id.localeCompare(b.id)
  );
}

export function preservationRationale(pattern: FixtureCandidatePattern): string {
  switch (pattern.kind) {
    case "recurring-trajectory-warning":
      return `Preserve the ${pattern.occurrenceCount > 1 ? "recurring " : ""}trajectory warning as a regression target before changing harness, reviewer, or workflow behavior.`;
    case "review-scrutiny-thin-acceptance":
      return "Preserve a reviewer thin-acceptance case so future reviewer or critic changes prove stronger evidence requirements.";
    case "repair-loop-failure":
      return "Preserve the repair-loop failure as a regression target for deterministic repair checks and workflow execution behavior.";
    case "workflow-schema-validation-failure":
      return "Preserve the workflow schema or validation failure as a compact artifact-schema regression case.";
    case "terminal-trace":
      return "Preserve the local terminal trace only if the bounded commands and state targets can become a deterministic fixture.";
  }
}

export function minimalFixtureInputs(
  evidence: RunEvidence,
  pattern: FixtureCandidatePattern,
): readonly string[] {
  return stableUnique([
    `.kota/runs/${evidence.metadata.id}/metadata.json`,
    ...pattern.evidencePaths,
    ...evidence.structuredArtifacts
      .filter((artifact) => /(?:summary|diagnostic|verification|review|calibration)/i.test(artifact.path))
      .map((artifact) => `.kota/runs/${evidence.metadata.id}/${artifact.path}`),
    ...evidence.changedPaths.slice(0, 6),
  ]).slice(0, 12);
}
