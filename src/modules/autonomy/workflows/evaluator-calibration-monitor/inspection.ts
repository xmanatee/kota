import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
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
  dirty: boolean;
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
  workspaceRoot: string;
  stateDir: string;
}): EvaluatorCalibrationInspection {
  const worktree = getRepoWorktreeStatus(input.workspaceRoot);
  const dirty = worktree.available && worktree.dirty;
  const config = resolveCalibrationGateConfig();
  const criticPromptHash = getCriticPromptHash();
  const aggregate = aggregateCalibration(
    join(input.stateDir, "runs"),
    { criticPromptHash },
  );
  const decision = evaluateCalibrationGate(aggregate, config);
  return {
    dirty,
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
    { workspaceRoot: string; stateDir: string },
    EvaluatorCalibrationInspection
  >(import.meta.url, "inspectEvaluatorCalibrationInWorker");
