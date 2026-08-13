import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import type {
  AgyModelEvaluationOptions,
  AgyModelEvaluationResult,
} from "./agy-model-evaluation-types.js";
import type {
  EvalHarnessClient,
  EvalListResult,
  EvalRunOptions,
  EvalRunResult,
} from "./client.js";
import {
  SAMPLE_CALIBRATION_RESULT,
  SAMPLE_CODE_HEALTH,
  SAMPLE_COMPONENT_ATTRIBUTION,
  SAMPLE_CONTROL_DECISION_COVERAGE,
  SAMPLE_FIXTURE_DIAGNOSTICS,
  SAMPLE_RUN_CONFIGURATION,
} from "./daemon-client-test-support.js";
import {
  listEvalFixtures,
  runEvalCalibration,
  runEvalHarness,
} from "./eval-operations.js";

export function makeFakeCtx(projectDir: string): ModuleContext {
  const evalHarness: EvalHarnessClient = {
    async list() {
      return listEvalFixtures(projectDir);
    },
    async run(options) {
      return runEvalHarness(projectDir, options ?? {});
    },
    async runAgyModels() {
      return {
        ok: false,
        reason: "no_candidates",
        message: "not configured in this test context",
        artifactDir: null,
      };
    },
    async calibration(options) {
      return runEvalCalibration(projectDir, options ?? {});
    },
  };
  const client = { evalHarness } as KotaClient;
  return { cwd: projectDir, client } as ModuleContext;
}

export function makeListCtx(result: EvalListResult): ModuleContext {
  const evalHarness: EvalHarnessClient = {
    async list() {
      return result;
    },
    async run() {
      return {
        ok: true,
        fixtureCount: 0,
        repeatCount: 1,
        passAtK: 1,
        passHatK: 1,
        controlDecisionCoverage: result.controlDecisionCoverage,
        objectiveMetrics: [],
        codeHealth: SAMPLE_CODE_HEALTH,
        fixtureDiagnostics: SAMPLE_FIXTURE_DIAGNOSTICS,
        runConfiguration: SAMPLE_RUN_CONFIGURATION,
        componentAttribution: SAMPLE_COMPONENT_ATTRIBUTION,
        baselineConfigurationComparison: null,
        runArtifactBaseDir: "/tmp/eval-run",
      };
    },
    async runAgyModels() {
      return {
        ok: false,
        reason: "no_candidates",
        message: "not configured in this test context",
        artifactDir: null,
      };
    },
    async calibration() {
      return SAMPLE_CALIBRATION_RESULT;
    },
  };
  const client = { evalHarness } as KotaClient;
  return { cwd: "/tmp/project", client } as ModuleContext;
}

export function makeRunRecordingCtx(
  calls: EvalRunOptions[],
  resultOverrides: Partial<Extract<EvalRunResult, { ok: true }>> = {},
): ModuleContext {
  const evalHarness: EvalHarnessClient = {
    async list() {
      return {
        fixtures: [],
        controlDecisionCoverage: SAMPLE_CONTROL_DECISION_COVERAGE,
      };
    },
    async run(options) {
      calls.push(options ?? {});
      return {
        ok: true,
        fixtureCount: 1,
        repeatCount: options?.repeatCount ?? 1,
        passAtK: 1,
        passHatK: 1,
        controlDecisionCoverage: SAMPLE_CONTROL_DECISION_COVERAGE,
        objectiveMetrics: [],
        codeHealth: SAMPLE_CODE_HEALTH,
        fixtureDiagnostics: SAMPLE_FIXTURE_DIAGNOSTICS,
        runConfiguration: SAMPLE_RUN_CONFIGURATION,
        baselineConfigurationComparison: null,
        runArtifactBaseDir: "/tmp/eval-run",
        ...resultOverrides,
        componentAttribution:
          resultOverrides.componentAttribution ?? SAMPLE_COMPONENT_ATTRIBUTION,
      };
    },
    async runAgyModels() {
      return {
        ok: false,
        reason: "no_candidates",
        message: "not configured in this test context",
        artifactDir: null,
      };
    },
    async calibration() {
      return SAMPLE_CALIBRATION_RESULT;
    },
  };
  const client = { evalHarness } as KotaClient;
  return { cwd: "/tmp/project", client } as ModuleContext;
}

export function makeAgyRecordingCtx(
  calls: AgyModelEvaluationOptions[],
  result: AgyModelEvaluationResult,
): ModuleContext {
  const evalHarness: EvalHarnessClient = {
    async list() {
      return {
        fixtures: [],
        controlDecisionCoverage: SAMPLE_CONTROL_DECISION_COVERAGE,
      };
    },
    async run() {
      return {
        ok: false,
        reason: "no_fixtures",
        message: "unused",
      };
    },
    async runAgyModels(options) {
      calls.push(options);
      return result;
    },
    async calibration() {
      return SAMPLE_CALIBRATION_RESULT;
    },
  };
  const client = { evalHarness } as KotaClient;
  return { cwd: "/tmp/project", client } as ModuleContext;
}

export function seedCalibration(
  runsDir: string,
  runId: string,
  completedAt: string,
  verdict: EvaluatorCalibrationArtifact["verdict"],
  sourceFilesChanged: string[],
): void {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const artifact: EvaluatorCalibrationArtifact = {
    runId,
    workflow: "builder",
    completedAt,
    verdict,
    warningCount: 0,
    criticalIssueCount: 0,
    repairIterations: 1,
    finalIterationFailures: [],
    criticFailureCount: 0,
    terminalRunStatus: verdict === "fail" ? "failed" : "success",
    taskId: null,
    taskFinalState: null,
    sourceFilesChanged,
    criticPromptHash: getCriticPromptHash(),
  };
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify(artifact, null, 2),
  );
}

export { SAMPLE_RUN_CONFIGURATION };
