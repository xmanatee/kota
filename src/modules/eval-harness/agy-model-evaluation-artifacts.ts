import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  changedPathScopeFromRun,
  scoreAgyScenarioRun,
} from "./agy-model-evaluation-rubric.js";
import {
  AGY_MODEL_EVALUATION_EFFORT,
  AGY_MODEL_EVALUATION_HARNESS,
  AGY_MODEL_EVALUATION_NATIVE_EFFORT,
  AGY_MODEL_EVALUATION_SCENARIOS,
  type AgyCandidateEvaluationReport,
  type AgyScenarioRunVerdict,
} from "./agy-model-evaluation-types.js";
import type { EvalSetReport } from "./eval-set.js";
import { toRunConfigurationOperatorSummary } from "./run-configuration.js";
import {
  cleanupFixtureWorkingDir,
  type FixtureRunReport,
} from "./runner.js";

function workflowTraceSource(report: FixtureRunReport): string | null {
  const source = report.executionOutcome.runArtifactPath;
  if (source === null || !existsSync(source)) return null;
  const workingDir = resolve(report.workingDir);
  const resolvedSource = resolve(source);
  const relativeSource = relative(workingDir, resolvedSource);
  if (
    relativeSource === "" ||
    relativeSource.startsWith("..") ||
    resolve(workingDir, relativeSource) !== resolvedSource
  ) {
    throw new Error(
      `Workflow trace path escaped fixture working directory: ${source}.`,
    );
  }
  return resolvedSource;
}

function relativeArtifactPath(root: string, artifactPath: string): string {
  const relativePath = relative(root, artifactPath);
  if (relativePath.startsWith("..")) {
    throw new Error(`AGY artifact escaped suite root: ${artifactPath}.`);
  }
  return relativePath;
}

function recordScenarioVerdict(params: {
  suiteArtifactDir: string;
  candidate: string;
  scenario: (typeof AGY_MODEL_EVALUATION_SCENARIOS)[number];
  report: FixtureRunReport;
}): AgyScenarioRunVerdict {
  const runArtifactDir = params.report.run.runArtifactPath;
  mkdirSync(runArtifactDir, { recursive: true });
  const pathScope = changedPathScopeFromRun(params.report);
  const rubric = scoreAgyScenarioRun(params.report, pathScope);
  const traceArtifactPath = join(runArtifactDir, "agy-execution-trace.json");
  writeFileSync(
    traceArtifactPath,
    JSON.stringify(
      {
        model: params.candidate,
        harness: AGY_MODEL_EVALUATION_HARNESS,
        effort: AGY_MODEL_EVALUATION_EFFORT,
        nativeEffort: AGY_MODEL_EVALUATION_NATIVE_EFFORT,
        execution: params.report.executionOutcome,
      },
      null,
      2,
    ),
  );
  const pathScopeArtifact = join(runArtifactDir, "changed-path-scope.json");
  writeFileSync(pathScopeArtifact, JSON.stringify(pathScope, null, 2));
  const rubricArtifact = join(runArtifactDir, "rubric-verdict.json");
  writeFileSync(rubricArtifact, JSON.stringify(rubric, null, 2));

  const traceSource = workflowTraceSource(params.report);
  const workflowTraceArtifact =
    traceSource === null ? null : join(runArtifactDir, "workflow-trace");
  if (traceSource !== null && workflowTraceArtifact !== null) {
    cpSync(traceSource, workflowTraceArtifact, { recursive: true });
  }
  return {
    scenario: params.scenario.kind,
    fixtureId: params.scenario.fixtureId,
    model: params.candidate,
    runIndex: params.report.run.runIndex,
    repeatCount: params.report.run.repeatCount,
    outcome: params.report.run.outcome,
    changedPathScope: pathScope,
    rubric,
    traceArtifactPath: relativeArtifactPath(
      params.suiteArtifactDir,
      traceArtifactPath,
    ),
    workflowTraceArtifactPath:
      workflowTraceArtifact === null
        ? null
        : relativeArtifactPath(
            params.suiteArtifactDir,
            workflowTraceArtifact,
          ),
    passed: rubric.passed,
  };
}

export function collectAgyCandidateReport(params: {
  suiteArtifactDir: string;
  candidateArtifactDir: string;
  candidate: string;
  execution: EvalSetReport;
  keepWorkingDirs: boolean;
}): AgyCandidateEvaluationReport {
  const scenarioByFixture = new Map<
    string,
    (typeof AGY_MODEL_EVALUATION_SCENARIOS)[number]
  >(
    AGY_MODEL_EVALUATION_SCENARIOS.map((scenario) => [
      scenario.fixtureId,
      scenario,
    ]),
  );
  const scenarioVerdicts: AgyScenarioRunVerdict[] = [];
  try {
    for (const runReport of params.execution.runReports) {
      const scenario = scenarioByFixture.get(runReport.run.fixtureId);
      if (scenario === undefined) {
        throw new Error(
          `Unexpected fixture "${runReport.run.fixtureId}" in AGY candidate report.`,
        );
      }
      scenarioVerdicts.push(
        recordScenarioVerdict({
          suiteArtifactDir: params.suiteArtifactDir,
          candidate: params.candidate,
          scenario,
          report: runReport,
        }),
      );
    }
  } finally {
    if (!params.keepWorkingDirs) {
      for (const runReport of params.execution.runReports) {
        cleanupFixtureWorkingDir(runReport.workingDir);
      }
    }
  }
  const rubricScore =
    scenarioVerdicts.length === 0
      ? 0
      : Number(
          (
            scenarioVerdicts.reduce(
              (total, verdict) => total + verdict.rubric.score,
              0,
            ) / scenarioVerdicts.length
          ).toFixed(2),
        );
  const report: AgyCandidateEvaluationReport = {
    model: params.candidate,
    harness: AGY_MODEL_EVALUATION_HARNESS,
    effort: AGY_MODEL_EVALUATION_EFFORT,
    nativeEffort: AGY_MODEL_EVALUATION_NATIVE_EFFORT,
    scenarioRunCount: scenarioVerdicts.length,
    rubricScore,
    passAtK: params.execution.aggregate.passAtK,
    passHatK: params.execution.aggregate.passHatK,
    passed:
      scenarioVerdicts.length > 0 &&
      scenarioVerdicts.every((verdict) => verdict.passed),
    objectiveMetrics: params.execution.objectiveMetrics,
    resourceProfile: params.execution.resourceProfile,
    executionProfile: params.execution.executionProfile,
    runConfiguration: toRunConfigurationOperatorSummary(
      params.execution.runConfiguration,
    ),
    scenarioVerdicts,
    artifactDir: params.candidateArtifactDir,
  };
  writeFileSync(
    join(params.candidateArtifactDir, "candidate-report.json"),
    JSON.stringify(report, null, 2),
  );
  return report;
}
