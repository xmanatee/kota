import type { EventBus } from "../event-bus.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import { buildStepCompletedPayload } from "./event-payloads.js";
import type { WorkflowRunMetadata, WorkflowStepContext, WorkflowStepResult } from "./run-types.js";
import {
  type AgentStepConfig,
  AgentStepRuntimeError,
  executeStep,
} from "./step-executor.js";
import type {
  WorkflowAgentBackoffSignal,
  WorkflowDefinition,
  WorkflowRunTrigger,
  WorkflowStep,
} from "./types.js";

type StepAccumulators = {
  stepOutputsById: Record<string, unknown>;
  stepResultsById: Record<string, WorkflowStepResult>;
  stepOutputs: unknown[];
};

type StepDeps = {
  bus: EventBus;
  log: (message: string) => void;
};

export function buildSkippedResult(
  step: WorkflowStep,
  stepStartedAt: number,
  acc: StepAccumulators,
  recordStep: (result: WorkflowStepResult) => void,
  bus: EventBus,
  runMetadata: WorkflowRunMetadata,
): WorkflowStepResult {
  const skipped: WorkflowStepResult = {
    id: step.id,
    type: step.type,
    status: "skipped",
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
  };
  recordStep(skipped);
  acc.stepOutputsById[step.id] = { skipped: true };
  acc.stepResultsById[step.id] = skipped;
  acc.stepOutputs.push({ skipped: true });
  if (step.type === "parallel") {
    const skippedAt = new Date(stepStartedAt).toISOString();
    for (const childStep of step.steps) {
      const childSkipped: WorkflowStepResult = {
        id: childStep.id,
        type: childStep.type,
        status: "skipped",
        startedAt: skippedAt,
        completedAt: skippedAt,
        durationMs: 0,
      };
      acc.stepOutputsById[childStep.id] = { skipped: true };
      acc.stepResultsById[childStep.id] = childSkipped;
    }
  }
  bus.emit("workflow.step.completed", buildStepCompletedPayload(runMetadata, skipped));
  return skipped;
}

export type SingleStepResult = {
  completed: WorkflowStepResult;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
};

export async function executeWorkflowStep(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  run: Pick<ActiveWorkflowRunHandle, "metadata" | "recordStep" | "appendAgentMessage" | "writeAgentInputs">,
  trigger: WorkflowRunTrigger,
  context: WorkflowStepContext,
  abortController: AbortController,
  agentConfig: AgentStepConfig,
  acc: StepAccumulators,
  deps: StepDeps,
  stepStartedAt: number,
): Promise<SingleStepResult> {
  try {
    const output = await executeStep(
      definition,
      step,
      run.metadata,
      trigger,
      context,
      abortController,
      (message) => run.appendAgentMessage(step.id, message),
      (systemPromptAppend, prompt) => run.writeAgentInputs(step.id, systemPromptAppend, prompt),
      agentConfig,
    );

    const completed: WorkflowStepResult = {
      id: step.id,
      type: step.type,
      status: "success",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      output,
    };
    run.recordStep(completed);
    acc.stepOutputsById[step.id] = output;
    acc.stepResultsById[step.id] = completed;
    acc.stepOutputs.push(output);

    deps.bus.emit("workflow.step.completed", buildStepCompletedPayload(run.metadata, completed));
    const logDetails: string[] = [`${completed.durationMs}ms`];
    if (completed.type === "agent" && completed.output && typeof completed.output === "object") {
      const o = completed.output as { turns?: unknown; totalCostUsd?: unknown; subtype?: unknown };
      if (typeof o.turns === "number") logDetails.push(`${o.turns} turn(s)`);
      if (typeof o.totalCostUsd === "number") logDetails.push(`$${o.totalCostUsd.toFixed(2)}`);
      if (typeof o.subtype === "string" && o.subtype) logDetails.push(o.subtype);
    }
    deps.log(
      `Completed step "${completed.id}" (${completed.type}) in workflow "${definition.name}" [${logDetails.join(", ")}]`,
    );
    return { completed };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    let agentBackoff: WorkflowAgentBackoffSignal | undefined;
    if (err instanceof AgentStepRuntimeError) {
      agentBackoff = { kind: err.kind, reason: err.message };
    }
    const failed: WorkflowStepResult = {
      id: step.id,
      type: step.type,
      status: "failed",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      error: err.message,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    };
    run.recordStep(failed);
    acc.stepResultsById[step.id] = failed;
    deps.bus.emit("workflow.step.completed", buildStepCompletedPayload(run.metadata, failed));
    deps.log(
      `Failed step "${failed.id}" (${failed.type}) in workflow "${definition.name}": ${failed.error ?? "unknown error"}`,
    );
    return { completed: failed, agentBackoff, thrownError: err };
  }
}
