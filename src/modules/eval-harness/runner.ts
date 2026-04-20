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

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedFixture } from "./fixture.js";
import type { FixtureRun, FixtureRunOutcome, ResourceProfile } from "./fixture-run.js";
import type { FixturePredicate, PredicateEvalResult } from "./predicates.js";
import { evaluatePredicates } from "./predicates.js";

/** Input passed to a WorkflowExecutor for a single fixture run attempt. */
export type WorkflowExecutionRequest = {
  workflowName: string;
  /** Absolute path to the isolated fixture working directory. */
  workingDir: string;
  /** Hard budget for this attempt in ms. The executor must return by then. */
  budgetMs: number;
};

/** Outcome a WorkflowExecutor reports back to the runner. */
export type WorkflowExecutionOutcome =
  | { kind: "completed"; durationMs: number; runArtifactPath: string | null }
  | { kind: "timeout"; durationMs: number; runArtifactPath: string | null }
  | { kind: "error"; durationMs: number; message: string; runArtifactPath: string | null };

/**
 * Pluggable workflow executor. The harness stays agnostic about *how* the
 * workflow runs (in-process, subprocess, remote daemon); the production
 * executor reuses the existing workflow runtime while tests inject a mock.
 */
export type WorkflowExecutor = {
  execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionOutcome>;
};

export type RunFixtureParams = {
  fixture: LoadedFixture;
  executor: WorkflowExecutor;
  resourceProfile: ResourceProfile;
  /** Where this run's artifact directory should live. */
  runArtifactBaseDir: string;
  runIndex: number;
  repeatCount: number;
};

export type FixtureRunReport = {
  run: FixtureRun;
  predicateResults: PredicateEvalResult[];
  workingDir: string;
  executionOutcome: WorkflowExecutionOutcome;
};

/**
 * Materialize the fixture's initial state into a fresh working directory.
 * The directory is created under the OS tmp dir by default so harness runs
 * never mutate the operator's repo even if something misbehaves.
 */
function materializeFixtureWorkingDir(fixture: LoadedFixture): string {
  const workingDir = mkdtempSync(
    join(tmpdir(), `kota-eval-${fixture.spec.id}-`),
  );
  cpSync(fixture.initialStateDir, workingDir, { recursive: true });
  return workingDir;
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
    predicates: readonly FixturePredicate[];
    predicateResults: PredicateEvalResult[];
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
        predicateResults: payload.predicateResults,
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
  const workingDir = materializeFixtureWorkingDir(params.fixture);
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  let executionOutcome: WorkflowExecutionOutcome;
  try {
    executionOutcome = await params.executor.execute({
      workflowName: params.fixture.spec.workflowName,
      workingDir,
      budgetMs: params.fixture.spec.budgetMs,
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

  const runArtifactDir = join(
    params.runArtifactBaseDir,
    `${params.fixture.spec.id}-${params.runIndex}`,
  );
  const run: FixtureRun = {
    fixtureId: params.fixture.spec.id,
    runIndex: params.runIndex,
    repeatCount: params.repeatCount,
    outcome,
    resourceProfile: params.resourceProfile,
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
    predicates: params.fixture.spec.predicates,
    predicateResults: results,
  });

  return { run, predicateResults: results, workingDir, executionOutcome };
}

/**
 * Clean up a fixture run's working directory. Callers control when this
 * happens so post-run debugging (inspecting files the agent produced) stays
 * possible in failing CI.
 */
export function cleanupFixtureWorkingDir(workingDir: string): void {
  rmSync(workingDir, { recursive: true, force: true });
}
