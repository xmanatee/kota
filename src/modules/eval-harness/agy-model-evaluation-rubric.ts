import type {
  AgyChangedPathScope,
  AgyScenarioRubric,
} from "./agy-model-evaluation-types.js";
import { evaluateAgyInstructionAdherence } from "./agy-model-instruction-trace.js";
import type { FixtureRunReport } from "./runner.js";

function percentage(passed: number, total: number): number {
  if (total === 0) return 0;
  return Number(((passed / total) * 100).toFixed(2));
}

export function changedPathScopeFromRun(
  report: FixtureRunReport,
): AgyChangedPathScope {
  const scopeResults = report.predicateResults.filter(
    (result) => result.predicate.kind === "git-changes-within",
  );
  if (scopeResults.length !== 1) {
    return {
      allowedPaths: [],
      changedPaths: [],
      unexpectedPaths: [],
      passed: false,
      detail:
        `AGY scenario requires exactly one git-changes-within predicate; ` +
        `observed ${scopeResults.length}.`,
    };
  }
  const result = scopeResults[0];
  if (result.predicate.kind !== "git-changes-within") {
    throw new Error("Filtered git-changes-within result lost its predicate kind.");
  }
  const allowedPaths = [...result.predicate.allowedPaths].sort();
  const changedPaths = [...(result.changedPaths ?? [])].sort();
  const allowed = new Set(allowedPaths);
  const unexpectedPaths = changedPaths.filter((path) => !allowed.has(path));
  return {
    allowedPaths,
    changedPaths,
    unexpectedPaths,
    passed: result.passed && unexpectedPaths.length === 0,
    detail: result.detail,
  };
}

export function scoreAgyScenarioRun(
  report: FixtureRunReport,
  pathScope: AgyChangedPathScope = changedPathScopeFromRun(report),
): AgyScenarioRubric {
  const instruction = evaluateAgyInstructionAdherence(report);
  const instructionPassedCount = instruction.checks.filter(
    (check) => check.passed,
  ).length;
  const executionCompleted = report.executionOutcome.kind === "completed";
  const instructionPassed =
    executionCompleted &&
    instruction.checks.length > 0 &&
    instructionPassedCount === instruction.checks.length;
  const instructionScore = executionCompleted
    ? percentage(instructionPassedCount, instruction.checks.length)
    : 0;
  const outcomePassed = report.run.outcome === "pass";
  const items = [
    {
      id: "instruction-adherence" as const,
      score: instructionScore,
      passed: instructionPassed,
      detail:
        `${instructionPassedCount}/${instruction.checks.length} instruction checks passed; ` +
        `workflow execution ${executionCompleted ? "completed" : report.executionOutcome.kind}; ` +
        instruction.detail,
    },
    {
      id: "changed-path-scope" as const,
      score: pathScope.passed ? 100 : 0,
      passed: pathScope.passed,
      detail: pathScope.detail,
    },
    {
      id: "scenario-outcome" as const,
      score: outcomePassed ? 100 : 0,
      passed: outcomePassed,
      detail: `Fixture outcome: ${report.run.outcome}.`,
    },
  ];
  const score = Number(
    (
      items.reduce((total, item) => total + item.score, 0) / items.length
    ).toFixed(2),
  );
  return {
    score,
    passed: items.every((item) => item.passed),
    items,
  };
}
