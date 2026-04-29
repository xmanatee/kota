/**
 * Live-run evaluator calibration monitor.
 *
 * After each builder run commits, this workflow aggregates calibration
 * artifacts across the rolling window and — only when the critic's
 * pass-verdict contradiction rate exceeds the configured threshold — emits
 * the typed `evaluator-calibration.regression.detected` event. A sibling
 * notify workflow bridges that event to `workflow.attention.digest` so
 * operators see the drift without opening run artifacts.
 *
 * The monitor deliberately does not emit attention envelopes itself.
 * Typed event first, attention bridge second: keeps telemetry observers and
 * notification modules independent.
 */

import { join } from "node:path";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/types.js";
import {
  aggregateCalibration,
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  type EvaluatorCalibrationAggregate,
  evaluateCalibrationGate,
} from "#modules/autonomy/evaluator-calibration.js";

type MonitorResult = {
  emitted: boolean;
  status: "insufficient-sample" | "under-threshold" | "gated";
  totalRuns: number;
  passVerdictCount: number;
  passContradictionRate: number;
};

function buildReason(aggregate: EvaluatorCalibrationAggregate, gateReason: string): string {
  return (
    `${gateReason} ` +
    `Observed ${aggregate.totalRuns} total builder runs in window; ` +
    `${aggregate.byVerdict.pass_with_warnings} pass_with_warnings, ` +
    `${aggregate.byVerdict.fail} fail, ` +
    `${aggregate.byVerdict.absent} absent.`
  );
}

const monitorStep = typedCodeStep<MonitorResult>({
  id: "evaluate-calibration",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<MonitorResult>(raw, [
      "emitted",
      "status",
      "totalRuns",
      "passVerdictCount",
      "passContradictionRate",
    ]),
  run: ({ projectDir, emit }) => {
    const runsDir = join(projectDir, ".kota", "runs");
    const thresholdRate = Number(
      process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE,
    );
    const minSample = Number(
      process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE,
    );
    const config = {
      thresholdRate: Number.isFinite(thresholdRate) && thresholdRate > 0
        ? thresholdRate
        : DEFAULT_CALIBRATION_THRESHOLD_RATE,
      minSample: Number.isFinite(minSample) && minSample > 0
        ? Math.floor(minSample)
        : DEFAULT_CALIBRATION_MIN_SAMPLE,
    };

    const aggregate = aggregateCalibration(runsDir);
    const decision = evaluateCalibrationGate(aggregate, config);

    const summary: MonitorResult = {
      emitted: decision.status === "gated",
      status: decision.status,
      totalRuns: aggregate.totalRuns,
      passVerdictCount: aggregate.byVerdict.pass,
      passContradictionRate: aggregate.passContradictionRate,
    };

    if (decision.status === "gated") {
      emit("evaluator-calibration.regression.detected", {
        windowStartMs: aggregate.windowStartMs,
        windowEndMs: aggregate.windowEndMs,
        totalRuns: aggregate.totalRuns,
        passVerdictCount: aggregate.byVerdict.pass,
        passContradictionCount: aggregate.passContradictionCount,
        passContradictionRate: aggregate.passContradictionRate,
        passWithWarningsCount: aggregate.byVerdict.pass_with_warnings,
        passWithWarningsFollowUpCount: aggregate.passWithWarningsFollowUpCount,
        passWithWarningsFollowUpRate: aggregate.passWithWarningsFollowUpRate,
        thresholdRate: config.thresholdRate,
        reason: buildReason(aggregate, decision.reason),
      });
    }

    return summary;
  },
});

const evaluatorCalibrationMonitor: WorkflowDefinitionInput = {
  name: "evaluator-calibration-monitor",
  description:
    "After each builder commit, aggregate evaluator calibration and emit a typed regression event when the pass-verdict contradiction rate crosses the threshold.",
  triggers: [{ event: "workflow.build.committed" }],
  steps: [monitorStep],
};

export default evaluatorCalibrationMonitor;
