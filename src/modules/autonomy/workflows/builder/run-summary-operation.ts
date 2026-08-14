import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type {
  WorkflowContextInfo,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import {
  type BuilderRunSummary,
  writeBuilderRunSummary,
} from "./run-summary.js";

export type BuilderRunSummaryBuildOutput = {
  totalCostUsd?: number;
  repairWarnings?: readonly { id?: string; output?: string }[];
};

type BuilderRunSummaryOperationInput = {
  projectDir: string;
  workspaceDir: string | undefined;
  workflow: WorkflowContextInfo;
  buildOutput: BuilderRunSummaryBuildOutput | undefined;
  buildResult: WorkflowStepResult;
};

export function writeBuilderRunSummaryInWorker(
  input: BuilderRunSummaryOperationInput,
): BuilderRunSummary {
  return writeBuilderRunSummary({
    projectDir: input.projectDir,
    ...(input.workspaceDir !== undefined
      ? { workspaceDir: input.workspaceDir }
      : {}),
    workflow: input.workflow,
    stepOutputs: { build: input.buildOutput },
    stepResults: { build: input.buildResult },
  });
}

export const writeBuilderRunSummaryOperation =
  defineWorkflowBlockingOperation<
    BuilderRunSummaryOperationInput,
    BuilderRunSummary
  >(import.meta.url, "writeBuilderRunSummaryInWorker");
