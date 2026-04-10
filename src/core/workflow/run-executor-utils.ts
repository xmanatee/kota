import { join } from "node:path";
import type { BusEnvelope } from "../events/event-bus.js";
import { readOptionalJsonFile } from "../../json-file.js";
import type {
  WorkflowRunMetadata,
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "./run-types.js";
import type {
  WorkflowDefinition,
  WorkflowFilterValue,
  WorkflowRunTrigger,
  WorkflowTrigger,
} from "./types.js";

export function matchesFilter(
  filter: Record<string, WorkflowFilterValue> | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    const actual = payload[key];
    if (Array.isArray(actual)) {
      if (Array.isArray(expected)) {
        if (!expected.some((value) => actual.includes(value))) return false;
        continue;
      }
      if (!actual.includes(expected)) return false;
      continue;
    }
    if (Array.isArray(expected)) {
      if (!expected.includes(actual as string | number | boolean)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

export function getEligibleAtMs(
  workflowName: string,
  cooldownMs: number,
  state: WorkflowRuntimeState,
): number {
  const lastCompletedAt = state.workflows[workflowName]?.lastCompletedAt;
  if (!lastCompletedAt || cooldownMs <= 0) return Date.now();
  return new Date(lastCompletedAt).getTime() + cooldownMs;
}

/**
 * Returns the index of the first definition step that should be re-executed on retry.
 * Steps before this index are replayed from the original run's recorded results.
 *
 * A foreach step with `retryFailedItems: true` and `continueOnFailure: true` is treated
 * as a retry point even when it has `continueOnFailure`, so the partial-resume logic
 * in the foreach executor can re-run only the failed items.
 */
export function findRetryFromIndex(
  originalSteps: WorkflowStepResult[],
  definitionSteps: ReadonlyArray<{ id: string; retryFailedItems?: boolean }>,
): number {
  for (let i = 0; i < definitionSteps.length; i++) {
    const defStep = definitionSteps[i];
    const result = originalSteps.find((s) => s.id === defStep.id);
    if (!result) return i;
    if (result.status === "failed" && !result.continueOnFailure) return i;
    if (result.status === "failed" && result.continueOnFailure && defStep.retryFailedItems) return i;
  }
  return definitionSteps.length;
}

export type RetryInitialState = {
  retryFromIndex: number;
  stepOutputsById: Record<string, unknown>;
  stepResultsById: Record<string, WorkflowStepResult>;
  stepOutputs: unknown[];
  previousOutput: unknown;
  hadWarnings: boolean;
  /** All step results from the original run, used by retryFailedItems foreach logic. */
  priorRunSteps?: WorkflowStepResult[];
};

export function buildRetryInitialState(
  retryOfId: string | undefined,
  definitionSteps: ReadonlyArray<{ id: string; type: string; retryFailedItems?: boolean }>,
  recordStep: (result: WorkflowStepResult) => void,
  runsDir: string,
): RetryInitialState {
  const state: RetryInitialState = {
    retryFromIndex: 0,
    stepOutputsById: {},
    stepResultsById: {},
    stepOutputs: [],
    previousOutput: null,
    hadWarnings: false,
  };
  if (!retryOfId) return state;

  const originalMeta = readOptionalJsonFile<WorkflowRunMetadata>(
    join(runsDir, retryOfId, "metadata.json"),
  );
  if (!originalMeta) return state;

  state.retryFromIndex = findRetryFromIndex(originalMeta.steps, definitionSteps);
  state.priorRunSteps = originalMeta.steps;
  const replayedAt = new Date().toISOString();
  for (let i = 0; i < state.retryFromIndex; i++) {
    const defStep = definitionSteps[i];
    const result = originalMeta.steps.find((s) => s.id === defStep.id);
    if (!result) { state.retryFromIndex = i; break; }
    const replayed: WorkflowStepResult = { ...result, startedAt: replayedAt, completedAt: replayedAt, durationMs: 0 };
    recordStep(replayed);
    state.stepResultsById[defStep.id] = replayed;
    if (result.status === "success") {
      state.stepOutputsById[defStep.id] = result.output;
      state.stepOutputs.push(result.output);
      state.previousOutput = result.output;
      if (result.type === "parallel") {
        const inner = result.output as { steps?: WorkflowStepResult[] } | null;
        for (const childResult of inner?.steps ?? []) {
          state.stepResultsById[childResult.id] = childResult;
          if (childResult.status === "success") {
            state.stepOutputsById[childResult.id] = childResult.output;
          } else if (childResult.status === "skipped") {
            state.stepOutputsById[childResult.id] = { skipped: true };
          }
        }
      }
    } else if (result.status === "skipped") {
      state.stepOutputsById[defStep.id] = { skipped: true };
      state.stepOutputs.push({ skipped: true });
    } else if (result.status === "failed" && result.continueOnFailure) {
      state.hadWarnings = true;
    }
  }
  return state;
}

/**
 * Returns the index of the step with the given ID in the definition, validating
 * that all preceding steps completed successfully in the original run.
 * Throws if the step is not found or a prerequisite step did not succeed.
 */
export function findResumeFromIndex(
  stepId: string,
  definitionSteps: ReadonlyArray<{ id: string }>,
  originalSteps: WorkflowStepResult[],
): number {
  const idx = definitionSteps.findIndex((s) => s.id === stepId);
  if (idx === -1) {
    throw new Error(`Step "${stepId}" not found in workflow definition`);
  }
  for (let i = 0; i < idx; i++) {
    const defStep = definitionSteps[i]!;
    const result = originalSteps.find((s) => s.id === defStep.id);
    if (!result || result.status !== "success") {
      throw new Error(
        `Cannot resume from step "${stepId}": prerequisite step "${defStep.id}" did not complete successfully in the source run`,
      );
    }
  }
  return idx;
}

export function buildResumeInitialState(
  resumedFromRunId: string,
  resumeFromStep: string,
  definitionSteps: ReadonlyArray<{ id: string; type: string }>,
  recordStep: (result: WorkflowStepResult) => void,
  runsDir: string,
): RetryInitialState {
  const originalMeta = readOptionalJsonFile<WorkflowRunMetadata>(
    join(runsDir, resumedFromRunId, "metadata.json"),
  );
  if (!originalMeta) {
    throw new Error(`Source run "${resumedFromRunId}" not found`);
  }

  const resumeFromIndex = findResumeFromIndex(resumeFromStep, definitionSteps, originalMeta.steps);
  const state: RetryInitialState = {
    retryFromIndex: resumeFromIndex,
    priorRunSteps: originalMeta.steps,
    stepOutputsById: {},
    stepResultsById: {},
    stepOutputs: [],
    previousOutput: null,
    hadWarnings: false,
  };

  const replayedAt = new Date().toISOString();
  for (let i = 0; i < resumeFromIndex; i++) {
    const defStep = definitionSteps[i]!;
    const result = originalMeta.steps.find((s) => s.id === defStep.id);
    if (!result) { state.retryFromIndex = i; break; }
    const replayed: WorkflowStepResult = {
      ...result,
      startedAt: replayedAt,
      completedAt: replayedAt,
      durationMs: 0,
      reused: true,
    };
    recordStep(replayed);
    state.stepResultsById[defStep.id] = replayed;
    if (result.status === "success") {
      state.stepOutputsById[defStep.id] = result.output;
      state.stepOutputs.push(result.output);
      state.previousOutput = result.output;
      if (result.type === "parallel") {
        const inner = result.output as { steps?: WorkflowStepResult[] } | null;
        for (const childResult of inner?.steps ?? []) {
          state.stepResultsById[childResult.id] = childResult;
          if (childResult.status === "success") {
            state.stepOutputsById[childResult.id] = childResult.output;
          } else if (childResult.status === "skipped") {
            state.stepOutputsById[childResult.id] = { skipped: true };
          }
        }
      }
    } else if (result.status === "skipped") {
      state.stepOutputsById[defStep.id] = { skipped: true };
      state.stepOutputs.push({ skipped: true });
    }
  }
  return state;
}

export function workflowUsesAgent(definition: WorkflowDefinition): boolean {
  return definition.steps.some((step) => step.type === "agent");
}

export function enqueueMatchingWorkflows(
  envelope: BusEnvelope,
  definitions: readonly WorkflowDefinition[],
  enqueue: (
    def: WorkflowDefinition,
    trigger: WorkflowTrigger,
    run: WorkflowRunTrigger,
  ) => void,
): void {
  for (const definition of definitions) {
    if (!definition.enabled) continue;
    for (const trigger of definition.triggers) {
      if (trigger.event !== envelope.type) continue;
      if (!matchesFilter(trigger.filter, envelope.payload)) continue;
      // Shallow-copy the payload so each queued run owns its own object
      // reference — safeJsonStringify treats shared references as circular.
      enqueue(definition, trigger, {
        event: envelope.type,
        payload: { ...envelope.payload },
      });
    }
  }
}
