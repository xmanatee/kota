import {
  activeTimingMetadata,
  createActiveTimeout,
  rejectWhenActiveTimeoutExpires,
  type ActiveTimeoutSnapshot,
} from "./active-timeout.js";
import {
  buildChildContext,
  type GroupStep,
  type GroupStepDeps,
  type GroupStepOutcome,
  recordCompletedGroup,
  recordFailedGroup,
} from "./run-executor-group-support.js";
import { DEFAULT_STEP_TIMEOUT_MS } from "./run-executor-step.js";
import type { WorkflowStepContext, WorkflowStepResult } from "./run-types.js";
import type { WorkflowBranchStep, WorkflowForeachStep, WorkflowParallelGroup } from "./step-types.js";
import { type BranchGroupResult, executeBranchStepGroup } from "./steps/step-executor-branch.js";
import {
  executeForeachStepGroup,
  type ForeachGroupResult,
  type ForeachItemResult,
} from "./steps/step-executor-foreach.js";
import { executeParallelStepGroup } from "./steps/step-executor-parallel.js";

type TimedGroupExecution<T> =
  | { completed: true; result: T; timing: ActiveTimeoutSnapshot }
  | { completed: false; outcome: GroupStepOutcome };

async function executeTimedGroup<T>(
  step: WorkflowBranchStep | WorkflowForeachStep,
  stepStartedAt: number,
  deps: GroupStepDeps,
  execute: (abortController: AbortController) => Promise<T>,
): Promise<TimedGroupExecution<T>> {
  const abortController = new AbortController();
  const forwardAbort = () => {
    abortController.abort(deps.runAbortController.signal.reason);
  };
  deps.runAbortController.signal.addEventListener("abort", forwardAbort, { once: true });
  const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const activeTimeout = createActiveTimeout(
    timeoutMs,
    () => new Error(`Step "${step.id}" timed out after ${timeoutMs}ms of active runtime`),
    (error) => abortController.abort(error),
  );
  try {
    const result = await Promise.race([
      execute(abortController),
      rejectWhenActiveTimeoutExpires(activeTimeout),
    ]);
    return { completed: true, result, timing: activeTimeout.snapshot() };
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    recordFailedGroup(step, stepStartedAt, error, deps, activeTimeout.snapshot());
    if (step.continueOnFailure) {
      return {
        completed: false,
        outcome: { previousOutput: deps.previousOutput, hadWarnings: true },
      };
    }
    throw error;
  } finally {
    activeTimeout.dispose();
    deps.runAbortController.signal.removeEventListener("abort", forwardAbort);
  }
}

function applyGroupTiming(
  result: WorkflowStepResult,
  timing: ActiveTimeoutSnapshot,
): void {
  Object.assign(result, activeTimingMetadata(timing));
}

async function executeParallelGroup(
  step: WorkflowParallelGroup,
  context: WorkflowStepContext,
  stepStartedAt: number,
  deps: GroupStepDeps,
): Promise<GroupStepOutcome> {
  const result = await executeParallelStepGroup(step, context, stepStartedAt, deps);
  recordCompletedGroup(step, result.groupResult, deps);
  for (const child of result.innerResults) {
    deps.acc.stepResultsById[child.id] = child;
    deps.acc.stepOutputsById[child.id] =
      child.status === "success" ? child.output : { skipped: true };
  }
  if (result.groupFailed) {
    if (step.continueOnFailure) {
      return {
        previousOutput: result.groupResult.output,
        hadWarnings: true,
        ...(result.agentBackoff ? { agentBackoff: result.agentBackoff } : {}),
      };
    }
    if (result.thrownError) throw result.thrownError;
    const failedChildren = result.innerResults.filter(
      (child) => child.status === "failed" && !child.continueOnFailure,
    );
    throw new Error(
      `Parallel group "${step.id}" failed: ${failedChildren
        .map((child) => `${child.id}: ${child.error ?? "unknown"}`)
        .join("; ")}`,
    );
  }
  return {
    previousOutput: result.groupResult.output,
    hadWarnings: result.hadNewWarnings,
    ...(result.agentBackoff ? { agentBackoff: result.agentBackoff } : {}),
  };
}

async function executeBranchGroup(
  step: WorkflowBranchStep,
  context: WorkflowStepContext,
  stepStartedAt: number,
  deps: GroupStepDeps,
): Promise<GroupStepOutcome> {
  const execution = await executeTimedGroup<BranchGroupResult>(
    step,
    stepStartedAt,
    deps,
    (abortController) =>
      executeBranchStepGroup(
        step,
        context,
        stepStartedAt,
        { ...deps, runAbortController: abortController },
        (currentStepId = step.id) => buildChildContext(currentStepId, deps),
      ),
  );
  if (!execution.completed) return execution.outcome;
  const groupResult = execution.result;
  applyGroupTiming(groupResult.branchResult, execution.timing);
  recordCompletedGroup(step, groupResult.branchResult, deps);
  if (groupResult.branchFailed) {
    if (step.continueOnFailure) {
      return {
        previousOutput: groupResult.branchResult.output,
        hadWarnings: true,
        ...(groupResult.agentBackoff ? { agentBackoff: groupResult.agentBackoff } : {}),
      };
    }
    if (groupResult.thrownError) throw groupResult.thrownError;
    throw new Error(`Branch step "${step.id}" failed`);
  }
  return {
    previousOutput: groupResult.branchResult.output,
    hadWarnings: groupResult.hadNewWarnings,
    ...(groupResult.agentBackoff ? { agentBackoff: groupResult.agentBackoff } : {}),
  };
}

type PriorForeachOutput = {
  results?: ForeachItemResult[];
};

function priorForeachItemResults(
  step: WorkflowForeachStep,
  deps: GroupStepDeps,
): ForeachItemResult[] | undefined {
  if (!step.retryFailedItems || !step.continueOnFailure || !deps.priorRunSteps) {
    return undefined;
  }
  const priorForeachResult = deps.priorRunSteps.find((result) => result.id === step.id);
  const priorOutput = priorForeachResult?.output as PriorForeachOutput | undefined;
  return Array.isArray(priorOutput?.results) ? priorOutput.results : undefined;
}

async function executeForeachGroup(
  step: WorkflowForeachStep,
  stepStartedAt: number,
  deps: GroupStepDeps,
): Promise<GroupStepOutcome> {
  const execution = await executeTimedGroup<ForeachGroupResult>(
    step,
    stepStartedAt,
    deps,
    (abortController) =>
      executeForeachStepGroup(
        step,
        buildChildContext(step.id, deps),
        stepStartedAt,
        {
          ...deps,
          runAbortController: abortController,
          priorItemResults: priorForeachItemResults(step, deps),
        },
      ),
  );
  if (!execution.completed) return execution.outcome;
  const groupResult = execution.result;
  applyGroupTiming(groupResult.groupResult, execution.timing);
  recordCompletedGroup(step, groupResult.groupResult, deps);
  if (groupResult.groupFailed) {
    if (step.continueOnFailure) {
      return {
        previousOutput: groupResult.groupResult.output,
        hadWarnings: true,
        ...(groupResult.agentBackoff ? { agentBackoff: groupResult.agentBackoff } : {}),
      };
    }
    if (groupResult.thrownError) throw groupResult.thrownError;
    throw new Error(`Foreach step "${step.id}" failed`);
  }
  return {
    previousOutput: groupResult.groupResult.output,
    hadWarnings: groupResult.hadNewWarnings,
    ...(groupResult.agentBackoff ? { agentBackoff: groupResult.agentBackoff } : {}),
  };
}

export async function executeGroupStep(
  step: GroupStep,
  context: WorkflowStepContext,
  stepStartedAt: number,
  deps: GroupStepDeps,
): Promise<GroupStepOutcome> {
  if (step.type === "parallel") {
    return executeParallelGroup(step, context, stepStartedAt, deps);
  }
  if (step.type === "branch") {
    return executeBranchGroup(step, context, stepStartedAt, deps);
  }
  return executeForeachGroup(step, stepStartedAt, deps);
}
