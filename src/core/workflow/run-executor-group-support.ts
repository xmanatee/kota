import type { EventBus } from "#core/events/event-bus.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import {
  type ActiveTimeoutSnapshot,
  activeTimingMetadata,
} from "./active-timeout.js";
import { buildStepCompletedPayload } from "./event-payloads.js";
import type { StepAccumulators } from "./run-executor-step.js";
import type { WorkflowStepContext, WorkflowStepResult } from "./run-types.js";
import type { WorkflowBranchStep, WorkflowForeachStep, WorkflowParallelGroup } from "./step-types.js";
import { createStepContext } from "./steps/step-context.js";
import type { AgentStepConfig } from "./steps/step-executor.js";
import type { WorkflowAgentBackoffSignal, WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export type GroupStep = WorkflowParallelGroup | WorkflowBranchStep | WorkflowForeachStep;

type GroupRun = Pick<
  ActiveWorkflowRunHandle,
  "metadata" | "recordStep" | "appendAgentMessage" | "writeAgentInputs"
>;

export type GroupStepDeps = {
  definition: WorkflowDefinition;
  run: GroupRun;
  trigger: WorkflowRunTrigger;
  runAbortController: AbortController;
  agentConfig: AgentStepConfig;
  acc: StepAccumulators;
  bus: EventBus;
  pbus: ScopedEventBus;
  log: (message: string) => void;
  contextDeps: Parameters<typeof createStepContext>[6];
  previousOutput: WorkflowStepContext["previousOutput"];
  priorRunSteps?: readonly WorkflowStepResult[];
};

export type GroupStepOutcome = {
  previousOutput: WorkflowStepContext["previousOutput"];
  hadWarnings: boolean;
  agentBackoff?: WorkflowAgentBackoffSignal;
};

export function recordCompletedGroup(
  step: GroupStep,
  result: WorkflowStepResult,
  deps: GroupStepDeps,
): void {
  deps.run.recordStep(result);
  deps.acc.stepOutputsById[step.id] = result.output;
  deps.acc.stepResultsById[step.id] = result;
  deps.acc.stepOutputs.push(result.output);
  deps.pbus.emit(
    "workflow.step.completed",
    buildStepCompletedPayload(
      deps.run.metadata,
      result,
      deps.definition.defaultAutonomyMode,
    ),
  );
  const timing = result.activeDurationMs ?? result.durationMs;
  const suspended =
    result.hostSuspendedMs === undefined
      ? ""
      : `, host suspended ${result.hostSuspendedMs}ms`;
  deps.log(
    `Completed step "${step.id}" (${step.type}) in workflow "${deps.definition.name}" [${timing}ms${suspended}]`,
  );
}

export function recordFailedGroup(
  step: GroupStep,
  stepStartedAt: number,
  error: Error,
  deps: GroupStepDeps,
  timing?: ActiveTimeoutSnapshot,
): void {
  const failed: WorkflowStepResult = {
    id: step.id,
    type: step.type,
    status: "failed",
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
    ...activeTimingMetadata(timing),
    error: error.message,
    ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
  };
  deps.run.recordStep(failed);
  deps.acc.stepOutputsById[step.id] = undefined;
  deps.acc.stepResultsById[step.id] = failed;
  deps.pbus.emit(
    "workflow.step.completed",
    buildStepCompletedPayload(
      deps.run.metadata,
      failed,
      deps.definition.defaultAutonomyMode,
    ),
  );
  deps.log(
    `Failed step "${step.id}" (${step.type}) in workflow "${deps.definition.name}": ${error.message}`,
  );
}

export function buildChildContext(
  stepId: string,
  deps: GroupStepDeps,
): WorkflowStepContext {
  return createStepContext(
    deps.run.metadata,
    deps.trigger,
    deps.previousOutput,
    deps.acc.stepOutputsById,
    deps.acc.stepResultsById,
    deps.acc.stepOutputs,
    { ...deps.contextDeps, currentStepId: stepId },
  );
}
