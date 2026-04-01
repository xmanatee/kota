import type { SDKMessage } from "../agent-sdk/types.js";
import type { RepairCheckResult, RepairIteration } from "./repair-loop.js";
import { buildRepairPrompt, runAgentRepairLoop } from "./repair-loop.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "./run-types.js";
import type { AgentStepConfig, WorkflowStepOutput } from "./step-executor-agent.js";
import {
  AgentStepRuntimeError,
  buildAgentPrompt,
  executeAgentStep,
  withRetry,
} from "./step-executor-agent.js";
import { executeTriggerStep } from "./step-executor-trigger.js";
import type {
  WorkflowCodeStep,
  WorkflowDefinition,
  WorkflowEmitStep,
  WorkflowRestartStep,
  WorkflowRunTrigger,
  WorkflowStep,
  WorkflowToolStep,
  WorkflowTriggerStep,
} from "./types.js";

export type {
  AgentStepConfig,
  RepairCheckResult,
  RepairIteration,
  WorkflowStepOutput,
};
export {
  AgentStepRuntimeError,
  buildAgentPrompt,
  buildRepairPrompt,
  executeAgentStep,
  withRetry,
};

export async function resolveValue<T>(
  value: T | ((context: WorkflowStepContext) => T | Promise<T>),
  context: WorkflowStepContext,
): Promise<T> {
  if (typeof value === "function") {
    return (value as (ctx: WorkflowStepContext) => T | Promise<T>)(context);
  }
  return value;
}

export async function shouldRunStep(
  step: WorkflowStep,
  context: WorkflowStepContext,
): Promise<boolean> {
  if (!step.when) return true;
  return Boolean(await step.when(context));
}

export async function executeToolStep(
  step: WorkflowToolStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  const input = await resolveValue(step.input ?? {}, context);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Tool step "${step.id}" resolved to a non-object input`);
  }
  const run = () => context.runTool(step.tool, input);
  return step.retry ? withRetry(run, step.retry) : run();
}

export async function executeEmitStep(
  step: WorkflowEmitStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  const payload = await resolveValue(step.payload ?? {}, context);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Emit step "${step.id}" resolved to a non-object payload`);
  }
  context.emit(step.event, payload as Record<string, unknown>);
  return { event: step.event, payload };
}

export async function executeRestartStep(
  step: WorkflowRestartStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  const missingRequirements = step.requires.filter((stepId) => {
    const result = context.stepResults[stepId];
    return !result || result.status !== "success";
  });
  if (missingRequirements.length > 0) {
    throw new Error(
      `Restart step "${step.id}" requires successful verification steps: ${missingRequirements.join(", ")}`,
    );
  }

  const reason = await resolveValue(
    step.reason ?? `${context.workflow.name} requested restart`,
    context,
  );
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error(`Restart step "${step.id}" resolved to an empty reason`);
  }
  context.requestRestart(reason);
  return {
    event: "runtime.restart_requested",
    payload: {
      reason,
      workflow: context.workflow.name,
      runId: context.workflow.runId,
      requires: step.requires,
    },
  };
}

export async function executeCodeStep(
  step: WorkflowCodeStep,
  context: WorkflowStepContext,
): Promise<WorkflowStepOutput> {
  return (await step.run(context)) as WorkflowStepOutput;
}

export async function executeStep(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  context: WorkflowStepContext,
  abortController: AbortController,
  appendMessage: (message: SDKMessage) => void,
  writeInputs: (systemPromptAppend: string | undefined, prompt: string) => void,
  agentConfig: AgentStepConfig,
): Promise<WorkflowStepOutput> {
  if (step.type === "tool") return executeToolStep(step, context);
  if (step.type === "agent") {
    const result = await executeAgentStep(
      definition,
      step,
      metadata,
      trigger,
      abortController,
      appendMessage,
      writeInputs,
      agentConfig,
      context.stepOutputs,
    );
    if (!step.repairLoop) return result;
    return runAgentRepairLoop(step, result, context, abortController, appendMessage, agentConfig);
  }
  if (step.type === "emit") return executeEmitStep(step, context);
  if (step.type === "restart") return executeRestartStep(step, context);
  if (step.type === "trigger") {
    return executeTriggerStep(step as WorkflowTriggerStep, context, abortController.signal);
  }
  if (step.type === "parallel") {
    throw new Error(
      `Parallel group "${step.id}" must be handled by the run executor, not executeStep`,
    );
  }
  if (step.type === "branch") {
    throw new Error(
      `Branch step "${step.id}" must be handled by the run executor, not executeStep`,
    );
  }
  return executeCodeStep(step, context);
}
