import type { WorkflowStepContext } from "./run-types.js";
import { resolveValue } from "./step-executor.js";
import type { WorkflowTriggerStep } from "./types.js";

export type TriggerStepOutput = {
  runId: string;
  status: "queued" | "completed" | "failed";
  childOutput?: unknown;
};

export async function executeTriggerStep(
  step: WorkflowTriggerStep,
  context: WorkflowStepContext,
  signal?: AbortSignal,
): Promise<TriggerStepOutput> {
  const rawPayload = await resolveValue(step.payload ?? {}, context);
  const payload = interpolatePayload(
    rawPayload as Record<string, unknown>,
    context,
  );
  return context.triggerWorkflow(step.workflow, payload, step.waitFor, signal);
}

function interpolatePayload(
  payload: Record<string, unknown>,
  context: WorkflowStepContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = interpolateValue(value, context);
  }
  return result;
}

function interpolateValue(value: unknown, context: WorkflowStepContext): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
      const resolved = resolvePath(path.trim(), context);
      return resolved !== undefined ? String(resolved) : _match;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, context));
  }
  if (value !== null && typeof value === "object") {
    return interpolatePayload(value as Record<string, unknown>, context);
  }
  return value;
}

function resolvePath(path: string, context: WorkflowStepContext): unknown {
  const parts = path.split(".");
  let current: unknown = {
    trigger: context.trigger,
    stepOutputs: context.stepOutputs,
  };
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
