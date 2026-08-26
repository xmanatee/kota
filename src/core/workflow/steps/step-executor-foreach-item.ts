import type { EventBus } from "#core/events/event-bus.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import type { ActiveWorkflowRunHandle } from "../active-run-handle.js";
import { buildStepStartedPayload } from "../event-payloads.js";
import {
  buildSkippedResult,
  executeWorkflowStep,
  type StepAccumulators,
} from "../run-executor-step.js";
import type { WorkflowStepContext, WorkflowStepResult } from "../run-types.js";
import type { WorkflowAgentStep, WorkflowCodeStep } from "../step-types.js";
import type { WorkflowAgentBackoffSignal, WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";
import { evaluateStepRunDecision } from "./step-executor.js";
import type { AgentStepConfig } from "./step-executor-agent.js";

export type ForeachExecutionDeps = {
  definition: WorkflowDefinition;
  run: Pick<
    ActiveWorkflowRunHandle,
    "metadata" | "recordStep" | "appendAgentMessage" | "writeAgentInputs"
  >;
  trigger: WorkflowRunTrigger;
  runAbortController: AbortController;
  agentConfig: AgentStepConfig;
  acc: StepAccumulators;
  bus: EventBus;
  pbus: ScopedEventBus;
  log: (message: string) => void;
};

type ForeachInnerStepExecution = {
  result: WorkflowStepResult;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
};

export async function executeForeachInnerStep(
  innerStep: WorkflowCodeStep | WorkflowAgentStep,
  context: WorkflowStepContext,
  itemIndex: number,
  deps: ForeachExecutionDeps,
): Promise<ForeachInnerStepExecution> {
  const stepStartedAt = Date.now();
  let emitOrdinal = 0;
  let toolOrdinal = 0;
  const innerContext: WorkflowStepContext = {
    ...context,
    runTool: (name, input, toolContext) =>
      context.runTool(name, input, {
        ...toolContext,
        stepId: toolContext?.stepId ?? innerStep.id,
        effectId: toolContext?.effectId === undefined
          ? `foreach:${innerStep.id}:${itemIndex}:tool:${toolOrdinal++}`
          : `foreach:${innerStep.id}:${itemIndex}:${toolContext.effectId}`,
      }),
    emit: (event, payload, options) =>
      context.emit(event, payload, {
        ...options,
        stepId: options?.stepId === undefined
          ? `foreach:${innerStep.id}:${itemIndex}:emit:${emitOrdinal++}`
          : `foreach:${innerStep.id}:${itemIndex}:${options.stepId}`,
      }),
  };

  const runDecision = await evaluateStepRunDecision(innerStep, innerContext);
  if (!runDecision.run) {
    return {
      result: buildSkippedResult(
        innerStep,
        stepStartedAt,
        deps.acc,
        (result) => deps.run.recordStep(result),
        deps.pbus,
        deps.run.metadata,
        deps.definition.defaultAutonomyMode,
        runDecision.skipReason,
      ),
    };
  }

  deps.pbus.emit(
    "workflow.step.started",
    buildStepStartedPayload(
      deps.run.metadata,
      innerStep,
      deps.definition.defaultAutonomyMode,
    ),
  );
  deps.log(
    `Starting foreach item[${itemIndex}] step "${innerStep.id}" (${innerStep.type}) in workflow "${deps.definition.name}"`,
  );

  const { completed, agentBackoff, thrownError } = await executeWorkflowStep(
    deps.definition,
    innerStep,
    deps.run,
    deps.trigger,
    innerContext,
    deps.runAbortController,
    deps.agentConfig,
    deps.acc,
    { bus: deps.bus, pbus: deps.pbus, log: deps.log },
    stepStartedAt,
  );
  return { result: completed, agentBackoff, thrownError };
}
