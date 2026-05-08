import type { ProjectScopedBusEventPayload } from "#core/events/event-bus-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowRunMetadata, WorkflowRunStatus, WorkflowStepResult } from "./run-types.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowAgentBackoffKind } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

/**
 * Resolve the autonomy posture that should be attached to a step-level bus
 * event. Agent steps carry an explicit `autonomyMode` (required by the
 * validator). Other step types inherit the workflow's `defaultAutonomyMode`
 * when present, and are otherwise un-tagged.
 */
export function resolveStepAutonomyMode(
  step: WorkflowStep,
  defaultAutonomyMode: AutonomyMode | undefined,
): AutonomyMode | undefined {
  if (step.type === "agent") return step.autonomyMode;
  return defaultAutonomyMode;
}

export function buildStepStartedPayload(
  metadata: WorkflowRunMetadata,
  step: WorkflowStep,
  defaultAutonomyMode: AutonomyMode | undefined,
): ProjectScopedBusEventPayload<"workflow.step.started"> {
  const autonomyMode = resolveStepAutonomyMode(step, defaultAutonomyMode);
  return {
    workflow: metadata.workflow,
    runId: metadata.id,
    stepId: step.id,
    stepType: step.type,
    runDir: metadata.runDir,
    definitionPath: metadata.definitionPath,
    startedAt: new Date().toISOString(),
    ...(autonomyMode !== undefined ? { autonomyMode } : {}),
  };
}

export function buildStepCompletedPayload(
  metadata: WorkflowRunMetadata,
  result: WorkflowStepResult,
  autonomyMode: AutonomyMode | undefined,
): ProjectScopedBusEventPayload<"workflow.step.completed"> {
  return {
    workflow: metadata.workflow,
    runId: metadata.id,
    stepId: result.id,
    stepType: result.type,
    status: result.status,
    durationMs: result.durationMs,
    ...(result.costUsd != null ? { costUsd: result.costUsd } : {}),
    runDir: metadata.runDir,
    definitionPath: metadata.definitionPath,
    ...(autonomyMode !== undefined ? { autonomyMode } : {}),
    ...(result.skipReason !== undefined ? { skipReason: result.skipReason } : {}),
  };
}

export function buildWorkflowStartedPayload(
  metadata: WorkflowRunMetadata,
  definition: Pick<WorkflowDefinition, "defaultAutonomyMode">,
): ProjectScopedBusEventPayload<"workflow.started"> {
  return {
    workflow: metadata.workflow,
    runId: metadata.id,
    triggerEvent: metadata.trigger.event,
    definitionPath: metadata.definitionPath,
    runDir: metadata.runDir,
    startedAt: metadata.startedAt,
    ...(definition.defaultAutonomyMode !== undefined
      ? { autonomyMode: definition.defaultAutonomyMode }
      : {}),
  };
}

export function buildWorkflowCompletedPayload(
  metadata: WorkflowRunMetadata,
  status: WorkflowRunStatus,
  tags: readonly string[] = [],
  failureKind?: WorkflowAgentBackoffKind,
  autonomyMode?: AutonomyMode,
): ProjectScopedBusEventPayload<"workflow.completed"> {
  return {
    workflow: metadata.workflow,
    runId: metadata.id,
    status,
    triggerEvent: metadata.trigger.event,
    durationMs: metadata.durationMs ?? 0,
    definitionPath: metadata.definitionPath,
    runDir: metadata.runDir,
    tags,
    ...(failureKind ? { failureKind } : {}),
    ...(autonomyMode !== undefined ? { autonomyMode } : {}),
  };
}
