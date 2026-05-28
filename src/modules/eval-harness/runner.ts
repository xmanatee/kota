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
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
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
  type FixtureRoundSpec,
  type FixtureRoundTaskInput,
  isMultiRoundFixtureSpec,
  type LoadedFixture,
  type MultiRoundFixtureSpecFile,
} from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRoundRun,
  FixtureRun,
  FixtureRunOutcome,
  ResourceProfile,
} from "./fixture-run.js";
import { resourceProfileFromExecutionProfile } from "./fixture-run.js";
import { applyFixtureTemplates } from "./fixture-templating.js";
import {
  evaluateObjectiveMetrics,
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
      reason: "pre-run-sanity-failed";
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
function materializeFixtureWorkingDir(fixture: LoadedFixture): {
  workingDir: string;
  shimDir: string | null;
} {
  const workingDir = mkdtempSync(
    join(tmpdir(), `kota-eval-${fixture.spec.id}-`),
  );
  cpSync(fixture.initialStateDir, workingDir, { recursive: true });
  // Rewrite `{{NOW_MINUS_HOURS:N}}` / `{{NOW_MINUS_MINUTES:N}}` placeholders so
  // fixtures that depend on a sliding time window (e.g. improver reading a
  // "failed in the last 24h" run under .kota/runs/) stay deterministic
  // without a second setup surface. No-op for fixtures without templates.
  applyFixtureTemplates(workingDir, Date.now());
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
  const resolved = resolve(root, relativePath);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`${label} must stay inside ${root}; got ${relativePath}.`);
  }
  if (resolved === root) {
    throw new Error(`${label} must point at a file below ${root}.`);
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
 * Run a single fixture attempt. Single-workflow fixtures get an isolated
 * tmpdir per attempt; multi-round fixtures get one isolated tmpdir per
 * attempt and preserve it across their ordered rounds.
 */
export async function runFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  if (isMultiRoundFixtureSpec(params.fixture.spec)) {
    return runMultiRoundFixture(params);
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
