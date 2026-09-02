import { join } from "node:path";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  aggregateCalibration,
  type CalibrationDriftKind,
  type EvaluatorCalibrationAggregate,
  evaluateCalibrationGate,
  resolveCalibrationGateConfig,
} from "#modules/autonomy/evaluator-calibration.js";

export type EvaluatorCalibrationInspection = {
  status: "insufficient-sample" | "under-threshold" | "gated";
  reason: string;
  driftKinds: CalibrationDriftKind[];
  criticPromptHash: string;
  thresholdRate: number;
  minSample: number;
  passWithWarningsThresholdRate: number;
  passWithWarningsMinSample: number;
  aggregate: EvaluatorCalibrationAggregate;
};

export function inspectEvaluatorCalibrationInWorker(input: {
  stateDir: string;
  scopeRoot: string;
}): EvaluatorCalibrationInspection {
  const config = resolveCalibrationGateConfig();
  const criticPromptHash = getCriticPromptHash();
  const aggregate = aggregateCalibration(
    join(input.stateDir, "runs"),
    {
      criticPromptHash,
      authority: { stateDir: input.stateDir, scopeRoot: input.scopeRoot },
    },
  );
  const decision = evaluateCalibrationGate(aggregate, config);
  return {
    status: decision.status,
    reason: decision.reason,
    driftKinds: decision.status === "gated" ? decision.kinds : [],
    criticPromptHash,
    thresholdRate: config.thresholdRate,
    minSample: config.minSample,
    passWithWarningsThresholdRate: config.passWithWarningsThresholdRate,
    passWithWarningsMinSample: config.passWithWarningsMinSample,
    aggregate,
  };
}

export const inspectEvaluatorCalibrationOperation =
  defineWorkflowBlockingOperation<
    { stateDir: string; scopeRoot: string },
    EvaluatorCalibrationInspection
  >(import.meta.url, "inspectEvaluatorCalibrationInWorker");
