import type {
  WorkflowBranchStepInput,
  WorkflowParallelGroupInput,
} from "#core/workflow/step-input-control-flow.js";
import type { HarnessExecutionState } from "./execution-state.js";
import {
  makeStepResult,
  PARENT_SKIPPED,
  whenSkipReason,
} from "./results.js";
import type { HarnessStepExecutor } from "./step-executor.js";

export async function executeBranchStep(
  branch: WorkflowBranchStepInput,
  state: HarnessExecutionState,
  executeStep: HarnessStepExecutor,
): Promise<void> {
  const context = state.buildContext();
  const shouldRun = branch.when ? Boolean(await branch.when(context)) : true;
  if (!shouldRun) {
    const reason = whenSkipReason(branch.when);
    const { harness, internal } = makeStepResult(
      branch.id,
      "branch",
      "skipped",
      undefined,
      undefined,
      reason,
    );
    state.recordResult(harness, internal, undefined);
    state.recordSkippedChildren(branch.ifTrue, PARENT_SKIPPED);
    if (branch.ifFalse) state.recordSkippedChildren(branch.ifFalse, PARENT_SKIPPED);
    return;
  }

  let conditionResult: boolean;
  try {
    conditionResult = Boolean(await branch.condition(context));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const { harness, internal } = makeStepResult(
      branch.id,
      "branch",
      "failed",
      undefined,
      `Branch condition error: ${errMsg}`,
      undefined,
    );
    state.recordResult(harness, internal, undefined);
    if (!branch.continueOnFailure) state.markFailed(errMsg);
    return;
  }

  const takenArm = conditionResult ? branch.ifTrue : (branch.ifFalse ?? []);
  const skippedArm = conditionResult ? (branch.ifFalse ?? []) : branch.ifTrue;
  const armLabel: "ifTrue" | "ifFalse" = conditionResult ? "ifTrue" : "ifFalse";

  state.recordSkippedArm(skippedArm);
  for (const armStep of takenArm) {
    if (state.runFailed && !branch.continueOnFailure) break;
    await executeStep(armStep);
  }

  const branchFailed = takenArm
    .map((step) => state.allStepResults[step.id]?.status)
    .some((status) => status === "failed");
  const branchOutput = { arm: armLabel, steps: takenArm.length };
  const { harness, internal } = makeStepResult(
    branch.id,
    "branch",
    branchFailed ? "failed" : "success",
    branchOutput,
    undefined,
    undefined,
  );
  state.recordResult(harness, internal, branchOutput);

  if (branchFailed && !branch.continueOnFailure) {
    const failed = takenArm
      .map((step) => state.allStepResults[step.id])
      .find((result) => result?.status === "failed");
    state.markFailed(failed?.error ?? "branch arm failed");
  }
}

export async function executeParallelStep(
  group: WorkflowParallelGroupInput,
  state: HarnessExecutionState,
  executeStep: HarnessStepExecutor,
): Promise<void> {
  const context = state.buildContext();
  const shouldRun = group.when ? Boolean(await group.when(context)) : true;
  if (!shouldRun) {
    const reason = whenSkipReason(group.when);
    const { harness, internal } = makeStepResult(
      group.id,
      "parallel",
      "skipped",
      undefined,
      undefined,
      reason,
    );
    state.recordResult(harness, internal, undefined);
    state.recordSkippedChildren(group.steps, PARENT_SKIPPED);
    return;
  }

  if (state.runParallel) {
    await Promise.all(group.steps.map((step) => executeStep(step)));
  } else {
    for (const step of group.steps) {
      if (state.runFailed && !group.continueOnFailure) break;
      await executeStep(step);
    }
  }

  const groupFailed = group.steps
    .map((step) => state.allStepResults[step.id]?.status)
    .some((status) => status === "failed");
  const groupOutput = {
    steps: group.steps.map((step) => state.allStepResults[step.id]),
  };
  const { harness, internal } = makeStepResult(
    group.id,
    "parallel",
    groupFailed ? "failed" : "success",
    groupOutput,
    undefined,
    undefined,
  );
  state.allStepResults[group.id] = harness;
  state.stepResultsById[group.id] = internal;

  if (groupFailed && !group.continueOnFailure) {
    const failed = group.steps
      .map((step) => state.allStepResults[step.id])
      .find((result) => result?.status === "failed");
    state.markFailed(failed?.error ?? "parallel group failed");
  }
}
