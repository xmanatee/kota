/**
 * EvalHarness namespace client contract.
 *
 * The eval-harness module owns its KotaClient namespace surface end-to-end:
 * this file declares the list/run/calibration types and the
 * `EvalHarnessClient` interface that the `KotaClient` aggregate composes.
 * Both the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota eval` CLI subcommands consume it through
 * `ctx.client.evalHarness` or by importing these types from
 * `#modules/eval-harness/client.js`.
 */
import type {
  AggregateObjectiveMetric,
  ObjectiveMetricValidationReason,
} from "./objective-metrics.js";

/** A fixture surfaced by `evalHarness.list`. */
export type EvalFixtureSummary = {
  id: string;
  description: string;
  role: string;
  workflowName: string;
  tags: string[];
};

export type EvalListResult = {
  fixtures: EvalFixtureSummary[];
};

/**
 * Options accepted by `evalHarness.run`.
 *
 * Mirror the existing `kota eval run` flags. The local handler resolves
 * defaults from the same constants the CLI used before migration.
 */
export type EvalRunOptions = {
  fixtureIds?: string[];
  repeatCount?: number;
  hostClass?: string;
  cpuAllocationCores?: number;
  cpuKillThresholdCores?: number;
  memoryAllocationMB?: number;
  memoryKillThresholdMB?: number;
  keepWorkingDirs?: boolean;
};

export type EvalRunResult =
  | {
      ok: true;
      fixtureCount: number;
      repeatCount: number;
      passAtK: number;
      passHatK: number;
      objectiveMetrics: AggregateObjectiveMetric[];
      runArtifactBaseDir: string;
    }
  | { ok: false; reason: "no_fixtures"; message: string }
  | { ok: false; reason: "fixture_provenance"; message: string }
  | {
      ok: false;
      reason: "objective_metric_validation";
      validationReason: ObjectiveMetricValidationReason;
      message: string;
    };

/**
 * Options accepted by `evalHarness.calibration`. Mirror the CLI flags so
 * the operator can drive the same window-based aggregation through the
 * contract.
 */
export type EvalCalibrationOptions = {
  windowDays?: number;
  followUpDays?: number;
  thresholdRate?: number;
  minSample?: number;
  runsDir?: string;
};

/**
 * Result of `evalHarness.calibration`. The aggregate and decision payloads
 * are surfaced as plain JSON records so the contract avoids coupling to
 * the autonomy module's internal types.
 */
export type EvalCalibrationResult = {
  aggregate: Record<string, unknown>;
  decision: Record<string, unknown>;
};

/**
 * Eval-harness operations exposed to operator CLIs.
 *
 * `list` enumerates fixtures, `run` executes one or many fixtures via
 * the subprocess executor, `calibration` runs the rolling-window
 * evaluator-calibration aggregator. The local handler does the actual
 * filesystem and subprocess work; the daemon-side handler delegates to
 * the same operations through the existing `/api/eval/run` route plus
 * the `/eval/list` and `/eval/calibration` control routes.
 */
export interface EvalHarnessClient {
  list(): Promise<EvalListResult>;
  run(options?: EvalRunOptions): Promise<EvalRunResult>;
  calibration(options?: EvalCalibrationOptions): Promise<EvalCalibrationResult>;
}
