import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  checkExplorationRationale,
  type ExplorationRationale,
} from "./exploration-rationale.js";

type ExplorationRationaleCheckInput = {
  projectDir: string;
  runDirPath: string;
  actionableCount: number;
  strategicReadyCoverageGap: boolean;
};

export function checkExplorationRationaleInWorker(
  input: ExplorationRationaleCheckInput,
): ExplorationRationale {
  return checkExplorationRationale(input.projectDir, input.runDirPath, {
    actionableCount: input.actionableCount,
    strategicReadyCoverageGap: input.strategicReadyCoverageGap,
  });
}

export const explorationRationaleCheckOperation =
  defineWorkflowBlockingOperation<
    ExplorationRationaleCheckInput,
    ExplorationRationale
  >(import.meta.url, "checkExplorationRationaleInWorker");
