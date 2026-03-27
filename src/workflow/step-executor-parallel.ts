import type { WorkflowStepContext, WorkflowStepResult } from "./run-types.js";
import { executeCodeStep, shouldRunStep } from "./step-executor.js";
import type { WorkflowParallelGroup } from "./types.js";

export type ParallelGroupResult = {
  groupResult: WorkflowStepResult;
  innerResults: WorkflowStepResult[];
  hadNewWarnings: boolean;
  groupFailed: boolean;
};

export async function executeParallelStepGroup(
  step: WorkflowParallelGroup,
  context: WorkflowStepContext,
  stepStartedAt: number,
): Promise<ParallelGroupResult> {
  const childStartedAt = new Date(stepStartedAt).toISOString();
  const childResults = await Promise.allSettled(
    step.steps.map(async (childStep) => {
      if (!(await shouldRunStep(childStep, context))) {
        return { childStep, skipped: true, output: null as unknown };
      }
      const output = await executeCodeStep(childStep, context);
      return { childStep, skipped: false, output };
    }),
  );

  let groupFailed = false;
  let hadNewWarnings = false;
  const innerResults: WorkflowStepResult[] = [];
  const childCompletedAt = new Date().toISOString();

  for (let i = 0; i < step.steps.length; i++) {
    const childStep = step.steps[i];
    const result = childResults[i];
    if (result.status === "fulfilled") {
      if (result.value.skipped) {
        innerResults.push({
          id: childStep.id,
          type: "code",
          status: "skipped",
          startedAt: childStartedAt,
          completedAt: childCompletedAt,
          durationMs: 0,
        });
      } else {
        innerResults.push({
          id: childStep.id,
          type: "code",
          status: "success",
          startedAt: childStartedAt,
          completedAt: childCompletedAt,
          durationMs: 0,
          output: result.value.output,
        });
      }
    } else {
      const err = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
      innerResults.push({
        id: childStep.id,
        type: "code",
        status: "failed",
        startedAt: childStartedAt,
        completedAt: childCompletedAt,
        durationMs: 0,
        error: err.message,
        ...(childStep.continueOnFailure ? { continueOnFailure: true } : {}),
      });
      if (childStep.continueOnFailure) hadNewWarnings = true;
      else groupFailed = true;
    }
  }

  const groupOutput = { steps: innerResults };
  const groupResult: WorkflowStepResult = {
    id: step.id,
    type: "parallel",
    status: groupFailed ? "failed" : "success",
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
    output: groupOutput,
    ...(step.continueOnFailure && groupFailed ? { continueOnFailure: true } : {}),
  };

  return { groupResult, innerResults, hadNewWarnings, groupFailed };
}
