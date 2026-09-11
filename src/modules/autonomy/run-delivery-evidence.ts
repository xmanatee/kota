import {
  type AgentUsageCost,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/usage.js";
import { deriveWorkflowRunDelivery } from "#core/workflow/run-delivery.js";
import type {
  WorkflowDeliveryDisposition,
  WorkflowDeliveryDispositionKind,
  WorkflowRunMetadata,
} from "#core/workflow/run-types.js";
import {
  readWriterIntegrationEvidence,
  type WriterIntegrationEvidence,
} from "#core/workflow/writer-integration-evidence.js";

export type AutonomyRunDeliveryEvidence = WriterIntegrationEvidence &
  Readonly<{
    taskId: string | null;
    taskTitle: string | null;
    cost: AgentUsageCost;
    durationMs: number | null;
    disposition: WorkflowDeliveryDispositionKind;
    blockerReason: string | null;
    delivery: WorkflowDeliveryDisposition;
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
  // Reporting identifies stored work; current admission requirements do not invalidate historical records.
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
  const delivery = run.delivery ?? deriveWorkflowRunDelivery(run, { runsDir });
  return {
    ...integration,
    ...task,
    cost: run.usage?.cost ?? UNKNOWN_AGENT_USAGE.cost,
    durationMs: run.durationMs ?? null,
    disposition: delivery.kind,
    blockerReason: delivery.blocker ?? delivery.reason ?? null,
    delivery,
  };
}
