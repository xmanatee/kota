import {
  buildChildContext,
  type GroupStep,
  type GroupStepDeps,
  type GroupStepOutcome,
  recordCompletedGroup,
  recordFailedGroup,
} from "./run-executor-group-support.js";
import { DEFAULT_STEP_TIMEOUT_MS } from "./run-executor-step.js";
import type { WorkflowStepContext } from "./run-types.js";
import type { WorkflowBranchStep, WorkflowForeachStep, WorkflowParallelGroup } from "./step-types.js";
import { type BranchGroupResult, executeBranchStepGroup } from "./steps/step-executor-branch.js";
import {
  executeForeachStepGroup,
  type ForeachGroupResult,
  type ForeachItemResult,
} from "./steps/step-executor-foreach.js";
import {
  executeParallelStepGroup,
  type ParallelAgentDeps,
} from "./steps/step-executor-parallel.js";

async function executeParallelGroup(
  step: WorkflowParallelGroup,
  context: WorkflowStepContext,
  stepStartedAt: number,
  deps: GroupStepDeps,
): Promise<GroupStepOutcome> {
  const parallelDeps: ParallelAgentDeps = {
    definition: deps.definition,
    run: deps.run,
    trigger: deps.trigger,
    runAbortController: deps.runAbortController,
    agentConfig: deps.agentConfig,
    acc: deps.acc,
    bus: deps.bus,
    pbus: deps.pbus,
    log: deps.log,
  };
  const result = await executeParallelStepGroup(
    step,
    context,
    stepStartedAt,
    parallelDeps,
  );
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
  const stepAbortController = new AbortController();
  const forwardAbort = () => {
    stepAbortController.abort(deps.runAbortController.signal.reason);
  };
  deps.runAbortController.signal.addEventListener("abort", forwardAbort, { once: true });
  const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(`Step "${step.id}" timed out after ${timeoutMs}ms`);
      stepAbortController.abort(error);
      reject(error);
    }, timeoutMs);
  });
  let groupResult: BranchGroupResult | undefined;
  try {
    groupResult = await Promise.race([
      executeBranchStepGroup(
        step,
        context,
        stepStartedAt,
        { ...deps, runAbortController: stepAbortController },
        (currentStepId = step.id) => buildChildContext(currentStepId, deps),
      ),
      timeoutPromise,
    ]);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    recordFailedGroup(step, stepStartedAt, error, deps);
    if (step.continueOnFailure) {
      return { previousOutput: deps.previousOutput, hadWarnings: true };
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    deps.runAbortController.signal.removeEventListener("abort", forwardAbort);
  }

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
  const stepAbortController = new AbortController();
  const forwardAbort = () => {
    stepAbortController.abort(deps.runAbortController.signal.reason);
  };
  deps.runAbortController.signal.addEventListener("abort", forwardAbort, { once: true });
  const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(`Step "${step.id}" timed out after ${timeoutMs}ms`);
      stepAbortController.abort(error);
      reject(error);
    }, timeoutMs);
  });
  let groupResult: ForeachGroupResult | undefined;
  try {
    groupResult = await Promise.race([
      executeForeachStepGroup(
        step,
        buildChildContext(step.id, deps),
        stepStartedAt,
        {
          ...deps,
          runAbortController: stepAbortController,
          priorItemResults: priorForeachItemResults(step, deps),
        },
      ),
      timeoutPromise,
    ]);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    recordFailedGroup(step, stepStartedAt, error, deps);
    if (step.continueOnFailure) {
      return { previousOutput: deps.previousOutput, hadWarnings: true };
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    deps.runAbortController.signal.removeEventListener("abort", forwardAbort);
  }

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
