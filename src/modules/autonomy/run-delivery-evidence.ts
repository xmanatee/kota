import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  readWriterIntegrationEvidence,
  type WriterIntegrationEvidence,
} from "#core/workflow/writer-integration-evidence.js";
import { readBuilderTaskPayload } from "./workflows/builder/task-contract.js";

export type AutonomyRunDeliveryEvidence = WriterIntegrationEvidence &
  Readonly<{
    taskId: string | null;
    taskTitle: string | null;
    costUsd: number | null;
    durationMs: number | null;
  }>;

export function reportRunTriggerPayload(
  run: WorkflowRunMetadata,
): KotaJsonObject | null {
  const trigger = (run as WorkflowRunMetadata & { trigger?: unknown }).trigger;
  if (trigger === undefined) {
    if (run.status === "running") {
      throw new Error(
        `Malformed current workflow run "${run.id}": missing trigger`,
      );
    }
    return null;
  }
  if (
    typeof trigger !== "object" ||
    trigger === null ||
    Array.isArray(trigger) ||
    typeof (trigger as { event?: unknown }).event !== "string" ||
    typeof (trigger as { payload?: unknown }).payload !== "object" ||
    (trigger as { payload?: unknown }).payload === null ||
    Array.isArray((trigger as { payload?: unknown }).payload)
  ) {
    throw new Error(`Malformed workflow run "${run.id}": invalid trigger`);
  }
  return (trigger as { payload: KotaJsonObject }).payload;
}

export function taskIdentityFromRunTrigger(
  run: WorkflowRunMetadata,
): Readonly<{ taskId: string | null; taskTitle: string | null }> {
  const payload = reportRunTriggerPayload(run);
  if (payload === null) return { taskId: null, taskTitle: null };
  if (run.workflow === "builder") {
    try {
      const task = readBuilderTaskPayload(payload);
      return {
        taskId: task.taskId,
        taskTitle: typeof payload.title === "string" ? payload.title : null,
      };
    } catch {
      return { taskId: null, taskTitle: null };
    }
  }
  return {
    taskId: typeof payload.taskId === "string" ? payload.taskId : null,
    taskTitle: typeof payload.title === "string" ? payload.title : null,
  };
}

export function readAutonomyRunDeliveryEvidence(
  runsDir: string,
  run: WorkflowRunMetadata,
): AutonomyRunDeliveryEvidence | null {
  const integration = readWriterIntegrationEvidence(runsDir, run.id);
  if (integration === null) return null;
  const task = taskIdentityFromRunTrigger(run);
  return {
    ...integration,
    ...task,
    costUsd: run.totalCostUsd ?? null,
    durationMs: run.durationMs ?? null,
  };
}
