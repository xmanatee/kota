
import type { FixtureRoundSpec, LoadedFixture } from "./fixture.js";
import type { ExecutionProfilePreflightResult } from "./fixture-run.js";
import { fixtureScoringContext } from "./fixture-scoring-context.js";
import { evaluateObjectiveMetricsForOutcome } from "./objective-metrics.js";
import { evaluatePredicateExpectations, evaluatePredicates } from "./predicates.js";
import {
  applyRoundTaskInput,
  usesAgentStepReplay,
} from "./runner-materialize.js";
import { outcomeFromExecution } from "./runner-outcome.js";
import type {
  RoundRunReport,
  WorkflowAgentExecutionOverride,
  WorkflowExecutionOutcome,
  WorkflowExecutor,
} from "./runner-types.js";

export async function executeRound(params: {
  round: FixtureRoundSpec;
  roundIndex: number;
  fixture: LoadedFixture;
  executor: WorkflowExecutor;
  executionProfile: ExecutionProfilePreflightResult;
  agentExecutionOverride?: WorkflowAgentExecutionOverride;
  workingDir: string;
  shimDir: string | null;
  runIndex: number;
  repeatCount: number;
}): Promise<RoundRunReport> {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  let executionOutcome: WorkflowExecutionOutcome;
  const triggerPayload = applyRoundTaskInput(
    params.round.taskInput,
    params.fixture.fixtureDir,
    params.workingDir,
  );
  const scoringContext = fixtureScoringContext({
    capabilities: params.executor.predicateContext,
    fixture: params.fixture,
    executionProfile: params.executionProfile,
  });
  const preRunSanity = await evaluatePredicateExpectations(
    params.workingDir,
    params.round.preRunExpectations,
    scoringContext,
  );
  if (!preRunSanity.passed) {
    executionOutcome = {
      kind: "not-started",
      durationMs: Date.now() - startMs,
      reason: "pre-run-sanity-failed",
      runArtifactPath: null,
    };
    return {
      round: params.round,
      roundIndex: params.roundIndex,
      executionOutcome,
      outcome: outcomeFromExecution(executionOutcome, false),
      preRunExpectationResults: preRunSanity.results,
      predicateResults: [],
      objectiveMetrics: [],
      objectiveMetricErrors: [],
      timing: {
        startedAt: startedAt.toISOString(),
        durationMs: executionOutcome.durationMs,
        budgetMs: params.round.budgetMs,
      },
    };
  }

  try {
    executionOutcome = await params.executor.execute({
      workflowName: params.round.workflowName,
      workingDir: params.workingDir,
      budgetMs: params.round.budgetMs,
      executionProfile: params.executionProfile,
      ...(params.agentExecutionOverride !== undefined && {
        agentExecutionOverride: params.agentExecutionOverride,
      }),
      ...(triggerPayload !== undefined && { triggerPayload }),
      ...(usesAgentStepReplay(
        params.fixture,
        params.agentExecutionOverride !== undefined,
      ) && {
        replayRecordingsRoot: params.fixture.fixtureDir,
      }),
      ...(params.shimDir !== null && { externalCallShimDir: params.shimDir }),
    });
  } catch (err) {
    executionOutcome = {
      kind: "error",
      durationMs: Date.now() - startMs,
      message: err instanceof Error ? err.message : String(err),
      runArtifactPath: null,
    };
  }

  const { passed, results } = await evaluatePredicates(
    params.workingDir,
    params.round.predicates,
    scoringContext,
  );
  const outcome = outcomeFromExecution(executionOutcome, passed);
  const { objectiveMetrics, objectiveMetricErrors } =
    await evaluateObjectiveMetricsForOutcome({
      fixtureId: params.fixture.spec.id,
      metricSpecs: params.round.objectiveMetrics ?? [],
      workingDir: params.workingDir,
      executionProfile: params.executionProfile,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      outcome,
      scoringContext,
    });
  return {
    round: params.round,
    roundIndex: params.roundIndex,
    executionOutcome,
    outcome,
    preRunExpectationResults: preRunSanity.results,
    predicateResults: results,
    objectiveMetrics,
    objectiveMetricErrors,
    timing: {
      startedAt: startedAt.toISOString(),
      durationMs: executionOutcome.durationMs,
      budgetMs: params.round.budgetMs,
    },
  };
}
