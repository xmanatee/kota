import type {
  EvalAttributionComponentEntry,
  EvalAttributionComponentId,
  EvalAttributionComponentStatus,
  EvalAttributionDiagnosticSummary,
  PriorEvalSetReport,
} from "./eval-attribution-types.js";
import { sameStructuredValue, uniqueSorted } from "./eval-attribution-util.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRun,
  FixtureRunExecutionMode,
} from "./fixture-run.js";
import type { EvalRunConfiguration } from "./run-configuration.js";

export function evidenceChanged(
  prior: EvalAttributionDiagnosticSummary | undefined,
  candidate: EvalAttributionDiagnosticSummary,
): boolean {
  if (prior === undefined) return false;
  return !sameStructuredValue(prior, candidate);
}

export function promptSkillFacts(runs: readonly FixtureRun[]): {
  skillAblationRunCount: number;
  selectedSkills: readonly string[];
  failedPromptResolutionCount: number;
  unresolvedSkillCount: number;
} {
  let failedPromptResolutionCount = 0;
  let unresolvedSkillCount = 0;
  const selectedSkills: string[] = [];
  let skillAblationRunCount = 0;
  for (const run of runs) {
    if (run.skillAblation === undefined) continue;
    skillAblationRunCount += 1;
    for (const variant of run.skillAblation.variants) {
      selectedSkills.push(...variant.selectedSkills);
      if (!variant.promptResolution.passed) failedPromptResolutionCount += 1;
      unresolvedSkillCount += variant.promptResolution.resolvedSkills.filter(
        (skill) => !skill.resolved,
      ).length;
    }
  }
  return {
    skillAblationRunCount,
    selectedSkills: uniqueSorted(selectedSkills),
    failedPromptResolutionCount,
    unresolvedSkillCount,
  };
}

export function fixtureManifestChanged(
  prior: PriorEvalSetReport | null,
  candidate: EvalRunConfiguration,
): boolean {
  return (
    prior !== null &&
    prior.runConfiguration.components.fixtureManifest.hash !==
      candidate.components.fixtureManifest.hash
  );
}

export function tierEvidence(
  preset: EvalRunConfiguration["components"]["activePreset"],
): string {
  return [
    `fast:${preset.tiers.fast}`,
    `balanced:${preset.tiers.balanced}`,
    `capable:${preset.tiers.capable}`,
  ].join(",");
}

export function executionModeEvidence(runs: readonly FixtureRun[]): string {
  const modes = uniqueSorted(
    runs.map((run): FixtureRunExecutionMode => run.executionMode ?? "live"),
  );
  return modes.join(",") || "unknown";
}

export function timeoutEnvelopeEvidence(runs: readonly FixtureRun[]): string {
  if (runs.length === 0) {
    return "runs=0,budgetMs=none,maxDurationMs=0,deadlineHits=0,cleanReturns=0";
  }
  const budgets = runs.map((run) => run.timing.budgetMs);
  const durations = runs.map((run) => run.timing.durationMs);
  const minBudget = Math.min(...budgets);
  const maxBudget = Math.max(...budgets);
  const deadlineHits = runs.filter(
    (run) =>
      run.outcome === "timeout" || run.timing.durationMs >= run.timing.budgetMs,
  ).length;
  const cleanReturns = runs.filter(
    (run) => run.outcome !== "timeout" && run.outcome !== "error",
  ).length;
  const budgetRange =
    minBudget === maxBudget ? String(minBudget) : `${minBudget}-${maxBudget}`;
  return `runs=${runs.length},budgetMs=${budgetRange},maxDurationMs=${Math.max(
    ...durations,
  )},deadlineHits=${deadlineHits},cleanReturns=${cleanReturns}`;
}

export function networkPolicyEvidence(
  policy: ExecutionProfilePreflightResult["networkPolicy"],
): string {
  const endpoints =
    policy.allowedProviderEndpoints
      .map((endpoint) => `${endpoint.protocol}://${endpoint.host}:${endpoint.port}`)
      .join(",") || "none";
  if (policy.kind === "provider-egress") {
    return `${policy.kind}/${policy.provider}/${policy.enforcementMode}/endpoints=${endpoints}/gateEligible=${policy.gateEligible}`;
  }
  return `${policy.kind}/${policy.enforcementMode}/endpoints=${endpoints}/gateEligible=${policy.gateEligible}`;
}

export function component(
  id: EvalAttributionComponentId,
  status: EvalAttributionComponentStatus,
  summary: string,
  evidence: readonly string[],
  candidateExplanation: string | null = null,
): EvalAttributionComponentEntry {
  const labels: { readonly [K in EvalAttributionComponentId]: string } = {
    "model-preset": "model and preset",
    "harness-execution": "harness adapter and execution path",
    "prompt-skill-context": "prompt, skill, and context inputs",
    "fixture-verifier": "fixture and verifier",
    "environment-resource": "environment and resources",
    "feedback-loop": "feedback loop",
  };
  return { id, label: labels[id], status, summary, evidence, candidateExplanation };
}

export function componentStatus(
  hasBaseline: boolean,
  currentIssue: EvalAttributionComponentStatus | null,
  changed: boolean,
  diagnosticDelta = false,
): EvalAttributionComponentStatus {
  if (currentIssue !== null) return currentIssue;
  if (!hasBaseline) return "stable";
  if (diagnosticDelta) return "diagnostic-delta";
  return changed ? "changed" : "stable";
}
