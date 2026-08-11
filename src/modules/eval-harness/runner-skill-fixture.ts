
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSkillAblationFixtureSpec, type LoadedFixture, type SkillAblationFixtureSpecFile, type SkillAblationVariantSpec } from "./fixture.js";
import { type ExecutionProfilePreflightResult, type FixtureRun, resourceProfileFromExecutionProfile, type SkillAblationRun, type SkillAblationVariantRun } from "./fixture-run.js";
import { fixtureScoringContext } from "./fixture-scoring-context.js";
import { evaluatePredicateExpectations, evaluatePredicates } from "./predicates.js";
import {
  fixtureExecutionMode,
  materializeFixtureWorkingDirAt,
  resolveSkillAblationVariantWorkingDir,
  usesAgentStepReplay,
} from "./runner-materialize.js";
import { outcomeFromExecution } from "./runner-outcome.js";
import { writeSkillAblationRunArtifact } from "./runner-skill-artifact.js";
import { evaluateSkillAblationDirection, skillAblationExecutionOutcome, skillAblationObjectiveMetrics, summarizeSkillAblationOutcome, topLevelObjectiveMetricsForSkillAblation } from "./runner-skill-metrics.js";
import { evaluatePromptResolution, readAgentStepUsage, resolveSkillsPromptEvidence } from "./runner-skill-prompt.js";
import type {
  FixtureRunReport,
  RunFixtureParams,
  WorkflowAgentExecutionOverride,
  WorkflowExecutionOutcome,
  WorkflowExecutor,
} from "./runner-types.js";

async function executeSkillAblationVariant(params: {
  fixture: LoadedFixture;
  spec: SkillAblationFixtureSpecFile;
  variant: SkillAblationVariantSpec;
  variantIndex: number;
  executor: WorkflowExecutor;
  executionProfile: ExecutionProfilePreflightResult;
  agentExecutionOverride?: WorkflowAgentExecutionOverride;
  workingDir: string;
  runIndex: number;
  repeatCount: number;
}): Promise<SkillAblationVariantRun> {
  const { shimDir } = materializeFixtureWorkingDirAt({
    fixture: params.fixture,
    workingDir: params.workingDir,
    setup: params.variant.setup,
  });
  // Resolve imported skills before executing so malformed skill metadata fails
  // through the same loader path the agent step uses, without spending a run.
  resolveSkillsPromptEvidence({
    workingDir: params.workingDir,
    variant: params.variant,
  });
  const scoringContext = fixtureScoringContext({
    capabilities: params.executor.predicateContext,
    fixture: params.fixture,
    executionProfile: params.executionProfile,
  });
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const preRunSanity = await evaluatePredicateExpectations(
    params.workingDir,
    params.variant.preRunExpectations,
    scoringContext,
  );
  let executionOutcome: WorkflowExecutionOutcome;
  if (!preRunSanity.passed) {
    executionOutcome = {
      kind: "not-started",
      durationMs: Date.now() - startMs,
      reason: "pre-run-sanity-failed",
      runArtifactPath: null,
    };
    const promptResolution = evaluatePromptResolution({
      workingDir: params.workingDir,
      variant: params.variant,
      executionOutcome,
    });
    const observedOutcome = outcomeFromExecution(executionOutcome, false);
    return {
      id: params.variant.id,
      variantIndex: params.variantIndex,
      workflowName: params.variant.workflowName,
      agentName: params.variant.agentName,
      agentStepId: params.variant.agentStepId,
      selectedSkills: params.variant.selectedSkills,
      expectedOutcome: params.variant.expectedOutcome,
      observedOutcome,
      expectationPassed: false,
      promptResolution,
      preRunExpectationResults: preRunSanity.results,
      predicateResults: [],
      objectiveMetrics: [],
      timing: {
        startedAt: startedAt.toISOString(),
        durationMs: executionOutcome.durationMs,
        budgetMs: params.spec.budgetMs,
      },
      usage: readAgentStepUsage(null, params.variant.agentStepId),
      runArtifactPath: null,
      workingDir: params.workingDir,
    };
  }
  try {
    executionOutcome = await params.executor.execute({
      workflowName: params.variant.workflowName,
      workingDir: params.workingDir,
      budgetMs: params.spec.budgetMs,
      executionProfile: params.executionProfile,
      ...(params.agentExecutionOverride !== undefined && {
        agentExecutionOverride: params.agentExecutionOverride,
      }),
      ...(params.variant.triggerPayload !== undefined && {
        triggerPayload: params.variant.triggerPayload,
      }),
      ...(usesAgentStepReplay(
        params.fixture,
        params.agentExecutionOverride !== undefined,
      ) && {
        replayRecordingsRoot: params.fixture.fixtureDir,
      }),
      ...(shimDir !== null && { externalCallShimDir: shimDir }),
    });
  } catch (err) {
    executionOutcome = {
      kind: "error",
      durationMs: Date.now() - startMs,
      message: err instanceof Error ? err.message : String(err),
      runArtifactPath: null,
    };
  }
  const predicateEvaluation = await evaluatePredicates(
    params.workingDir,
    params.variant.predicates,
    scoringContext,
  );
  const observedOutcome = outcomeFromExecution(
    executionOutcome,
    predicateEvaluation.passed,
  );
  const promptResolution = evaluatePromptResolution({
    workingDir: params.workingDir,
    variant: params.variant,
    executionOutcome,
  });
  const objectiveMetrics = skillAblationObjectiveMetrics(
    params.variant,
    predicateEvaluation.results,
  );
  const expectationPassed =
    observedOutcome === params.variant.expectedOutcome && promptResolution.passed;
  return {
    id: params.variant.id,
    variantIndex: params.variantIndex,
    workflowName: params.variant.workflowName,
    agentName: params.variant.agentName,
    agentStepId: params.variant.agentStepId,
    selectedSkills: params.variant.selectedSkills,
    expectedOutcome: params.variant.expectedOutcome,
    observedOutcome,
    expectationPassed,
    promptResolution,
    preRunExpectationResults: preRunSanity.results,
    predicateResults: predicateEvaluation.results,
    objectiveMetrics,
    timing: {
      startedAt: startedAt.toISOString(),
      durationMs: executionOutcome.durationMs,
      budgetMs: params.spec.budgetMs,
    },
    usage: readAgentStepUsage(
      executionOutcome.runArtifactPath,
      params.variant.agentStepId,
    ),
    runArtifactPath: executionOutcome.runArtifactPath,
    workingDir: params.workingDir,
  };
}

export async function runSkillAblationFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  const spec = params.fixture.spec;
  if (!isSkillAblationFixtureSpec(spec)) {
    throw new Error(
      `runSkillAblationFixture received non-ablation fixture "${spec.id}".`,
    );
  }
  const parentWorkingDir = mkdtempSync(
    join(tmpdir(), `kota-eval-${spec.id}-`),
  );
  const runArtifactDir = join(
    params.runArtifactBaseDir,
    `${spec.id}-${params.runIndex}`,
  );
  const startedAt = new Date();
  const variantRuns: SkillAblationVariantRun[] = [];
  for (let variantIndex = 0; variantIndex < spec.variants.length; variantIndex++) {
    const variant = spec.variants[variantIndex];
    const variantWorkingDir = resolveSkillAblationVariantWorkingDir(
      parentWorkingDir,
      variant.id,
    );
    const variantRun = await executeSkillAblationVariant({
      fixture: params.fixture,
      spec,
      variant,
      variantIndex,
      executor: params.executor,
      executionProfile: params.executionProfile,
      ...(params.agentExecutionOverride !== undefined && {
        agentExecutionOverride: params.agentExecutionOverride,
      }),
      workingDir: variantWorkingDir,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
    });
    variantRuns.push(variantRun);
  }
  const directionPassed = evaluateSkillAblationDirection({
    spec,
    variants: variantRuns,
  });
  const outcome = summarizeSkillAblationOutcome(variantRuns, directionPassed);
  const durationMs = Date.now() - startedAt.getTime();
  const executionOutcome = skillAblationExecutionOutcome(outcome, durationMs);
  const objectiveMetrics = topLevelObjectiveMetricsForSkillAblation({
    fixtureId: spec.id,
    variantRuns,
    executionProfile: params.executionProfile,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
  });
  const resourceProfile = resourceProfileFromExecutionProfile(
    params.executionProfile,
  );
  const skillAblation: SkillAblationRun = {
    expectedDirection: spec.expectedDirection,
    directionPassed,
    passed: outcome === "pass",
    variants: variantRuns,
  };
  const run: FixtureRun = {
    fixtureId: spec.id,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
    executionMode: fixtureExecutionMode(
      params.fixture,
      params.agentExecutionOverride !== undefined,
    ),
    outcome,
    resourceProfile,
    executionProfile: params.executionProfile,
    objectiveMetrics,
    objectiveMetricErrors: [],
    skillAblation,
    timing: {
      startedAt: startedAt.toISOString(),
      durationMs,
      budgetMs: spec.budgetMs * spec.variants.length,
    },
    runArtifactPath: runArtifactDir,
  };
  writeSkillAblationRunArtifact(runArtifactDir, {
    run,
    fixtureId: spec.id,
    workingDir: parentWorkingDir,
    executionProfile: params.executionProfile,
    skillAblation,
    objectiveMetrics,
    executionOutcome,
  });
  return {
    run,
    predicateResults: variantRuns.flatMap((variant) => variant.predicateResults),
    preRunExpectationResults: variantRuns.flatMap(
      (variant) => variant.preRunExpectationResults,
    ),
    objectiveMetrics,
    objectiveMetricErrors: [],
    workingDir: parentWorkingDir,
    executionOutcome,
  };
}
