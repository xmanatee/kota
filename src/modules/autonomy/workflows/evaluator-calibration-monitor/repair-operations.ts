import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  applyCalibrationRepair,
  type CalibrationRepairApplied,
  type CalibrationRepairContext,
  type CalibrationRepairProposal,
  proposeCalibrationRepair,
} from "#modules/autonomy/calibration-repair.js";

export function proposeCalibrationRepairInWorker(
  input: CalibrationRepairContext,
): CalibrationRepairProposal {
  return proposeCalibrationRepair(input);
}

export function applyCalibrationRepairInWorker(input: {
  proposal: CalibrationRepairProposal;
  context: CalibrationRepairContext;
}): CalibrationRepairApplied {
  return applyCalibrationRepair(input.proposal, input.context);
}

export const proposeCalibrationRepairOperation =
  defineWorkflowBlockingOperation<
    CalibrationRepairContext,
    CalibrationRepairProposal
  >(import.meta.url, "proposeCalibrationRepairInWorker");

export const applyCalibrationRepairOperation = defineWorkflowBlockingOperation<
  {
    proposal: CalibrationRepairProposal;
    context: CalibrationRepairContext;
  },
  CalibrationRepairApplied
>(import.meta.url, "applyCalibrationRepairInWorker");
