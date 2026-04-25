import type { AgentMessage } from "#core/agent-harness/types.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { RepairCheckResult, RepairIteration } from "../repair-loop.js";
import { buildRepairPrompt, runAgentRepairLoop } from "../repair-loop.js";
import type { WorkflowRunMetadata, WorkflowStepContext, WorkflowStepSkipReason } from "../run-types.js";
import type {
  WorkflowApprovalStep,
  WorkflowAwaitEventStep,
  WorkflowCodeStep,
  WorkflowDefinition,
  WorkflowEmitStep,
  WorkflowNotifyConfig,
  WorkflowRestartStep,
  WorkflowRunTrigger,
  WorkflowStep,
  WorkflowToolStep,
  WorkflowTriggerStep,
} from "../types.js";
import type { AgentStepConfig, AgentStepResult, WorkflowStepOutput } from "./step-executor-agent.js";
import {
  AgentStepRuntimeError,
  buildAgentPrompt,
  DEFAULT_AGENT_STEP_RETRY,
  executeAgentStep,
  withRetry,
} from "./step-executor-agent.js";
import { executeApprovalStep } from "./step-executor-approval.js";
import { executeAwaitEventStep } from "./step-executor-await-event.js";
import { executeTriggerStep } from "./step-executor-trigger.js";

export type {
  AgentStepConfig,
  AgentStepResult,
  RepairCheckResult,
  RepairIteration,
  WorkflowStepOutput,
};
export {
  AgentStepRuntimeError,
  buildAgentPrompt,
  buildRepairPrompt,
  DEFAULT_AGENT_STEP_RETRY,
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

export type StepRunDecision =
  | { run: true }
  | { run: false; skipReason: WorkflowStepSkipReason };

/**
 * Evaluate whether a step should run, returning either `{ run: true }` or a
 * structured skip reason. Skip sites that need to persist a `skipReason` on
 * the resulting `WorkflowStepResult` use this instead of {@link shouldRunStep}
 * so the reason is constructed once, next to the predicate evaluation.
 */
export async function evaluateStepRunDecision(
  step: WorkflowStep,
  context: WorkflowStepContext,
): Promise<StepRunDecision> {
  if (!step.when) return { run: true };
  const ok = Boolean(await step.when(context));
  if (ok) return { run: true };
  const label = step.when.skipLabel;
  const skipReason: WorkflowStepSkipReason = {
    kind: "when-predicate",
    ...(label !== undefined ? { label } : {}),
  };
  return { run: false, skipReason };
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

/** Maps notification emit events to the notify config flag that controls them. */
const NOTIFICATION_EMIT_EVENT_FLAGS: Partial<Record<string, keyof WorkflowNotifyConfig>> = {
  "workflow.build.committed": "onSuccess",
};

export async function executeEmitStep(
  step: WorkflowEmitStep,
  context: WorkflowStepContext,
  notifyConfig?: WorkflowNotifyConfig,
): Promise<WorkflowStepOutput> {
  const flag = NOTIFICATION_EMIT_EVENT_FLAGS[step.event];
  if (flag !== undefined && notifyConfig?.[flag] === false) {
    return { event: step.event, suppressed: true };
  }
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
  appendMessage: (message: AgentMessage) => void,
  writeInputs: (systemPromptAppend: string | undefined, prompt: string) => void,
  agentConfig: AgentStepConfig,
  bus: EventBus,
): Promise<WorkflowStepOutput | AgentStepResult> {
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
  if (step.type === "emit") return executeEmitStep(step, context, definition.notify);
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
  if (step.type === "foreach") {
    throw new Error(
      `Foreach step "${step.id}" must be handled by the run executor, not executeStep`,
    );
  }
  if (step.type === "approval") {
    return executeApprovalStep(step as WorkflowApprovalStep, context, abortController.signal);
  }
  if (step.type === "await-event") {
    return executeAwaitEventStep(
      step as WorkflowAwaitEventStep,
      context,
      bus,
      abortController.signal,
    );
  }
  return executeCodeStep(step, context);
}
