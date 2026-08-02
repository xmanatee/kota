import {
  createWorkflowDispatchDeadLetter,
  type DeadLetterFailureClass,
} from "#core/daemon/dead-letter-queue.js";
import type { WorkflowRunMetadata, WorkflowStepResult } from "./run-types.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowStep } from "./step-types.js";
import { DEFAULT_AGENT_STEP_RETRY } from "./steps/step-executor-retry.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export function recordFailedWorkflowDispatchDeadLetter(
  state: WorkflowRuntimeDispatchState,
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
  metadata: WorkflowRunMetadata,
  agentFailureClass?: DeadLetterFailureClass,
): void {
  if (metadata.status !== "failed" || state.deadLetterQueue === undefined) return;
  const failedStep = terminalFailedStep(metadata.steps);
  createWorkflowDispatchDeadLetter({
    store: state.deadLetterQueue,
    scopeId: state.pbus.getScopeId(),
    workflowName: definition.name,
    trigger,
    reason: failedStep?.error ?? `Workflow "${definition.name}" failed`,
    errorClass: agentFailureClass ?? "execution",
    failedRun: metadata,
    retryCount: failedStep === undefined ? 1 : retryCountForStep(definition.steps, failedStep),
    owningModule: "workflow-runtime",
  });
}

function terminalFailedStep(
  steps: readonly WorkflowStepResult[],
): WorkflowStepResult | undefined {
  return steps.find((step) => step.status === "failed" && !step.continueOnFailure);
}

function retryCountForStep(
  steps: readonly WorkflowStep[],
  failedStep: WorkflowStepResult,
): number {
  const step = findWorkflowStep(steps, failedStep.id);
  if (step?.type === "agent") return (step.retry ?? DEFAULT_AGENT_STEP_RETRY).maxAttempts;
  if (step?.type === "tool") return step.retry?.maxAttempts ?? 1;
  return 1;
}

function findWorkflowStep(
  steps: readonly WorkflowStep[],
  id: string,
): WorkflowStep | undefined {
  for (const step of steps) {
    if (step.id === id) return step;
    if (step.type === "parallel" || step.type === "foreach") {
      const child = findWorkflowStep(step.steps, id);
      if (child !== undefined) return child;
    }
    if (step.type === "branch") {
      const trueChild = findWorkflowStep(step.ifTrue, id);
      if (trueChild !== undefined) return trueChild;
      const falseChild = findWorkflowStep(step.ifFalse, id);
      if (falseChild !== undefined) return falseChild;
    }
  }
  return undefined;
}
