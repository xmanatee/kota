import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  applyCalibrationRepair,
  type CalibrationRepairApplied,
  type CalibrationRepairContext,
  type CalibrationRepairProposal,
} from "#modules/autonomy/calibration-repair.js";

export function applyCalibrationRepairInWorker(input: {
  proposal: CalibrationRepairProposal;
  context: CalibrationRepairContext;
}): CalibrationRepairApplied {
  return applyCalibrationRepair(input.proposal, input.context);
}

export const applyCalibrationRepairOperation = defineWorkflowBlockingOperation<
  {
    proposal: CalibrationRepairProposal;
    context: CalibrationRepairContext;
  },
  CalibrationRepairApplied
>(import.meta.url, "applyCalibrationRepairInWorker");
