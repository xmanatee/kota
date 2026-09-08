
import type { CodeHealthDiagnosticsConfig } from "./code-health-diagnostics.js";
import type {
  FixtureAutonomyRole,
  FixtureControlDecision,
  FixtureJsonObject,
  FixtureProvenance,
} from "./fixture-common-types.js";
import type { VerifierCalibrationSpec } from "./fixture-verifier-types.js";
import type { ObjectiveMetricSpec } from "./objective-metrics.js";
import type { FixturePredicate, FixturePredicateExpectation } from "./predicates.js";

export type FixtureRoundTaskInput =
  | { kind: "initial-state" }
  | { kind: "copy-fixture-file"; sourcePath: string; targetPath: string }
  | { kind: "trigger-payload"; payload: FixtureJsonObject };

export type FixtureRoundSpec = {
  /** Stable round id, unique within the fixture and ordered by array position. */
  id: string;
  /** The workflow name to invoke for this round. */
  workflowName: string;
  /** Authored task identity; the runtime dispatch digest is resolved after materialization. */
  builderTaskId?: string;
  /**
   * Explicit round budget in milliseconds. A timeout in any round stops the
   * multi-round attempt and records the fixture attempt as `timeout`.
   */
  budgetMs: number;
  /** Explicit source of this round's workflow/task input. */
  taskInput: FixtureRoundTaskInput;
  /** Expectations evaluated immediately before this round executes. */
  preRunExpectations: readonly FixturePredicateExpectation[];
  /** Predicates evaluated immediately after this round executes. */
  predicates: readonly FixturePredicate[];
  /** Optional deterministic numeric metrics evaluated after this round. */
  objectiveMetrics?: readonly ObjectiveMetricSpec[];
};

export type FixtureSpecCommon = {
  /** Stable fixture id; must match the directory name. */
  id: string;
  /** Short human-readable description. */
  description: string;
  /** Autonomy role this fixture scores. */
  role: FixtureAutonomyRole;
  /**
   * Provenance record validated by the loader. Required on every fixture.
   */
  provenance: FixtureProvenance;
  /**
   * Control-decision behaviors this fixture exercises. Diagnostic metadata
   * only; scoring ignores it.
   */
  controlDecisions: readonly FixtureControlDecision[];
  /**
   * Optional tags operators use to slice the fixture set (e.g. "smoke",
   * "regression-2026-04", "slow"). Not load-bearing — scoring does not read
   * them.
   */
  tags?: readonly string[];
  /**
   * Optional deterministic source-tree diagnostics. Fixtures must explicitly
   * name the tracked source globs so generated or vendored files do not skew
   * the measurements.
   */
  codeHealthDiagnostics?: CodeHealthDiagnosticsConfig;
  /**
   * Optional verifier calibration probes for nontrivial scoring paths. Case
   * expectations are fixed: null/adversarial must fail, golden and accepted
   * alternatives must pass.
   */
  verifierCalibration?: VerifierCalibrationSpec;
};

export type SingleWorkflowFixtureSpecFile = FixtureSpecCommon & {
  mode: "single-workflow";
  /** The workflow name to invoke against the fixture's initial state. */
  workflowName: string;
  /** Authored task identity; the runtime dispatch digest is resolved after materialization. */
  builderTaskId?: string;
  /** Exact trigger event being replayed. Absence intentionally means manual. */
  triggerEvent?: string;
  /**
   * Explicit per-run budget in milliseconds. Runs that exceed this budget are
   * recorded as `timeout`, not `fail` — a timeout is evidence the harness ran
   * out of time, which is categorically different from a capability miss.
   */
  budgetMs: number;
  /**
   * Predicates evaluated against the final fixture working directory. The
   * fixture passes only when every predicate passes.
   */
  predicates: readonly FixturePredicate[];
  /**
   * Predicate expectations evaluated against the materialized initial state
   * before the workflow executor starts. At least one expectation must require
   * a predicate to fail initially, proving the fixture is not already in a
   * passing state.
   */
  preRunExpectations: readonly FixturePredicateExpectation[];
  /**
   * Provenance record validated by the loader. Required on every fixture.
   */
  provenance: FixtureProvenance;
  /**
   * Control-decision behaviors this fixture exercises. Diagnostic metadata
   * only; scoring ignores it.
   */
  controlDecisions: readonly FixtureControlDecision[];
  /**
   * Optional trigger payload forwarded verbatim to
   * `kota workflow trigger --payload <json>`. Required for workflows whose
   * `trigger.payload` is load-bearing (e.g. decomposer's `runDir`/`runId`).
   * Strict-protocol rule: absence means "no extra payload"; the subprocess
   * must not synthesize defaults.
   */
  triggerPayload?: FixtureJsonObject;
  /**
   * Optional deterministic numeric objective metrics. Metrics are reported
   * evidence only; pass/fail gating remains exclusively predicate-based.
   */
  objectiveMetrics?: readonly ObjectiveMetricSpec[];
};

export type MultiRoundFixtureSpecFile = FixtureSpecCommon & {
  mode: "multi-round";
  /** Ordered rounds executed against one preserved working directory. */
  rounds: readonly FixtureRoundSpec[];
  /**
   * Optional final predicates evaluated after the last successful round. Use
   * these for aggregate invariants that should see the complete workspace.
   */
  aggregatePredicates?: readonly FixturePredicate[];
  /**
   * Optional deterministic metrics evaluated after the last successful round
   * and surfaced on the top-level fixture run for aggregate reporting.
   */
  aggregateObjectiveMetrics?: readonly ObjectiveMetricSpec[];
};

export type FixtureSpecFile =
  | SingleWorkflowFixtureSpecFile
  | MultiRoundFixtureSpecFile;

export function isSingleWorkflowFixtureSpec(
  spec: FixtureSpecFile,
): spec is SingleWorkflowFixtureSpecFile {
  return spec.mode === "single-workflow";
}

export function isMultiRoundFixtureSpec(
  spec: FixtureSpecFile,
): spec is MultiRoundFixtureSpecFile {
  return spec.mode === "multi-round";
}

/**
 * A fully-loaded fixture with its on-disk paths resolved. Callers pass this
 * to the runner; the loader guarantees every field is correct before handing
 * it off, so the runner does not re-validate.
 */
export type LoadedFixture = {
  spec: FixtureSpecFile;
  /** Absolute path to this fixture's directory under `fixtures/`. */
  fixtureDir: string;
  /** Absolute path to this fixture's `initial/` directory. */
  initialStateDir: string;
};
