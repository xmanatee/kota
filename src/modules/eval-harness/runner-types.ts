
import type { AgentEffort } from "#core/agent-harness/index.js";
import type {
  FixtureJsonObject,
  FixtureRoundSpec,
  LoadedFixture,
  VerifierCalibrationCaseSpec,
  VerifierCalibrationSetupOperation,
} from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRun,
  FixtureRunOutcome,
  ResourceProfile,
} from "./fixture-run.js";
import type { FixtureScoringCapabilities } from "./fixture-scoring-context.js";
import type {
  ObjectiveMetricDirection,
  ObjectiveMetricObservationError,
  ObservedObjectiveMetric,
} from "./objective-metrics.js";
import type {
  FixturePredicate,
  PredicateEvalResult,
  PredicateExpectationEvalResult,
} from "./predicates.js";

export type WorkflowAgentExecutionOverride = {
  /** Registered harness every agent step in the workflow should run through. */
  harness: string;
  /** Concrete model id every agent step in the workflow should receive. */
  model: string;
  /** Optional KOTA effort forced onto every agent step in the workflow. */
  effort?: AgentEffort;
};

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
  triggerPayload?: FixtureJsonObject;
  /**
   * Optional eval-owned override for model-matrix runs. The subprocess
   * executor forwards this to `kota workflow exec`, whose runtime rewrites
   * agent steps before execution so the fixture actually runs the requested
   * matrix harness/model instead of only labelling the row with them.
   */
  agentExecutionOverride?: WorkflowAgentExecutionOverride;
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
  predicateContext?: FixtureScoringCapabilities;
  preflight(requestedProfile: ResourceProfile): ExecutionProfilePreflightResult;
  execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionOutcome>;
};

export type RunFixtureParams = {
  fixture: LoadedFixture;
  executor: WorkflowExecutor;
  executionProfile: ExecutionProfilePreflightResult;
  agentExecutionOverride?: WorkflowAgentExecutionOverride;
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
  objectiveMetricErrors: ObjectiveMetricObservationError[];
  workingDir: string;
  executionOutcome: WorkflowExecutionOutcome;
};

export type RoundRunReport = {
  round: FixtureRoundSpec;
  roundIndex: number;
  executionOutcome: WorkflowExecutionOutcome;
  outcome: FixtureRunOutcome;
  preRunExpectationResults: PredicateExpectationEvalResult[];
  predicateResults: PredicateEvalResult[];
  objectiveMetrics: ObservedObjectiveMetric[];
  objectiveMetricErrors: ObjectiveMetricObservationError[];
  timing: {
    startedAt: string;
    durationMs: number;
    budgetMs: number;
  };
};

export type SerializedCalibrationError = {
  name: string;
  message: string;
  reason?: string;
  fixtureId?: string | null;
  metricName?: string | null;
};

export type VerifierCalibrationCaseResult = {
  id: VerifierCalibrationCaseSpec["id"];
  caseKind: VerifierCalibrationCaseSpec["caseKind"];
  expected: VerifierCalibrationCaseSpec["expected"];
  setup: readonly VerifierCalibrationSetupOperation[];
  passed: boolean;
  scoringPassed: boolean;
  predicateResults: PredicateEvalResult[];
  objectiveMetrics: ObservedObjectiveMetric[];
  objectiveMetricError?: SerializedCalibrationError;
  detail: string;
};

export type VerifierCalibrationObjectiveMetricComparison = {
  name: string;
  direction: ObjectiveMetricDirection;
  passed: boolean;
  goldenValue?: number;
  acceptedAlternativeValues: readonly {
    caseId: string;
    value?: number;
  }[];
  nullValue?: number;
  adversarialValue?: number;
  detail: string;
};

export type VerifierCalibrationRunResult = {
  fixtureId: string;
  passed: boolean;
  calibratedPredicates: readonly FixturePredicate[];
  objectiveMetricCount: number;
  objectiveMetricComparisons: readonly VerifierCalibrationObjectiveMetricComparison[];
  cases: readonly VerifierCalibrationCaseResult[];
};
