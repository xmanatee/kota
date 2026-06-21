
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MultiRoundFixtureSpecFile } from "./fixture.js";
import type { ExecutionProfilePreflightResult, FixtureRoundRun, FixtureRun } from "./fixture-run.js";
import type { ObservedObjectiveMetric } from "./objective-metrics.js";
import type { PredicateEvalResult } from "./predicates.js";
import type { RoundRunReport, VerifierCalibrationRunResult } from "./runner-types.js";

export function roundRunSummary(result: RoundRunReport): FixtureRoundRun {
  return {
    roundId: result.round.id,
    roundIndex: result.roundIndex,
    workflowName: result.round.workflowName,
    outcome: result.outcome,
    objectiveMetrics: result.objectiveMetrics,
    timing: result.timing,
    runArtifactPath: result.executionOutcome.runArtifactPath,
  };
}

export function writeMultiRoundRunArtifact(
  runArtifactDir: string,
  payload: {
    run: FixtureRun;
    fixtureId: string;
    workingDir: string;
    executionProfile: ExecutionProfilePreflightResult;
    spec: MultiRoundFixtureSpecFile;
    roundResults: readonly RoundRunReport[];
    aggregatePredicateResults: readonly PredicateEvalResult[];
    objectiveMetrics: ObservedObjectiveMetric[];
    verifierCalibration?: VerifierCalibrationRunResult;
  },
): void {
  mkdirSync(runArtifactDir, { recursive: true });
  writeFileSync(
    join(runArtifactDir, "fixture-run.json"),
    JSON.stringify(
      {
        ...payload.run,
        fixture: {
          id: payload.fixtureId,
          mode: "multi-round",
          workingDir: payload.workingDir,
        },
        executionProfile: payload.executionProfile,
        rounds: payload.roundResults.map((result) => ({
          id: result.round.id,
          index: result.roundIndex,
          workflowName: result.round.workflowName,
          budgetMs: result.round.budgetMs,
          taskInput: result.round.taskInput,
          outcome: result.outcome,
          execution: result.executionOutcome,
          timing: result.timing,
          preRunExpectations: result.preRunExpectationResults.map((entry) => ({
            predicate: entry.predicate,
            expected: entry.expected,
          })),
          preRunExpectationResults: result.preRunExpectationResults,
          predicates: result.round.predicates,
          predicateResults: result.predicateResults,
          objectiveMetrics: result.objectiveMetrics,
        })),
        aggregatePredicates: payload.spec.aggregatePredicates ?? [],
        aggregatePredicateResults: payload.aggregatePredicateResults,
        objectiveMetrics: payload.objectiveMetrics,
        ...(payload.verifierCalibration !== undefined && {
          verifierCalibration: payload.verifierCalibration,
        }),
      },
      null,
      2,
    ),
  );
}
