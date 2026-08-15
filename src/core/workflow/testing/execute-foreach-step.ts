import type { WorkflowForeachStepInput } from "#core/workflow/step-input-control-flow.js";
import { resolveValue } from "#core/workflow/steps/step-executor.js";
import type { HarnessExecutionState } from "./execution-state.js";
import type {
  HarnessOutputValue,
  HarnessStepResult,
} from "./index.js";
import {
  FOREACH_EMPTY,
  makeStepResult,
  PARENT_SKIPPED,
  resolveStepMock,
  validateWorkflowStepOutput,
  whenSkipReason,
} from "./results.js";

export async function executeForeachStep(
  foreach: WorkflowForeachStepInput,
  state: HarnessExecutionState,
): Promise<void> {
  const context = state.buildContext();
  const shouldRun = foreach.when ? Boolean(await foreach.when(context)) : true;
  if (!shouldRun) {
    const reason = whenSkipReason(foreach.when);
    const { harness, internal } = makeStepResult(
      foreach.id,
      "foreach",
      "skipped",
      undefined,
      undefined,
      reason,
    );
    state.recordResult(harness, internal, undefined);
    state.recordSkippedChildren(foreach.steps, PARENT_SKIPPED);
    return;
  }

  let items: HarnessOutputValue[];
  try {
    const resolved = await resolveValue(foreach.items, context);
    if (!Array.isArray(resolved)) {
      throw new Error(
        `foreach step "${foreach.id}" items resolver returned a non-array value`,
      );
    }
    items = resolved as HarnessOutputValue[];
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const { harness, internal } = makeStepResult(
      foreach.id,
      "foreach",
      "failed",
      undefined,
      errMsg,
      undefined,
    );
    state.recordResult(harness, internal, undefined);
    if (!foreach.continueOnFailure) state.markFailed(errMsg);
    return;
  }

  const itemResults: Array<{
    index: number;
    status: "success" | "failed";
    steps: Record<string, HarnessStepResult>;
  }> = [];
  let foreachFailed = false;

  if (items.length === 0) {
    state.recordSkippedChildren(foreach.steps, FOREACH_EMPTY);
  }

  const runIteration = async (
    index: number,
    item: HarnessOutputValue,
  ): Promise<void> => {
    const iterStepOutputsById: Record<string, HarnessOutputValue> = {};
    const iterHarnessResults: Record<string, HarnessStepResult> = {};
    let iterFailed = false;

    for (const innerStep of foreach.steps) {
      const iterContext = state.buildContext({
        foreach: { [foreach.as]: item },
        stepOutputs: { ...state.stepOutputsById, ...iterStepOutputsById },
        stepOutputList: [...state.stepOutputList],
      });

      const innerShouldRun = innerStep.when
        ? Boolean(await innerStep.when(iterContext))
        : true;
      if (!innerShouldRun) {
        const reason = whenSkipReason(innerStep.when);
        const { harness } = makeStepResult(
          innerStep.id,
          innerStep.type,
          "skipped",
          undefined,
          undefined,
          reason,
        );
        iterHarnessResults[innerStep.id] = harness;
        continue;
      }

      let innerOutput: HarnessOutputValue;
      let innerError: string | undefined;
      let innerStatus: "success" | "failed" = "success";

      try {
        if (innerStep.type === "agent") {
          if (!(innerStep.id in state.stepMocks)) {
            throw new Error(
              `Agent step "${innerStep.id}" requires a mock. Add stepMocks["${innerStep.id}"] to HarnessOptions.`,
            );
          }
          innerOutput = validateWorkflowStepOutput(
            innerStep,
            await resolveStepMock(state.stepMocks[innerStep.id], iterContext),
            iterContext,
          );
        } else {
          const innerRaw = await innerStep.run(iterContext);
          innerOutput = validateWorkflowStepOutput(
            innerStep,
            innerRaw,
            iterContext,
          );
        }
      } catch (err) {
        innerError = err instanceof Error ? err.message : String(err);
        innerStatus = "failed";
      }

      const { harness } = makeStepResult(
        innerStep.id,
        innerStep.type,
        innerStatus,
        innerOutput,
        innerError,
        undefined,
      );
      iterHarnessResults[innerStep.id] = harness;
      if (innerOutput !== undefined) {
        iterStepOutputsById[innerStep.id] = innerOutput;
      }

      if (innerStatus === "failed" && !innerStep.continueOnFailure) {
        iterFailed = true;
        break;
      }
    }

    const iterStatus = iterFailed ? "failed" : "success";
    itemResults.push({ index, status: iterStatus, steps: iterHarnessResults });
    if (iterFailed) foreachFailed = true;
  };

  if (state.runParallel) {
    await Promise.all(items.map((item, i) => runIteration(i, item)));
  } else {
    for (let i = 0; i < items.length; i += 1) {
      await runIteration(i, items[i]);
      if (foreachFailed && !foreach.continueOnFailure) break;
    }
  }

  const foreachOutput = { items: items.length, results: itemResults };
  const { harness, internal } = makeStepResult(
    foreach.id,
    "foreach",
    foreachFailed ? "failed" : "success",
    foreachOutput,
    undefined,
    undefined,
  );
  state.recordResult(harness, internal, foreachOutput);

  if (foreachFailed && !foreach.continueOnFailure) {
    const failedItem = itemResults.find((result) => result.status === "failed");
    const failedStep = failedItem
      ? Object.values(failedItem.steps).find((step) => step.status === "failed")
      : undefined;
    state.markFailed(failedStep?.error ?? "foreach step failed");
  }
}
