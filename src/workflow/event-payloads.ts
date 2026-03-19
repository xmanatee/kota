import type { BusEvents } from "../event-bus.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunStatus,
  WorkflowStep,
  WorkflowStepResult,
} from "./types.js";

export function buildStepStartedPayload(
  metadata: WorkflowRunMetadata,
  step: WorkflowStep,
): BusEvents["workflow.step.started"] {
  return {
    workflow: metadata.workflow,
    runId: metadata.id,
    stepId: step.id,
    stepType: step.type,
    runDir: metadata.runDir,
    definitionPath: metadata.definitionPath,
    startedAt: new Date().toISOString(),
  };
}

export function buildStepCompletedPayload(
  metadata: WorkflowRunMetadata,
  result: WorkflowStepResult,
): BusEvents["workflow.step.completed"] {
  return {
    workflow: metadata.workflow,
    runId: metadata.id,
    stepId: result.id,
    stepType: result.type,
    status: result.status,
    durationMs: result.durationMs,
    runDir: metadata.runDir,
    definitionPath: metadata.definitionPath,
  };
}

export function buildWorkflowCompletedPayload(
  metadata: WorkflowRunMetadata,
  status: WorkflowRunStatus,
): BusEvents["workflow.completed"] {
  return {
    workflow: metadata.workflow,
    runId: metadata.id,
    status,
    triggerEvent: metadata.trigger.event,
    durationMs: metadata.durationMs ?? 0,
    definitionPath: metadata.definitionPath,
    runDir: metadata.runDir,
  };
}
