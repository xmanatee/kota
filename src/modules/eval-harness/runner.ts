/**
 * Fixture runner for the autonomy eval harness.
 *
 * The runner owns the fixture execution lifecycle:
 *   1. Materialize the fixture initial state into an isolated working
 *      directory so autonomy writes cannot touch the operator's repo.
 *   2. Invoke the workflow through the pluggable `WorkflowExecutor` —
 *      production hosts inject a real executor; tests inject a mock so unit
 *      tests never spend LLM time.
 *   3. Evaluate the fixture's predicates against the working directory.
 *   4. Emit a `FixtureRun` artifact and a typed record back to the caller.
 *
 * The runner is explicitly budget-aware: a workflow that exceeds
 * `fixture.spec.budgetMs` records a `timeout` outcome distinct from `fail`,
 * preserving the signal that separates "capability miss" from "no time to
 * produce an answer".
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { readImportedSkillRecords } from "#core/modules/imported-skills.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  type CodeHealthDiagnostics,
  type CodeHealthMeasurement,
  type CodeHealthRoundDiagnostics,
  evaluateCodeHealthRound,
  finalizeCodeHealthDiagnostics,
  measureCodeHealth,
} from "./code-health-diagnostics.js";
import { installExternalCallShims } from "./external-call-shim.js";
import {
  type FixtureJsonValue,
  type FixtureRoundSpec,
  type FixtureRoundTaskInput,
  isMultiRoundFixtureSpec,
  isSkillAblationFixtureSpec,
  type LoadedFixture,
  type MultiRoundFixtureSpecFile,
  type SkillAblationFixtureSpecFile,
  type SkillAblationVariantSpec,
  type VerifierCalibrationCaseSpec,
  type VerifierCalibrationSetupOperation,
  verifierCalibrationPredicatesForSpec,
} from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRoundRun,
  FixtureRun,
  FixtureRunOutcome,
  ResourceProfile,
  SkillAblationObjectiveMetric,
  SkillAblationPromptNeedleResult,
  SkillAblationPromptResolution,
  SkillAblationResolvedSkill,
  SkillAblationRun,
  SkillAblationUsageFacts,
  SkillAblationVariantRun,
} from "./fixture-run.js";
import { resourceProfileFromExecutionProfile } from "./fixture-run.js";
import { applyFixtureTemplates } from "./fixture-templating.js";
import {
  evaluateObjectiveMetrics,
  type ObjectiveMetricDirection,
  type ObjectiveMetricSpec,
  ObjectiveMetricValidationError,
  type ObservedObjectiveMetric,
} from "./objective-metrics.js";
import type {
  FixturePredicate,
  PredicateEvalResult,
  PredicateExpectationEvalResult,
} from "./predicates.js";
import {
  evaluatePredicateExpectations,
  evaluatePredicates,
} from "./predicates.js";

/** Input passed to a WorkflowExecutor for a single fixture run attempt. */
export type WorkflowExecutionRequest = {
  workflowName: string;
  /** Absolute path to the isolated fixture working directory. */
  workingDir: string;
  /** Hard budget for this attempt in ms. The executor must return by then. */
  budgetMs: number;
  /**
   * Execution preflight selected for the whole eval set. Container-backed
   * executors use this to bind each run to the verified resource profile.
   */
  executionProfile?: ExecutionProfilePreflightResult;
  /**
   * Optional trigger payload for workflows whose `trigger.payload` is
   * load-bearing. Forwarded verbatim by the executor — no defaulting.
   */
  triggerPayload?: Record<string, unknown>;
  /**
   * Absolute path to the fixture directory when its `recordings/` tree has
   * at least one agent-step recording. The subprocess executor forwards
   * this via `KOTA_EVAL_HARNESS_REPLAY_ROOT` so the eval-harness module
   * installs its replay adapter in place of the claude-agent-sdk
   * registration inside the child. Absent for smoke fixtures whose
   * workflows never invoke an agent step.
   */
  replayRecordingsRoot?: string;
  /**
   * Absolute path to the fixture-scoped fake-binary shim directory. When
   * set, the subprocess executor prepends this directory to `PATH` so any
   * shadowed binary (e.g. `gh`) resolves to the recording shim instead of
   * the host's real binary. Absent when the fixture declared no
   * `externalCallShims`.
   */
  externalCallShimDir?: string;
};

/** Outcome a WorkflowExecutor reports back to the runner. */
export type WorkflowExecutionOutcome =
  | { kind: "completed"; durationMs: number; runArtifactPath: string | null }
  | { kind: "timeout"; durationMs: number; runArtifactPath: string | null }
  | { kind: "error"; durationMs: number; message: string; runArtifactPath: string | null }
  | {
      kind: "not-started";
      durationMs: number;
      reason: "pre-run-sanity-failed" | "verifier-calibration-failed";
      runArtifactPath: null;
    };

/**
 * Pluggable workflow executor. The harness stays agnostic about *how* the
 * workflow runs (in-process, subprocess, remote daemon); the production
 * executor reuses the existing workflow runtime while tests inject a mock.
 */
export type WorkflowExecutor = {
  preflight(requestedProfile: ResourceProfile): ExecutionProfilePreflightResult;
  execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionOutcome>;
};

export type RunFixtureParams = {
  fixture: LoadedFixture;
  executor: WorkflowExecutor;
  executionProfile: ExecutionProfilePreflightResult;
  /** Where this run's artifact directory should live. */
  runArtifactBaseDir: string;
  runIndex: number;
  repeatCount: number;
};

export type FixtureRunReport = {
  run: FixtureRun;
  predicateResults: PredicateEvalResult[];
  preRunExpectationResults: PredicateExpectationEvalResult[];
  objectiveMetrics: ObservedObjectiveMetric[];
  workingDir: string;
  executionOutcome: WorkflowExecutionOutcome;
};

type RoundRunReport = {
  round: FixtureRoundSpec;
  roundIndex: number;
  executionOutcome: WorkflowExecutionOutcome;
  outcome: FixtureRunOutcome;
  preRunExpectationResults: PredicateExpectationEvalResult[];
  predicateResults: PredicateEvalResult[];
  objectiveMetrics: ObservedObjectiveMetric[];
  timing: {
    startedAt: string;
    durationMs: number;
    budgetMs: number;
  };
};

type SerializedCalibrationError = {
  name: string;
  message: string;
  reason?: string;
  fixtureId?: string | null;
  metricName?: string | null;
};

type VerifierCalibrationCaseResult = {
  id: VerifierCalibrationCaseSpec["id"];
  expected: VerifierCalibrationCaseSpec["expected"];
  setup: readonly VerifierCalibrationSetupOperation[];
  passed: boolean;
  scoringPassed: boolean;
  predicateResults: PredicateEvalResult[];
  objectiveMetrics: ObservedObjectiveMetric[];
  objectiveMetricError?: SerializedCalibrationError;
  detail: string;
};

type VerifierCalibrationObjectiveMetricComparison = {
  name: string;
  direction: ObjectiveMetricDirection;
  passed: boolean;
  goldenValue?: number;
  nullValue?: number;
  adversarialValue?: number;
  detail: string;
};

type VerifierCalibrationRunResult = {
  fixtureId: string;
  passed: boolean;
  calibratedPredicates: readonly FixturePredicate[];
  objectiveMetricCount: number;
  objectiveMetricComparisons: readonly VerifierCalibrationObjectiveMetricComparison[];
  cases: readonly VerifierCalibrationCaseResult[];
};

function runGitSync(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter((s) => s && s.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}${detail ? `: ${detail}` : ""}`,
    );
  }
}

/**
 * Initialize a git repo inside the fixture working directory so workflows
 * whose steps shell out to git (writeScope enforcement, commit step) see
 * a coherent repo. Seeds an initial commit of the fixture's `initial/`
 * tree so every later mutation shows up as a proper diff against HEAD,
 * matching how workflows inspect state in a real repo.
 */
function initFixtureGit(workingDir: string): void {
  runGitSync(workingDir, ["init", "--quiet", "--initial-branch=main"]);
  runGitSync(workingDir, ["config", "user.email", "eval-harness@kota.local"]);
  runGitSync(workingDir, ["config", "user.name", "KOTA Eval Harness"]);
  runGitSync(workingDir, ["config", "commit.gpgsign", "false"]);
  runGitSync(workingDir, ["add", "-A"]);
  // `git commit` refuses an empty tree; fixtures always seed at least
  // `initial/…`, but allow an empty commit just in case so the invariant
  // "HEAD exists" holds universally for later diffs.
  runGitSync(workingDir, [
    "commit",
    "--allow-empty",
    "-m",
    "eval-harness fixture initial state",
    "--quiet",
  ]);
}

/**
 * Materialize the fixture's initial state into a fresh working directory.
 * The directory is created under the OS tmp dir by default so harness runs
 * never mutate the operator's repo even if something misbehaves.
 */
function applySetupOperation(params: {
  fixtureDir: string;
  workingDir: string;
  operation: VerifierCalibrationSetupOperation;
  sourceLabel: string;
  targetLabel: string;
}): void {
  const source = relativePathInside(
    params.fixtureDir,
    params.operation.sourcePath,
    params.sourceLabel,
  );
  const target = relativePathInside(
    params.workingDir,
    params.operation.targetPath,
    params.targetLabel,
  );
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(
      `${params.sourceLabel} ${params.operation.sourcePath} must reference an existing fixture file.`,
    );
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

function materializeFixtureWorkingDirAt(params: {
  fixture: LoadedFixture;
  workingDir: string;
  setup?: readonly VerifierCalibrationSetupOperation[];
}): {
  workingDir: string;
  shimDir: string | null;
} {
  const { fixture, workingDir } = params;
  mkdirSync(workingDir, { recursive: true });
  cpSync(fixture.initialStateDir, workingDir, { recursive: true });
  // Rewrite `{{NOW_MINUS_HOURS:N}}` / `{{NOW_MINUS_MINUTES:N}}` placeholders so
  // fixtures that depend on a sliding time window (e.g. improver reading a
  // "failed in the last 24h" run under .kota/runs/) stay deterministic
  // without a second setup surface. No-op for fixtures without templates.
  applyFixtureTemplates(workingDir, Date.now());
  for (const operation of params.setup ?? []) {
    applySetupOperation({
      fixtureDir: fixture.fixtureDir,
      workingDir,
      operation,
      sourceLabel: "variant setup sourcePath",
      targetLabel: "variant setup targetPath",
    });
  }
  initFixtureGit(workingDir);
  let shimDir: string | null = null;
  if (
    fixture.spec.externalCallShims !== undefined &&
    fixture.spec.externalCallShims.length > 0
  ) {
    const installed = installExternalCallShims(
      workingDir,
      fixture.spec.externalCallShims,
    );
    shimDir = installed.shimDir;
  }
  return { workingDir, shimDir };
}

function materializeFixtureWorkingDir(fixture: LoadedFixture): {
  workingDir: string;
  shimDir: string | null;
} {
  return materializeFixtureWorkingDirAt({
    fixture,
    workingDir: mkdtempSync(join(tmpdir(), `kota-eval-${fixture.spec.id}-`)),
  });
}

function outcomeFromExecution(
  execution: WorkflowExecutionOutcome,
  predicatesPassed: boolean,
): FixtureRunOutcome {
  switch (execution.kind) {
    case "completed":
      return predicatesPassed ? "pass" : "fail";
    case "timeout":
      return "timeout";
    case "error":
      return "error";
    case "not-started":
      return "configuration-error";
  }
}

function writeRunArtifact(
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

function codeHealthBaselineFor(
  workingDir: string,
  spec: LoadedFixture["spec"],
): CodeHealthMeasurement | undefined {
  if (spec.codeHealthDiagnostics === undefined) return undefined;
  return measureCodeHealth(workingDir, spec.codeHealthDiagnostics);
}

function finalCodeHealthFor(params: {
  workingDir: string;
  spec: LoadedFixture["spec"];
  baseline: CodeHealthMeasurement | undefined;
  outcome: FixtureRunOutcome;
}): CodeHealthDiagnostics | undefined {
  if (
    params.spec.codeHealthDiagnostics === undefined ||
    params.baseline === undefined
  ) {
    return undefined;
  }
  const round = evaluateCodeHealthRound({
    config: params.spec.codeHealthDiagnostics,
    workingDir: params.workingDir,
    baseline: params.baseline,
    previous: params.baseline,
    roundId: "final",
    roundIndex: 0,
    outcome: params.outcome,
  });
  return finalizeCodeHealthDiagnostics({
    config: params.spec.codeHealthDiagnostics,
    baseline: params.baseline,
    rounds: [round],
  });
}

function relativePathInside(root: string, relativePath: string, label: string): string {
  if (relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const absoluteRoot = resolve(root);
  const resolved = resolve(absoluteRoot, relativePath);
  const rootWithSep = absoluteRoot.endsWith(sep)
    ? absoluteRoot
    : `${absoluteRoot}${sep}`;
  if (resolved !== absoluteRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`${label} must stay inside ${absoluteRoot}; got ${relativePath}.`);
  }
  if (resolved === absoluteRoot) {
    throw new Error(`${label} must point at a file below ${absoluteRoot}.`);
  }
  return resolved;
}

function applyRoundTaskInput(
  taskInput: FixtureRoundTaskInput,
  fixtureDir: string,
  workingDir: string,
): WorkflowExecutionRequest["triggerPayload"] | undefined {
  switch (taskInput.kind) {
    case "initial-state":
      return undefined;
    case "trigger-payload":
      return taskInput.payload;
    case "copy-fixture-file": {
      const source = relativePathInside(
        fixtureDir,
        taskInput.sourcePath,
        "round taskInput.sourcePath",
      );
      const target = relativePathInside(
        workingDir,
        taskInput.targetPath,
        "round taskInput.targetPath",
      );
      if (!existsSync(source) || !statSync(source).isFile()) {
        throw new Error(
          `round taskInput.sourcePath ${taskInput.sourcePath} must reference an existing fixture file.`,
        );
      }
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target);
      return undefined;
    }
  }
}

function collectObjectiveMetricSpecs(
  spec: LoadedFixture["spec"],
): ObjectiveMetricSpec[] {
  if (isMultiRoundFixtureSpec(spec)) {
    return [
      ...spec.rounds.flatMap((round) => round.objectiveMetrics ?? []),
      ...(spec.aggregateObjectiveMetrics ?? []),
    ];
  }
  if (isSkillAblationFixtureSpec(spec)) {
    return [];
  }
  return [...(spec.objectiveMetrics ?? [])];
}

function serializeCalibrationError(error: Error): SerializedCalibrationError {
  if (error instanceof ObjectiveMetricValidationError) {
    return {
      name: error.name,
      message: error.message,
      reason: error.reason,
      fixtureId: error.fixtureId,
      metricName: error.metricName,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return {
    name: "NonErrorThrown",
    message: String(error),
  };
}

function applyVerifierCalibrationSetup(params: {
  fixtureDir: string;
  workingDir: string;
  operation: VerifierCalibrationSetupOperation;
}): void {
  switch (params.operation.kind) {
    case "copy-fixture-file": {
      const source = relativePathInside(
        params.fixtureDir,
        params.operation.sourcePath,
        "verifierCalibration setup sourcePath",
      );
      const target = relativePathInside(
        params.workingDir,
        params.operation.targetPath,
        "verifierCalibration setup targetPath",
      );
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target);
      break;
    }
  }
}

function evaluateVerifierCalibrationCase(params: {
  fixture: LoadedFixture;
  caseSpec: VerifierCalibrationCaseSpec;
  predicates: readonly FixturePredicate[];
  objectiveMetricSpecs: readonly ObjectiveMetricSpec[];
  executionProfile: ExecutionProfilePreflightResult;
  runIndex: number;
  repeatCount: number;
}): VerifierCalibrationCaseResult {
  const { workingDir } = materializeFixtureWorkingDir(params.fixture);
  try {
    for (const operation of params.caseSpec.setup) {
      applyVerifierCalibrationSetup({
        fixtureDir: params.fixture.fixtureDir,
        workingDir,
        operation,
      });
    }
    const predicateEvaluation = evaluatePredicates(workingDir, params.predicates);
    let objectiveMetrics: ObservedObjectiveMetric[] = [];
    let objectiveMetricError: SerializedCalibrationError | undefined;
    try {
      objectiveMetrics = evaluateObjectiveMetrics({
        fixtureId: params.fixture.spec.id,
        metricSpecs: params.objectiveMetricSpecs,
        workingDir,
        executionProfile: params.executionProfile,
        runIndex: params.runIndex,
        repeatCount: params.repeatCount,
      });
    } catch (error) {
      objectiveMetricError =
        error instanceof Error
          ? serializeCalibrationError(error)
          : {
              name: "NonErrorThrown",
              message: String(error),
            };
    }
    const hasPredicates = params.predicates.length > 0;
    const scoringPassed = hasPredicates
      ? predicateEvaluation.passed
      : objectiveMetricError === undefined;
    const expectedPassed = params.caseSpec.expected === "pass";
    const expectedMatched = hasPredicates
      ? scoringPassed === expectedPassed
      : expectedPassed
        ? objectiveMetricError === undefined
        : true;
    const metricsMatched = !expectedPassed || objectiveMetricError === undefined;
    const passed = expectedMatched && metricsMatched;
    const detail = passed
      ? `case "${params.caseSpec.id}" matched expected verifier ${params.caseSpec.expected}`
      : `case "${params.caseSpec.id}" expected verifier ${params.caseSpec.expected} but observed ${scoringPassed ? "pass" : "fail"}${
          expectedPassed && objectiveMetricError !== undefined
            ? ` with objective metric error: ${objectiveMetricError.message}`
            : ""
        }`;
    return {
      id: params.caseSpec.id,
      expected: params.caseSpec.expected,
      setup: params.caseSpec.setup,
      passed,
      scoringPassed,
      predicateResults: predicateEvaluation.results,
      objectiveMetrics,
      ...(objectiveMetricError !== undefined && { objectiveMetricError }),
      detail,
    };
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
}

function metricValue(
  caseResult: VerifierCalibrationCaseResult,
  metricName: string,
): number | undefined {
  return caseResult.objectiveMetrics.find((metric) => metric.name === metricName)
    ?.value;
}

function metricIsBetter(params: {
  direction: ObjectiveMetricDirection;
  goldenValue: number;
  candidateValue: number;
}): boolean {
  return params.direction === "higher_is_better"
    ? params.goldenValue > params.candidateValue
    : params.goldenValue < params.candidateValue;
}

function appendMetricFailure(
  failures: Map<VerifierCalibrationCaseSpec["id"], string[]>,
  caseId: VerifierCalibrationCaseSpec["id"],
  detail: string,
): void {
  const existing = failures.get(caseId) ?? [];
  existing.push(detail);
  failures.set(caseId, existing);
}

function compareObjectiveMetricCalibration(params: {
  objectiveMetricSpecs: readonly ObjectiveMetricSpec[];
  cases: readonly VerifierCalibrationCaseResult[];
}): {
  cases: readonly VerifierCalibrationCaseResult[];
  comparisons: readonly VerifierCalibrationObjectiveMetricComparison[];
} {
  if (params.objectiveMetricSpecs.length === 0) {
    return { cases: params.cases, comparisons: [] };
  }

  const casesById = new Map(params.cases.map((caseResult) => [caseResult.id, caseResult]));
  const golden = casesById.get("golden");
  const metricFailures = new Map<VerifierCalibrationCaseSpec["id"], string[]>();
  const comparisons = params.objectiveMetricSpecs.map((metricSpec) => {
    const goldenValue =
      golden === undefined ? undefined : metricValue(golden, metricSpec.name);
    const values: {
      goldenValue?: number;
      nullValue?: number;
      adversarialValue?: number;
    } = {
      ...(goldenValue !== undefined && { goldenValue }),
    };

    if (goldenValue === undefined) {
      appendMetricFailure(
        metricFailures,
        "golden",
        `golden case did not produce objective metric "${metricSpec.name}"`,
      );
      return {
        name: metricSpec.name,
        direction: metricSpec.direction,
        passed: false,
        ...values,
        detail: `golden case did not produce objective metric "${metricSpec.name}"`,
      };
    }

    const failedCaseDetails: string[] = [];
    for (const caseId of ["null", "adversarial"] as const) {
      const caseResult = casesById.get(caseId);
      if (caseResult === undefined || caseResult.objectiveMetricError !== undefined) {
        continue;
      }
      const candidateValue = metricValue(caseResult, metricSpec.name);
      if (candidateValue === undefined) {
        const detail = `${caseId} case did not produce objective metric "${metricSpec.name}"`;
        appendMetricFailure(metricFailures, caseId, detail);
        failedCaseDetails.push(detail);
        continue;
      }
      if (caseId === "null") {
        values.nullValue = candidateValue;
      } else {
        values.adversarialValue = candidateValue;
      }
      if (
        !metricIsBetter({
          direction: metricSpec.direction,
          goldenValue,
          candidateValue,
        })
      ) {
        const detail = `${caseId} objective metric "${metricSpec.name}" value ${candidateValue} was not worse than golden value ${goldenValue}`;
        appendMetricFailure(metricFailures, caseId, detail);
        failedCaseDetails.push(detail);
      }
    }

    return {
      name: metricSpec.name,
      direction: metricSpec.direction,
      passed: failedCaseDetails.length === 0,
      ...values,
      detail:
        failedCaseDetails.length === 0
          ? `golden objective metric "${metricSpec.name}" was better than null and adversarial numeric values, or those cases failed metric evaluation`
          : failedCaseDetails.join("; "),
    };
  });

  return {
    cases: params.cases.map((caseResult) => {
      const failures = metricFailures.get(caseResult.id) ?? [];
      if (failures.length === 0) return caseResult;
      return {
        ...caseResult,
        passed: false,
        detail: `${caseResult.detail}; objective metric calibration failed: ${failures.join("; ")}`,
      };
    }),
    comparisons,
  };
}

function evaluateVerifierCalibration(params: {
  fixture: LoadedFixture;
  executionProfile: ExecutionProfilePreflightResult;
  runIndex: number;
  repeatCount: number;
}): VerifierCalibrationRunResult | undefined {
  const spec = params.fixture.spec.verifierCalibration;
  if (spec === undefined) return undefined;
  const predicates = verifierCalibrationPredicatesForSpec(params.fixture.spec);
  const objectiveMetricSpecs = collectObjectiveMetricSpecs(params.fixture.spec);
  const cases = spec.cases.map((caseSpec) =>
    evaluateVerifierCalibrationCase({
      fixture: params.fixture,
      caseSpec,
      predicates,
      objectiveMetricSpecs,
      executionProfile: params.executionProfile,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
    }),
  );
  const objectiveMetricCalibration = compareObjectiveMetricCalibration({
    objectiveMetricSpecs,
    cases,
  });
  return {
    fixtureId: params.fixture.spec.id,
    passed:
      objectiveMetricCalibration.cases.every((entry) => entry.passed) &&
      objectiveMetricCalibration.comparisons.every((entry) => entry.passed),
    calibratedPredicates: predicates,
    objectiveMetricCount: objectiveMetricSpecs.length,
    objectiveMetricComparisons: objectiveMetricCalibration.comparisons,
    cases: objectiveMetricCalibration.cases,
  };
}

function writeVerifierCalibrationArtifact(
  runArtifactDir: string,
  result: VerifierCalibrationRunResult,
): void {
  mkdirSync(runArtifactDir, { recursive: true });
  writeFileSync(
    join(runArtifactDir, "verifier-calibration.json"),
    JSON.stringify(result, null, 2),
  );
}

async function executeRound(params: {
  round: FixtureRoundSpec;
  roundIndex: number;
  fixture: LoadedFixture;
  executor: WorkflowExecutor;
  executionProfile: ExecutionProfilePreflightResult;
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
  const preRunSanity = evaluatePredicateExpectations(
    params.workingDir,
    params.round.preRunExpectations,
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
      ...(triggerPayload !== undefined && { triggerPayload }),
      ...(params.fixture.agentStepRecordings.length > 0 && {
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

  const { passed, results } = evaluatePredicates(
    params.workingDir,
    params.round.predicates,
  );
  const outcome = outcomeFromExecution(executionOutcome, passed);
  const objectiveMetrics = evaluateObjectiveMetrics({
    fixtureId: params.fixture.spec.id,
    metricSpecs: params.round.objectiveMetrics ?? [],
    workingDir: params.workingDir,
    executionProfile: params.executionProfile,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
  });
  return {
    round: params.round,
    roundIndex: params.roundIndex,
    executionOutcome,
    outcome,
    preRunExpectationResults: preRunSanity.results,
    predicateResults: results,
    objectiveMetrics,
    timing: {
      startedAt: startedAt.toISOString(),
      durationMs: executionOutcome.durationMs,
      budgetMs: params.round.budgetMs,
    },
  };
}

function roundRunSummary(result: RoundRunReport): FixtureRoundRun {
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

function writeMultiRoundRunArtifact(
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function resolveSkillsPromptEvidence(params: {
  workingDir: string;
  variant: SkillAblationVariantSpec;
}): {
  resolvedPrompt: string;
  resolvedSkills: SkillAblationResolvedSkill[];
} {
  const loader = new ModuleLoader({}, false, { mode: "commands" });
  loader.setCwd(params.workingDir);
  const resolvedPrompt = loader.getSkillsPromptFor(
    [...params.variant.selectedSkills],
    params.variant.agentName,
  );
  const records = readImportedSkillRecords(params.workingDir);
  const recordsByName = new Map(records.map((record) => [record.def.name, record]));
  const resolvedSkills: SkillAblationResolvedSkill[] =
    params.variant.selectedSkills.map((name) => {
      const record = recordsByName.get(name);
      if (record === undefined) {
        return {
          name,
          expectedProvenance: params.variant.skillProvenance,
          resolved: false,
          provenance: "unresolved",
          promptPath: null,
          importedFrom: null,
          resourceSummary: null,
          importedFiles: [],
        };
      }
      return {
        name,
        expectedProvenance: params.variant.skillProvenance,
        resolved: true,
        provenance: "imported",
        promptPath: record.def.promptPath,
        importedFrom: record.provenance ?? null,
        resourceSummary: record.resourceSummary ?? null,
        importedFiles: record.importedFiles ?? [],
      };
    });
  return { resolvedPrompt, resolvedSkills };
}

function readAgentInputArtifact(
  runArtifactPath: string | null,
  agentStepId: string,
): { path: string | null; text: string | null } {
  if (runArtifactPath === null) return { path: null, text: null };
  const path = join(runArtifactPath, "steps", `${agentStepId}.input.md`);
  if (!existsSync(path) || !statSync(path).isFile()) {
    return { path, text: null };
  }
  return { path, text: readFileSync(path, "utf8") };
}

function evaluateRequiredNeedles(
  text: string | null,
  needles: readonly string[] | undefined,
): SkillAblationPromptNeedleResult[] {
  return (needles ?? []).map((needle) => {
    const present = text?.includes(needle) ?? false;
    return { needle, present, passed: present };
  });
}

function evaluateForbiddenNeedles(
  text: string | null,
  needles: readonly string[] | undefined,
): SkillAblationPromptNeedleResult[] {
  return (needles ?? []).map((needle) => {
    const present = text?.includes(needle) ?? false;
    return { needle, present, passed: !present };
  });
}

function evaluatePromptResolution(params: {
  workingDir: string;
  variant: SkillAblationVariantSpec;
  executionOutcome: WorkflowExecutionOutcome;
}): SkillAblationPromptResolution {
  const { resolvedPrompt, resolvedSkills } = resolveSkillsPromptEvidence({
    workingDir: params.workingDir,
    variant: params.variant,
  });
  const agentInput = readAgentInputArtifact(
    params.executionOutcome.runArtifactPath,
    params.variant.agentStepId,
  );
  const requiredNeedles = evaluateRequiredNeedles(
    agentInput.text,
    params.variant.promptEvidence.requiredNeedles,
  );
  const forbiddenNeedles = evaluateForbiddenNeedles(
    agentInput.text,
    params.variant.promptEvidence.forbiddenNeedles,
  );
  const selectedSkillsResolved =
    params.variant.skillProvenance === "none"
      ? params.variant.selectedSkills.length === 0 && resolvedSkills.length === 0
      : resolvedSkills.length === params.variant.selectedSkills.length &&
        resolvedSkills.every((skill) => skill.resolved && skill.provenance === "imported");
  const needlesPassed =
    requiredNeedles.every((result) => result.passed) &&
    forbiddenNeedles.every((result) => result.passed);
  const passed =
    selectedSkillsResolved &&
    agentInput.text !== null &&
    needlesPassed;
  const detail = passed
    ? `variant "${params.variant.id}" prompt evidence matched selected skill set`
    : `variant "${params.variant.id}" prompt evidence failed: ${
        selectedSkillsResolved ? "" : "selected skills did not resolve; "
      }${agentInput.text === null ? "agent input artifact missing; " : ""}${
        needlesPassed ? "" : "prompt needles did not match"
      }`.trimEnd();
  return {
    agentName: params.variant.agentName,
    agentStepId: params.variant.agentStepId,
    selectedSkills: params.variant.selectedSkills,
    resolutionSource: "ModuleLoader.getSkillsPromptFor",
    resolvedPromptHash: sha256(resolvedPrompt),
    resolvedPromptLength: resolvedPrompt.length,
    agentInputPath: agentInput.path,
    agentInputFound: agentInput.text !== null,
    requiredNeedles,
    forbiddenNeedles,
    resolvedSkills,
    passed,
    detail,
  };
}

type AgentStepUsageFile = {
  output?: {
    turns?: FixtureJsonValue;
    totalCostUsd?: FixtureJsonValue;
    inputTokens?: FixtureJsonValue;
    outputTokens?: FixtureJsonValue;
    subtype?: FixtureJsonValue;
  };
};

function nullableNumber(value: FixtureJsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: FixtureJsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function readAgentStepUsage(
  runArtifactPath: string | null,
  agentStepId: string,
): SkillAblationUsageFacts {
  const empty: SkillAblationUsageFacts = {
    turns: null,
    totalCostUsd: null,
    inputTokens: null,
    outputTokens: null,
    subtype: null,
  };
  if (runArtifactPath === null) return empty;
  const path = join(runArtifactPath, "steps", `${agentStepId}.json`);
  if (!existsSync(path) || !statSync(path).isFile()) return empty;
  let parsed: AgentStepUsageFile;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as AgentStepUsageFile;
  } catch {
    return empty;
  }
  return {
    turns: nullableNumber(parsed.output?.turns),
    totalCostUsd: nullableNumber(parsed.output?.totalCostUsd),
    inputTokens: nullableNumber(parsed.output?.inputTokens),
    outputTokens: nullableNumber(parsed.output?.outputTokens),
    subtype: nullableString(parsed.output?.subtype),
  };
}

function skillAblationObjectiveMetrics(
  variant: SkillAblationVariantSpec,
  predicateResults: readonly PredicateEvalResult[],
): SkillAblationObjectiveMetric[] {
  const passedCount = predicateResults.filter((result) => result.passed).length;
  const total = predicateResults.length;
  return [
    {
      name: `${variant.id}.predicate_pass_rate`,
      unit: "ratio",
      direction: "higher_is_better",
      source: "predicate-results",
      value: total === 0 ? 0 : passedCount / total,
    },
  ];
}

function topLevelObjectiveMetricsForSkillAblation(params: {
  fixtureId: string;
  variantRuns: readonly SkillAblationVariantRun[];
  executionProfile: ExecutionProfilePreflightResult;
  runIndex: number;
  repeatCount: number;
}): ObservedObjectiveMetric[] {
  const resourceProfile = resourceProfileFromExecutionProfile(
    params.executionProfile,
  );
  const executionProfile =
    params.executionProfile.status === "verified"
      ? {
          status: params.executionProfile.status,
          backendKind: params.executionProfile.backendKind,
          verification: params.executionProfile.verification,
          gateEligible: params.executionProfile.gateEligible,
          reason: params.executionProfile.eligibilityReason,
        }
      : params.executionProfile.status === "rejected"
        ? {
            status: params.executionProfile.status,
            backendKind: params.executionProfile.backendKind,
            verification: params.executionProfile.verification,
            gateEligible: params.executionProfile.gateEligible,
            reason: params.executionProfile.rejectionReason,
          }
        : {
            status: params.executionProfile.status,
            backendKind: params.executionProfile.backendKind,
            verification: params.executionProfile.verification,
            gateEligible: params.executionProfile.gateEligible,
            reason: params.executionProfile.nonGatingReason,
          };
  return params.variantRuns.flatMap((variantRun) =>
    variantRun.objectiveMetrics.map((metric) => ({
      fixtureId: params.fixtureId,
      name: metric.name,
      unit: metric.unit,
      direction: metric.direction,
      source: {
        kind: "text-file" as const,
        path: `skill-ablation:${variantRun.id}`,
      },
      value: metric.value,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      resourceProfile,
      executionProfile,
    })),
  );
}

function evaluateSkillAblationDirection(params: {
  spec: SkillAblationFixtureSpecFile;
  variants: readonly SkillAblationVariantRun[];
}): boolean {
  const byId = new Map(params.variants.map((variant) => [variant.id, variant]));
  const direction = params.spec.expectedDirection;
  const control = byId.get(direction.controlVariantId);
  const treatment = byId.get(direction.treatmentVariantId);
  if (control === undefined || treatment === undefined) return false;
  return control.observedOutcome === "fail" && treatment.observedOutcome === "pass";
}

function summarizeSkillAblationOutcome(
  variants: readonly SkillAblationVariantRun[],
  directionPassed: boolean,
): FixtureRunOutcome {
  if (variants.some((variant) => variant.observedOutcome === "error")) {
    return "error";
  }
  if (variants.some((variant) => variant.observedOutcome === "timeout")) {
    return "timeout";
  }
  if (
    variants.some((variant) => variant.observedOutcome === "configuration-error")
  ) {
    return "configuration-error";
  }
  return variants.every((variant) => variant.expectationPassed) && directionPassed
    ? "pass"
    : "fail";
}

function skillAblationExecutionOutcome(
  outcome: FixtureRunOutcome,
  durationMs: number,
): WorkflowExecutionOutcome {
  if (outcome === "timeout") {
    return { kind: "timeout", durationMs, runArtifactPath: null };
  }
  if (outcome === "error") {
    return {
      kind: "error",
      durationMs,
      message: "one or more skill-ablation variants errored",
      runArtifactPath: null,
    };
  }
  if (outcome === "configuration-error") {
    return {
      kind: "not-started",
      durationMs,
      reason: "pre-run-sanity-failed",
      runArtifactPath: null,
    };
  }
  return { kind: "completed", durationMs, runArtifactPath: null };
}

function writeSkillAblationRunArtifact(
  runArtifactDir: string,
  payload: {
    run: FixtureRun;
    fixtureId: string;
    workingDir: string;
    executionProfile: ExecutionProfilePreflightResult;
    skillAblation: SkillAblationRun;
    objectiveMetrics: ObservedObjectiveMetric[];
    executionOutcome: WorkflowExecutionOutcome;
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
          mode: "skill-ablation",
          workingDir: payload.workingDir,
        },
        executionProfile: payload.executionProfile,
        execution: payload.executionOutcome,
        skillAblation: payload.skillAblation,
        objectiveMetrics: payload.objectiveMetrics,
      },
      null,
      2,
    ),
  );
}

async function runSingleWorkflowFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  const spec = params.fixture.spec;
  if (spec.mode !== "single-workflow") {
    throw new Error(
      `runSingleWorkflowFixture received non-single fixture "${spec.id}".`,
    );
  }
  const { workingDir, shimDir } = materializeFixtureWorkingDir(params.fixture);
  const codeHealthBaseline = codeHealthBaselineFor(workingDir, spec);
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  let executionOutcome: WorkflowExecutionOutcome;
  const preRunSanity = evaluatePredicateExpectations(
    workingDir,
    spec.preRunExpectations,
  );
  const resourceProfile = resourceProfileFromExecutionProfile(
    params.executionProfile,
  );
  const runArtifactDir = join(
    params.runArtifactBaseDir,
    `${params.fixture.spec.id}-${params.runIndex}`,
  );
  const verifierCalibration = evaluateVerifierCalibration({
    fixture: params.fixture,
    executionProfile: params.executionProfile,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
  });
  if (verifierCalibration !== undefined) {
    writeVerifierCalibrationArtifact(runArtifactDir, verifierCalibration);
  }
  if (verifierCalibration !== undefined && !verifierCalibration.passed) {
    executionOutcome = {
      kind: "not-started",
      durationMs: Date.now() - startMs,
      reason: "verifier-calibration-failed",
      runArtifactPath: null,
    };
    const codeHealthDiagnostics =
      spec.codeHealthDiagnostics !== undefined && codeHealthBaseline !== undefined
        ? finalizeCodeHealthDiagnostics({
            config: spec.codeHealthDiagnostics,
            baseline: codeHealthBaseline,
            rounds: [],
          })
        : undefined;
    const run: FixtureRun = {
      fixtureId: params.fixture.spec.id,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      outcome: outcomeFromExecution(executionOutcome, false),
      resourceProfile,
      executionProfile: params.executionProfile,
      objectiveMetrics: [],
      ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
      timing: {
        startedAt: startedAt.toISOString(),
        durationMs: executionOutcome.durationMs,
        budgetMs: spec.budgetMs,
      },
      runArtifactPath: runArtifactDir,
    };
    writeRunArtifact(runArtifactDir, {
      run,
      fixtureId: spec.id,
      workflowName: spec.workflowName,
      workingDir,
      executionOutcome,
      executionProfile: params.executionProfile,
      predicates: spec.predicates,
      preRunExpectationResults: [],
      predicateResults: [],
      objectiveMetrics: [],
      verifierCalibration,
    });
    return {
      run,
      predicateResults: [],
      preRunExpectationResults: [],
      objectiveMetrics: [],
      workingDir,
      executionOutcome,
    };
  }
  if (!preRunSanity.passed) {
    executionOutcome = {
      kind: "not-started",
      durationMs: Date.now() - startMs,
      reason: "pre-run-sanity-failed",
      runArtifactPath: null,
    };
    const codeHealthDiagnostics =
      spec.codeHealthDiagnostics !== undefined && codeHealthBaseline !== undefined
        ? finalizeCodeHealthDiagnostics({
            config: spec.codeHealthDiagnostics,
            baseline: codeHealthBaseline,
            rounds: [],
          })
        : undefined;
    const run: FixtureRun = {
      fixtureId: params.fixture.spec.id,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      outcome: outcomeFromExecution(executionOutcome, false),
      resourceProfile,
      executionProfile: params.executionProfile,
      objectiveMetrics: [],
      ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
      timing: {
        startedAt: startedAt.toISOString(),
        durationMs: executionOutcome.durationMs,
        budgetMs: spec.budgetMs,
      },
      runArtifactPath: runArtifactDir,
    };
    writeRunArtifact(runArtifactDir, {
      run,
      fixtureId: spec.id,
      workflowName: spec.workflowName,
      workingDir,
      executionOutcome,
      executionProfile: params.executionProfile,
      predicates: spec.predicates,
      preRunExpectationResults: preRunSanity.results,
      predicateResults: [],
      objectiveMetrics: [],
      ...(verifierCalibration !== undefined && { verifierCalibration }),
    });
    return {
      run,
      predicateResults: [],
      preRunExpectationResults: preRunSanity.results,
      objectiveMetrics: [],
      workingDir,
      executionOutcome,
    };
  }
  try {
    executionOutcome = await params.executor.execute({
      workflowName: spec.workflowName,
      workingDir,
      budgetMs: spec.budgetMs,
      executionProfile: params.executionProfile,
      ...(spec.triggerPayload !== undefined && {
        triggerPayload: spec.triggerPayload,
      }),
      ...(params.fixture.agentStepRecordings.length > 0 && {
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

  const { passed, results } = evaluatePredicates(
    workingDir,
    spec.predicates,
  );
  const outcome = outcomeFromExecution(executionOutcome, passed);
  const codeHealthDiagnostics = finalCodeHealthFor({
    workingDir,
    spec,
    baseline: codeHealthBaseline,
    outcome,
  });
  const objectiveMetrics = evaluateObjectiveMetrics({
    fixtureId: spec.id,
    metricSpecs: spec.objectiveMetrics ?? [],
    workingDir,
    executionProfile: params.executionProfile,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
  });

  const run: FixtureRun = {
    fixtureId: params.fixture.spec.id,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
    outcome,
    resourceProfile,
    executionProfile: params.executionProfile,
    objectiveMetrics,
    ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
    timing: {
      startedAt: startedAt.toISOString(),
      durationMs: executionOutcome.durationMs,
      budgetMs: spec.budgetMs,
    },
    runArtifactPath: runArtifactDir,
  };

  writeRunArtifact(runArtifactDir, {
    run,
    fixtureId: spec.id,
    workflowName: spec.workflowName,
    workingDir,
    executionOutcome,
    executionProfile: params.executionProfile,
    predicates: spec.predicates,
    preRunExpectationResults: preRunSanity.results,
    predicateResults: results,
    objectiveMetrics,
    ...(verifierCalibration !== undefined && { verifierCalibration }),
  });

  return {
    run,
    predicateResults: results,
    preRunExpectationResults: preRunSanity.results,
    objectiveMetrics,
    workingDir,
    executionOutcome,
  };
}

async function executeSkillAblationVariant(params: {
  fixture: LoadedFixture;
  spec: SkillAblationFixtureSpecFile;
  variant: SkillAblationVariantSpec;
  variantIndex: number;
  executor: WorkflowExecutor;
  executionProfile: ExecutionProfilePreflightResult;
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
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const preRunSanity = evaluatePredicateExpectations(
    params.workingDir,
    params.variant.preRunExpectations,
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
      ...(params.variant.triggerPayload !== undefined && {
        triggerPayload: params.variant.triggerPayload,
      }),
      ...(params.fixture.agentStepRecordings.length > 0 && {
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
  const predicateEvaluation = evaluatePredicates(
    params.workingDir,
    params.variant.predicates,
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

async function runSkillAblationFixture(
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
    const variantWorkingDir = join(parentWorkingDir, variant.id);
    const variantRun = await executeSkillAblationVariant({
      fixture: params.fixture,
      spec,
      variant,
      variantIndex,
      executor: params.executor,
      executionProfile: params.executionProfile,
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
    outcome,
    resourceProfile,
    executionProfile: params.executionProfile,
    objectiveMetrics,
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
    workingDir: parentWorkingDir,
    executionOutcome,
  };
}

async function runMultiRoundFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  const spec = params.fixture.spec;
  if (spec.mode !== "multi-round") {
    throw new Error(
      `runMultiRoundFixture received non-multi-round fixture "${spec.id}".`,
    );
  }
  const { workingDir, shimDir } = materializeFixtureWorkingDir(params.fixture);
  const codeHealthBaseline = codeHealthBaselineFor(workingDir, spec);
  const codeHealthRounds: CodeHealthRoundDiagnostics[] = [];
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const resourceProfile = resourceProfileFromExecutionProfile(
    params.executionProfile,
  );
  const runArtifactDir = join(
    params.runArtifactBaseDir,
    `${spec.id}-${params.runIndex}`,
  );
  const verifierCalibration = evaluateVerifierCalibration({
    fixture: params.fixture,
    executionProfile: params.executionProfile,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
  });
  if (verifierCalibration !== undefined) {
    writeVerifierCalibrationArtifact(runArtifactDir, verifierCalibration);
  }
  if (verifierCalibration !== undefined && !verifierCalibration.passed) {
    const executionOutcome: WorkflowExecutionOutcome = {
      kind: "not-started",
      durationMs: Date.now() - startMs,
      reason: "verifier-calibration-failed",
      runArtifactPath: null,
    };
    const codeHealthDiagnostics =
      spec.codeHealthDiagnostics !== undefined && codeHealthBaseline !== undefined
        ? finalizeCodeHealthDiagnostics({
            config: spec.codeHealthDiagnostics,
            baseline: codeHealthBaseline,
            rounds: [],
          })
        : undefined;
    const run: FixtureRun = {
      fixtureId: spec.id,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      outcome: outcomeFromExecution(executionOutcome, false),
      resourceProfile,
      executionProfile: params.executionProfile,
      objectiveMetrics: [],
      ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
      rounds: [],
      timing: {
        startedAt: startedAt.toISOString(),
        durationMs: executionOutcome.durationMs,
        budgetMs: spec.rounds.reduce((sum, round) => sum + round.budgetMs, 0),
      },
      runArtifactPath: runArtifactDir,
    };
    writeMultiRoundRunArtifact(runArtifactDir, {
      run,
      fixtureId: spec.id,
      workingDir,
      executionProfile: params.executionProfile,
      spec,
      roundResults: [],
      aggregatePredicateResults: [],
      objectiveMetrics: [],
      verifierCalibration,
    });
    return {
      run,
      predicateResults: [],
      preRunExpectationResults: [],
      objectiveMetrics: [],
      workingDir,
      executionOutcome,
    };
  }

  const roundResults: RoundRunReport[] = [];
  for (let roundIndex = 0; roundIndex < spec.rounds.length; roundIndex++) {
    const round = spec.rounds[roundIndex];
    const roundResult = await executeRound({
      round,
      roundIndex,
      fixture: params.fixture,
      executor: params.executor,
      executionProfile: params.executionProfile,
      workingDir,
      shimDir,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
    });
    roundResults.push(roundResult);
    if (
      spec.codeHealthDiagnostics !== undefined &&
      codeHealthBaseline !== undefined
    ) {
      const previous =
        codeHealthRounds[codeHealthRounds.length - 1]?.measurement ??
        codeHealthBaseline;
      codeHealthRounds.push(
        evaluateCodeHealthRound({
          config: spec.codeHealthDiagnostics,
          workingDir,
          baseline: codeHealthBaseline,
          previous,
          roundId: round.id,
          roundIndex,
          outcome: roundResult.outcome,
        }),
      );
    }
    if (roundResult.outcome !== "pass") break;
  }

  let aggregatePredicateResults: PredicateEvalResult[] = [];
  let aggregatePredicatesPassed = true;
  let objectiveMetrics: ObservedObjectiveMetric[] = [];
  const failedRound = roundResults.find((result) => result.outcome !== "pass");
  if (failedRound === undefined) {
    const aggregate = evaluatePredicates(
      workingDir,
      spec.aggregatePredicates ?? [],
    );
    aggregatePredicateResults = aggregate.results;
    aggregatePredicatesPassed = aggregate.passed;
    objectiveMetrics = evaluateObjectiveMetrics({
      fixtureId: spec.id,
      metricSpecs: spec.aggregateObjectiveMetrics ?? [],
      workingDir,
      executionProfile: params.executionProfile,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
    });
  }

  const outcome: FixtureRunOutcome =
    failedRound !== undefined
      ? failedRound.outcome
      : aggregatePredicatesPassed
        ? "pass"
        : "fail";
  const executionOutcome: WorkflowExecutionOutcome =
    failedRound?.executionOutcome ??
    ({
      kind: "completed",
      durationMs: Date.now() - startMs,
      runArtifactPath:
        roundResults[roundResults.length - 1]?.executionOutcome.runArtifactPath ?? null,
    } satisfies WorkflowExecutionOutcome);
  const codeHealthDiagnostics =
    spec.codeHealthDiagnostics !== undefined && codeHealthBaseline !== undefined
      ? finalizeCodeHealthDiagnostics({
          config: spec.codeHealthDiagnostics,
          baseline: codeHealthBaseline,
          rounds: codeHealthRounds,
        })
      : undefined;
  const run: FixtureRun = {
    fixtureId: spec.id,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
    outcome,
    resourceProfile,
    executionProfile: params.executionProfile,
    objectiveMetrics,
    ...(codeHealthDiagnostics !== undefined && { codeHealthDiagnostics }),
    rounds: roundResults.map(roundRunSummary),
    timing: {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startMs,
      budgetMs: spec.rounds.reduce((sum, round) => sum + round.budgetMs, 0),
    },
    runArtifactPath: runArtifactDir,
  };

  writeMultiRoundRunArtifact(runArtifactDir, {
    run,
    fixtureId: spec.id,
    workingDir,
    executionProfile: params.executionProfile,
    spec,
    roundResults,
    aggregatePredicateResults,
    objectiveMetrics,
    ...(verifierCalibration !== undefined && { verifierCalibration }),
  });

  return {
    run,
    predicateResults:
      failedRound !== undefined
        ? failedRound.predicateResults
        : aggregatePredicateResults,
    preRunExpectationResults:
      failedRound?.preRunExpectationResults ??
      roundResults.flatMap((result) => result.preRunExpectationResults),
    objectiveMetrics,
    workingDir,
    executionOutcome,
  };
}

/**
 * Run a single fixture attempt. Single-workflow fixtures get one isolated
 * tmpdir per attempt; multi-round fixtures preserve one tmpdir across their
 * ordered rounds; skill-ablation fixtures get one parent tmpdir containing
 * one isolated materialized workspace per variant.
 */
export async function runFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  if (isMultiRoundFixtureSpec(params.fixture.spec)) {
    return runMultiRoundFixture(params);
  }
  if (isSkillAblationFixtureSpec(params.fixture.spec)) {
    return runSkillAblationFixture(params);
  }
  return runSingleWorkflowFixture(params);
}

/**
 * Clean up a fixture run's working directory. Callers control when this
 * happens so post-run debugging (inspecting files the agent produced) stays
 * possible in failing CI.
 */
export function cleanupFixtureWorkingDir(workingDir: string): void {
  rmSync(workingDir, { recursive: true, force: true });
}
