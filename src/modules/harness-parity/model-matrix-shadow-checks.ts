import type {
  HarnessParityMatrixCompatibilityCheck,
  HarnessParityMatrixGroupAggregate,
  HarnessParityMatrixRow,
} from "./client.js";
import type { MatrixGroup } from "./model-matrix-aggregate.js";

type CompatibilityCheckArgs = {
  baselineGroup: MatrixGroup;
  candidateGroup: MatrixGroup;
  baselineAggregate: HarnessParityMatrixGroupAggregate;
  candidateAggregate: HarnessParityMatrixGroupAggregate;
  baselineDuration: number | null;
  candidateDuration: number | null;
  baselineCost: number | null;
  candidateCost: number | null;
  baselineTraceSummaryPath: string | null;
  candidateTraceSummaryPath: string | null;
};

function hasModelCapabilityEvidence(row: HarnessParityMatrixRow): boolean {
  return row.capabilityMetadata.status === "available";
}

function primaryBaselineEvidence(row: HarnessParityMatrixRow): boolean {
  return row.harnessName === "codex" || row.provider === "active-preset";
}

function evalHarnessModelEvidenceMatches(
  row: HarnessParityMatrixRow,
): boolean {
  if (row.targetKind !== "eval-harness-fixture") return true;
  const pairs =
    row.evalHarness?.resolvedHarnessModelEvidence.distinctHarnessModels ?? [];
  return row.evalHarness?.resolvedHarnessModelEvidence.status === "complete" && pairs.length > 0 && pairs.every(
    (pair) =>
      pair.harness === row.harnessName &&
      (pair.model === row.model || pair.model === row.requestedModel),
  );
}

function check(
  name: string,
  passed: boolean,
  detail: string,
): HarnessParityMatrixCompatibilityCheck {
  return { name, passed, detail };
}

export function compatibilityChecks(
  args: CompatibilityCheckArgs,
): HarnessParityMatrixCompatibilityCheck[] {
  const baselineFirst = args.baselineGroup.rows[0]!;
  const candidateFirst = args.candidateGroup.rows[0]!;
  const baselineVerification = baselineFirst.verification;
  const candidateVerification = candidateFirst.verification;
  const testCommandComparable =
    baselineVerification !== null &&
    candidateVerification !== null &&
    baselineVerification.command === candidateVerification.command;

  const allRows = [...args.baselineGroup.rows, ...args.candidateGroup.rows];
  const evalSummary = baselineFirst.evalHarness?.runConfigurationSummary;
  const evalComparable = allRows.every((row) => {
    if (row.targetKind !== "eval-harness-fixture") return true;
    const evidence = row.evalHarness;
    if (!evidence || !evalSummary) return false;
    return evidence.executionMode === "live" && evidence.executionProfile.gateEligible &&
      (["activePreset", "fixtureManifest", "sourceIdentity", "resourceProfile", "executionProfile"] as const)
        .every((field) => evidence.runConfigurationSummary[field] === evalSummary[field]);
  });

  return [
    check("eval-configuration-resources", evalComparable,
      "eval comparisons require matching fixture, source, configuration and verified execution/resource profiles"),
    check("complete-repeats", allRows.every((row) => row.status !== "skipped") &&
      [args.baselineGroup, args.candidateGroup].every((group) =>
        group.rows.length === group.rows[0]!.repeatCount &&
        new Set(group.rows.map((row) => row.repeatIndex)).size === group.rows.length),
      "every declared repeat must have distinct execution evidence"),
    check(
      "same-target",
      baselineFirst.targetKind === candidateFirst.targetKind &&
        baselineFirst.scenarioId === candidateFirst.scenarioId,
      "baseline and candidate must point at the same scenario or eval fixture",
    ),
    check(
      "same-repeat-count",
      args.baselineAggregate.repeatCount === args.candidateAggregate.repeatCount,
      "baseline and candidate must use the same repeat count",
    ),
    check(
      "baseline-is-primary",
      primaryBaselineEvidence(baselineFirst),
      "baseline must be the primary active-preset/Codex row, not another candidate row",
    ),
    check(
      "baseline-ran",
      args.baselineAggregate.runnableRepeats > 0,
      "baseline must have at least one non-skipped repeat",
    ),
    check(
      "candidate-ran",
      args.candidateAggregate.runnableRepeats > 0,
      "candidate must have at least one non-skipped repeat",
    ),
    check(
      "capability-metadata",
      allRows.every(hasModelCapabilityEvidence),
      "baseline and candidate must have explicit model capability evidence",
    ),
    check(
      "plan-evidence",
      args.baselineTraceSummaryPath !== null &&
        args.candidateTraceSummaryPath !== null,
      "both rows must expose trace-summary plan evidence",
    ),
    check(
      "test-evidence",
      testCommandComparable && allRows.every((row) => row.verification !== null && row.verification.command === baselineVerification?.command),
      "both rows must run the same verification command with explicit pass/fail results",
    ),
    check(
      "latency-evidence",
      args.baselineDuration !== null && args.candidateDuration !== null,
      "both rows must have runnable duration evidence",
    ),
    check(
      "cost-evidence",
      args.baselineCost !== null && args.candidateCost !== null && allRows.every((row) => row.estimatedCostUsd !== null),
      "both rows must report estimated cost evidence",
    ),
    check(
      "eval-harness-model-evidence",
      allRows.every(evalHarnessModelEvidenceMatches),
      "eval fixture rows must prove their resolved harness/model matched the declared matrix row",
    ),
  ];
}
