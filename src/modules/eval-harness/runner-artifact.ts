
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionProfilePreflightResult, FixtureRun } from "./fixture-run.js";
import type { ObservedObjectiveMetric } from "./objective-metrics.js";
import type { FixturePredicate, PredicateEvalResult, PredicateExpectationEvalResult } from "./predicates.js";
import type { VerifierCalibrationRunResult, WorkflowExecutionOutcome } from "./runner-types.js";

export function writeRunArtifact(
  runArtifactDir: string,
  payload: {
    run: FixtureRun;
    fixtureId: string;
    workflowName: string;
    workingDir: string;
    executionOutcome: WorkflowExecutionOutcome;
    executionProfile: ExecutionProfilePreflightResult;
    predicates: readonly FixturePredicate[];
    preRunExpectationResults: PredicateExpectationEvalResult[];
    predicateResults: PredicateEvalResult[];
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
          workflowName: payload.workflowName,
          workingDir: payload.workingDir,
        },
        execution: payload.executionOutcome,
        predicates: payload.predicates,
        preRunExpectations: payload.preRunExpectationResults.map((result) => ({
          predicate: result.predicate,
          expected: result.expected,
        })),
        preRunExpectationResults: payload.preRunExpectationResults,
        predicateResults: payload.predicateResults,
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
