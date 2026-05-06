import type { EventBus } from "#core/events/event-bus.js";
import {
  type AwaitDelivery,
  type AwaitMatchScalar,
  clearAwaitFiles,
  readDelivery,
  writeDelivery,
  writeSuspension,
} from "../awaits-store.js";
import type { WorkflowStepContext } from "../run-types.js";
import type { WorkflowAwaitEventStep } from "../step-types.js";
import { resolveValue } from "./step-executor.js";
import type { WorkflowStepOutput } from "./step-executor-agent.js";

/**
 * Output shape for an await-event step. Discriminated by `kind` so downstream
 * `when` predicates branch on match-vs-timeout without inspecting payloads.
 */
export type AwaitEventStepOutput =
  | {
      kind: "event";
      event: string;
      matchField: string;
      matchValue: AwaitMatchScalar;
      payload: Record<string, unknown>;
    }
  | {
      kind: "timeout";
      event: string;
      matchField: string;
      matchValue: AwaitMatchScalar;
      awaitTimeoutMs: number;
    };

/** Trigger payload key carrying restart-resume payloads keyed by step id. */
export const AWAIT_EVENT_PAYLOADS_KEY = "awaitEventPayloads";

function deliveryToOutput(
  delivery: AwaitDelivery,
  matchField: string,
  matchValue: AwaitMatchScalar,
): AwaitEventStepOutput {
  if (delivery.kind === "event") {
    return {
      kind: "event",
      event: delivery.event,
      matchField,
      matchValue,
      payload: delivery.payload,
    };
  }
  return {
    kind: "timeout",
    event: delivery.event,
    matchField,
    matchValue,
    awaitTimeoutMs: delivery.awaitTimeoutMs,
  };
}

function readResumePayload(
  step: WorkflowAwaitEventStep,
  context: WorkflowStepContext,
): AwaitEventStepOutput | null {
  const triggerPayload = context.trigger.payload as Record<string, unknown> | undefined;
  const map = triggerPayload?.[AWAIT_EVENT_PAYLOADS_KEY];
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const value = (map as Record<string, unknown>)[step.id];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { kind?: string };
  if (candidate.kind !== "event" && candidate.kind !== "timeout") return null;
  return value as AwaitEventStepOutput;
}

export async function executeAwaitEventStep(
  step: WorkflowAwaitEventStep,
  context: WorkflowStepContext,
  bus: EventBus,
  signal: AbortSignal,
): Promise<WorkflowStepOutput> {
  // Restart-resume short-circuit: the runtime injects matched payloads into
  // the trigger when it queues a resume run for a persisted suspension.
  const resumed = readResumePayload(step, context);
  if (resumed) {
    clearAwaitFiles(context.workflow.runDirPath, step.id);
    return resumed as WorkflowStepOutput;
  }

  // Crash-window short-circuit: a previous in-flight execution may have
  // captured a delivery before the daemon died. Honor it before re-suspending.
  const persistedDelivery = readDelivery(context.workflow.runDirPath, step.id);
  if (persistedDelivery) {
    const matchValue = await resolveValue(step.matchValue, context);
    if (typeof matchValue !== "string" && typeof matchValue !== "number") {
      throw new Error(
        `await-event step "${step.id}" matchValue resolved to non-scalar`,
      );
    }
    clearAwaitFiles(context.workflow.runDirPath, step.id);
    return deliveryToOutput(persistedDelivery, step.matchField, matchValue) as WorkflowStepOutput;
  }

  const matchValue = await resolveValue(step.matchValue, context);
  if (typeof matchValue !== "string" && typeof matchValue !== "number") {
    throw new Error(
      `await-event step "${step.id}" matchValue resolved to non-scalar`,
    );
  }

  const suspendedAt = new Date().toISOString();
  const deadlineAtMs = step.awaitTimeoutMs
    ? Date.now() + step.awaitTimeoutMs
    : undefined;

  writeSuspension(context.workflow.runDirPath, {
    runId: context.workflow.runId,
    workflowName: context.workflow.name,
    definitionPath: context.workflow.definitionPath,
    stepId: step.id,
    event: step.event,
    matchField: step.matchField,
    matchValue,
    suspendedAt,
    ...(step.awaitTimeoutMs !== undefined ? { awaitTimeoutMs: step.awaitTimeoutMs } : {}),
    ...(deadlineAtMs !== undefined ? { deadlineAtMs } : {}),
  });

  return new Promise<WorkflowStepOutput>((resolve, reject) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeBus: (() => void) | null = null;
    let onAbort: (() => void) | null = null;
    let settled = false;

    const tearDown = (): void => {
      if (unsubscribeBus) {
        unsubscribeBus();
        unsubscribeBus = null;
      }
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
        onAbort = null;
      }
    };

    const settleAndCleanup = (delivery: AwaitDelivery): void => {
      if (settled) return;
      settled = true;
      writeDelivery(context.workflow.runDirPath, step.id, delivery);
      tearDown();
      // Live cleanup: best-effort. If we crash before the run records this
      // step, the next daemon start will re-issue a resume from the restart
      // scan only when the suspension still exists. The order — write
      // delivery, clear files, resolve — keeps the persisted artifact
      // available across the resolve boundary.
      clearAwaitFiles(context.workflow.runDirPath, step.id);
      resolve(deliveryToOutput(delivery, step.matchField, matchValue) as WorkflowStepOutput);
    };

    unsubscribeBus = bus.on(step.event, (rawPayload: Record<string, unknown>) => {
      if (settled) return;
      const actual = rawPayload[step.matchField];
      if (actual !== matchValue) return;
      settleAndCleanup({
        kind: "event",
        deliveredAt: new Date().toISOString(),
        event: step.event,
        payload: rawPayload,
      });
    });

    if (step.awaitTimeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        settleAndCleanup({
          kind: "timeout",
          deliveredAt: new Date().toISOString(),
          event: step.event,
          awaitTimeoutMs: step.awaitTimeoutMs!,
        });
      }, step.awaitTimeoutMs);
    }

    onAbort = (): void => {
      if (settled) return;
      settled = true;
      tearDown();
      // Leave the suspension file in place: the next daemon start sees the
      // file and re-queues a resume via the restart scan.
      const reason = signal.reason instanceof Error
        ? signal.reason
        : new Error("await-event step aborted");
      reject(reason);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
