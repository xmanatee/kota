import type { EventBus } from "#core/events/event-bus.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { buildStepCompletedPayload, resolveStepAutonomyMode } from "./event-payloads.js";
import type { RunExecutorBoundaryValue } from "./run-executor-step.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunWarning,
  WorkflowStepResult,
  WorkflowStepSkipReason,
} from "./run-types.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowAgentBackoffSignal } from "./trigger-types.js";

export const DEFAULT_MAX_STEP_OUTPUT_BYTES = 256 * 1024;
export const HARD_MAX_STEP_OUTPUT_BYTES = 10 * 1024 * 1024;

export type TruncationNotice = {
  truncated: true;
  originalBytes: number;
  message: string;
};

export function applyOutputSizeLimit(
  output: RunExecutorBoundaryValue,
  maxBytes: number | undefined,
): { output: RunExecutorBoundaryValue; warning?: WorkflowRunWarning } {
  if (output === undefined || output === null) return { output };
  const limit = Math.min(
    maxBytes ?? DEFAULT_MAX_STEP_OUTPUT_BYTES,
    HARD_MAX_STEP_OUTPUT_BYTES,
  );
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch (error) {
    const message =
      `Step output could not be serialized: ${
        error instanceof Error ? error.message : String(error)
      }`;
    const notice: TruncationNotice = {
      truncated: true,
      originalBytes: 0,
      message,
    };
    return {
      output: notice,
      warning: { type: "step-output-truncated", message },
    };
  }
  const byteLength = Buffer.byteLength(serialized, "utf-8");
  if (byteLength <= limit) return { output };
  const notice: TruncationNotice = {
    truncated: true,
    originalBytes: byteLength,
    message:
      `Step output truncated: ${byteLength} bytes exceeds ${limit}-byte limit`,
  };
  return {
    output: notice,
    warning: { type: "step-output-truncated", message: notice.message },
  };
}

export type StepAccumulators = {
  stepOutputsById: Record<string, RunExecutorBoundaryValue>;
  stepResultsById: Record<string, WorkflowStepResult>;
  stepOutputs: RunExecutorBoundaryValue[];
  warnings: WorkflowRunWarning[];
};

export type StepDeps = {
  bus: EventBus;
  pbus: ScopedEventBus;
  log: (message: string) => void;
};

export type SingleStepResult = {
  completed: WorkflowStepResult;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
  truncationWarning?: WorkflowRunWarning;
};

const PARENT_SKIPPED_REASON: WorkflowStepSkipReason = { kind: "parent-skipped" };

export function buildSkippedResult(
  step: WorkflowStep,
  stepStartedAt: number,
  acc: StepAccumulators,
  recordStep: (result: WorkflowStepResult) => void,
  pbus: ScopedEventBus,
  runMetadata: WorkflowRunMetadata,
  defaultAutonomyMode: AutonomyMode | undefined,
  skipReason: WorkflowStepSkipReason,
): WorkflowStepResult {
  const skipped: WorkflowStepResult = {
    id: step.id,
    type: step.type,
    status: "skipped",
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
    skipReason,
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
        skipReason: PARENT_SKIPPED_REASON,
      };
      acc.stepOutputsById[childStep.id] = { skipped: true };
      acc.stepResultsById[childStep.id] = childSkipped;
    }
  } else if (step.type === "branch") {
    const skippedAt = new Date(stepStartedAt).toISOString();
    const skipArmSteps = (armSteps: typeof step.ifTrue) => {
      for (const armStep of armSteps) {
        acc.stepOutputsById[armStep.id] = { skipped: true };
        acc.stepResultsById[armStep.id] = {
          id: armStep.id,
          type: armStep.type,
          status: "skipped",
          startedAt: skippedAt,
          completedAt: skippedAt,
          durationMs: 0,
          skipReason: PARENT_SKIPPED_REASON,
        };
        if (armStep.type === "branch") {
          skipArmSteps(armStep.ifTrue);
          skipArmSteps(armStep.ifFalse);
        }
      }
    };
    skipArmSteps(step.ifTrue);
    skipArmSteps(step.ifFalse);
  } else if (step.type === "foreach") {
    const skippedAt = new Date(stepStartedAt).toISOString();
    for (const innerStep of step.steps) {
      acc.stepOutputsById[innerStep.id] = { skipped: true };
      acc.stepResultsById[innerStep.id] = {
        id: innerStep.id,
        type: innerStep.type,
        status: "skipped",
        startedAt: skippedAt,
        completedAt: skippedAt,
        durationMs: 0,
        skipReason: PARENT_SKIPPED_REASON,
      };
    }
  }
  pbus.emit(
    "workflow.step.completed",
    buildStepCompletedPayload(
      runMetadata,
      skipped,
      resolveStepAutonomyMode(step, defaultAutonomyMode),
    ),
  );
  return skipped;
}
