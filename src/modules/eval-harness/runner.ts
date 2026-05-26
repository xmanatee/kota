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
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installExternalCallShims } from "./external-call-shim.js";
import type { LoadedFixture } from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
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

function runGitSync(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
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

/**
 * Run a single fixture attempt. Safe to call in a Promise.all for parallel
 * replicas because each attempt gets its own tmp working directory.
 */
export async function runFixture(
  params: RunFixtureParams,
): Promise<FixtureRunReport> {
  const { workingDir, shimDir } = materializeFixtureWorkingDir(params.fixture);
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  let executionOutcome: WorkflowExecutionOutcome;
  const preRunSanity = evaluatePredicateExpectations(
    workingDir,
    params.fixture.spec.preRunExpectations,
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
    const run: FixtureRun = {
      fixtureId: params.fixture.spec.id,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      outcome: outcomeFromExecution(executionOutcome, false),
      resourceProfile,
      executionProfile: params.executionProfile,
      objectiveMetrics: [],
      timing: {
        startedAt: startedAt.toISOString(),
        durationMs: executionOutcome.durationMs,
        budgetMs: params.fixture.spec.budgetMs,
      },
      runArtifactPath: runArtifactDir,
    };
    writeRunArtifact(runArtifactDir, {
      run,
      fixtureId: params.fixture.spec.id,
      workflowName: params.fixture.spec.workflowName,
      workingDir,
      executionOutcome,
      executionProfile: params.executionProfile,
      predicates: params.fixture.spec.predicates,
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
      workflowName: params.fixture.spec.workflowName,
      workingDir,
      budgetMs: params.fixture.spec.budgetMs,
      executionProfile: params.executionProfile,
      ...(params.fixture.spec.triggerPayload !== undefined && {
        triggerPayload: params.fixture.spec.triggerPayload,
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
    params.fixture.spec.predicates,
  );
  const outcome = outcomeFromExecution(executionOutcome, passed);
  const objectiveMetrics = evaluateObjectiveMetrics({
    fixtureId: params.fixture.spec.id,
    metricSpecs: params.fixture.spec.objectiveMetrics ?? [],
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
    timing: {
      startedAt: startedAt.toISOString(),
      durationMs: executionOutcome.durationMs,
      budgetMs: params.fixture.spec.budgetMs,
    },
    runArtifactPath: runArtifactDir,
  };

  writeRunArtifact(runArtifactDir, {
    run,
    fixtureId: params.fixture.spec.id,
    workflowName: params.fixture.spec.workflowName,
    workingDir,
    executionOutcome,
    executionProfile: params.executionProfile,
    predicates: params.fixture.spec.predicates,
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

/**
 * Clean up a fixture run's working directory. Callers control when this
 * happens so post-run debugging (inspecting files the agent produced) stays
 * possible in failing CI.
 */
export function cleanupFixtureWorkingDir(workingDir: string): void {
  rmSync(workingDir, { recursive: true, force: true });
}
