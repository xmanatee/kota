import {
  type AgentUsageCost,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/usage.js";
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
    cost: AgentUsageCost;
    durationMs: number | null;
  }>;

export function reportRunTriggerPayload(
  run: WorkflowRunMetadata,
): Record<string, unknown> {
  return run.trigger.payload;
}

export function taskIdentityFromRunTrigger(
  run: WorkflowRunMetadata,
): Readonly<{ taskId: string | null; taskTitle: string | null }> {
  const payload = reportRunTriggerPayload(run);
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
    cost: run.usage?.cost ?? UNKNOWN_AGENT_USAGE.cost,
    durationMs: run.durationMs ?? null,
  };
}
