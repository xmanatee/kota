import {
  isWorkflowRepairErrorKind,
  isWorkflowStepTimeoutErrorKind,
  type WorkflowRunMetadata,
} from "#core/workflow/run-types.js";

export type BuilderDecompositionFailureKind = "timeout" | "repair-exhausted";

export function classifyBuilderFailureForDecomposition(
  metadata: WorkflowRunMetadata,
): BuilderDecompositionFailureKind | null {
  const buildStep = metadata.steps.find((step) => step.id === "build");
  if (!buildStep || buildStep.status !== "failed") return null;
  if (isWorkflowStepTimeoutErrorKind(buildStep.errorKind)) return "timeout";
  if (isWorkflowRepairErrorKind(buildStep.errorKind)) return "repair-exhausted";
  return null;
}
