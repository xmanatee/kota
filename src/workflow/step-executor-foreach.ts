import type { SDKMessage } from "../agent-sdk/types.js";
import type { EventBus } from "../event-bus.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import { buildStepCompletedPayload, buildStepStartedPayload } from "./event-payloads.js";
import { applyOutputSizeLimit, DEFAULT_STEP_TIMEOUT_MS } from "./run-executor-step.js";
import type { WorkflowRunWarning, WorkflowStepContext, WorkflowStepResult } from "./run-types.js";
import { executeCodeStep, resolveValue, shouldRunStep } from "./step-executor.js";
import type { AgentStepConfig } from "./step-executor-agent.js";
import { executeAgentStep } from "./step-executor-agent.js";
import type {
  WorkflowAgentStep,
  WorkflowCodeStep,
  WorkflowDefinition,
  WorkflowForeachStep,
  WorkflowRunTrigger,
} from "./types.js";

export type ForeachItemResult = {
  index: number;
  status: "success" | "failed";
  steps: Record<string, WorkflowStepResult>;
};

export type ForeachGroupResult = {
  groupResult: WorkflowStepResult;
  itemResults: ForeachItemResult[];
  hadNewWarnings: boolean;
  groupFailed: boolean;
  thrownError?: Error;
};

type ForeachStepAccumulators = {
  stepOutputsById: Record<string, unknown>;
  stepResultsById: Record<string, WorkflowStepResult>;
  stepOutputs: unknown[];
  warnings: WorkflowRunWarning[];
};

type ForeachAgentDeps = {
  definition: WorkflowDefinition;
  run: Pick<ActiveWorkflowRunHandle, "metadata" | "appendAgentMessage" | "writeAgentInputs">;
  trigger: WorkflowRunTrigger;
  runAbortController: AbortController;
  agentConfig: AgentStepConfig;
};

type ForeachRunDeps = ForeachAgentDeps & {
  acc: ForeachStepAccumulators;
  bus: EventBus;
  log: (message: string) => void;
};

async function executeInnerStep(
  innerStep: WorkflowCodeStep | WorkflowAgentStep,
  context: WorkflowStepContext,
  itemIndex: number,
  deps: ForeachRunDeps,
): Promise<WorkflowStepResult> {
  const stepStartedAt = Date.now();

  if (!(await shouldRunStep(innerStep, context))) {
    const skipped: WorkflowStepResult = {
      id: innerStep.id,
      type: innerStep.type,
      status: "skipped",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    deps.acc.stepOutputsById[innerStep.id] = { skipped: true };
    deps.acc.stepResultsById[innerStep.id] = skipped;
    return skipped;
  }

  deps.bus.emit(
    "workflow.step.started",
    buildStepStartedPayload(deps.run.metadata, innerStep),
  );
  deps.log(
    `Starting foreach item[${itemIndex}] step "${innerStep.id}" (${innerStep.type}) in workflow "${deps.definition.name}"`,
  );

  try {
    let output: unknown;

    if (innerStep.type === "agent") {
      const timeoutMs = innerStep.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
      const stepAbortController = new AbortController();
      const forwardAbort = () => stepAbortController.abort(deps.runAbortController.signal.reason);
      deps.runAbortController.signal.addEventListener("abort", forwardAbort, { once: true });

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const err = new Error(`Step "${innerStep.id}" timed out after ${timeoutMs}ms`);
          stepAbortController.abort(err);
          reject(err);
        }, timeoutMs);
      });

      try {
        output = await Promise.race([
          executeAgentStep(
            deps.definition,
            innerStep,
            deps.run.metadata,
            deps.trigger,
            stepAbortController,
            (message: SDKMessage) => deps.run.appendAgentMessage(innerStep.id, message),
            (systemPromptAppend: string | undefined, prompt: string) =>
              deps.run.writeAgentInputs(innerStep.id, systemPromptAppend, prompt),
            deps.agentConfig,
            context.stepOutputs,
          ),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timeoutHandle);
        deps.runAbortController.signal.removeEventListener("abort", forwardAbort);
      }
    } else {
      output = await executeCodeStep(innerStep, context);
    }

    const { output: limitedOutput, warning: truncationWarning } = applyOutputSizeLimit(
      output,
      deps.agentConfig.config?.workflow?.maxStepOutputBytes,
    );
    if (truncationWarning) {
      deps.acc.warnings.push(truncationWarning);
      deps.log(`foreach step "${innerStep.id}" output truncated in workflow "${deps.definition.name}": ${truncationWarning.message}`);
    }
    const completed: WorkflowStepResult = {
      id: innerStep.id,
      type: innerStep.type,
      status: "success",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      output: limitedOutput,
    };
    deps.acc.stepOutputsById[innerStep.id] = limitedOutput;
    deps.acc.stepResultsById[innerStep.id] = completed;
    deps.acc.stepOutputs.push(limitedOutput);
    deps.bus.emit("workflow.step.completed", buildStepCompletedPayload(deps.run.metadata, completed));
    deps.log(
      `Completed foreach item[${itemIndex}] step "${innerStep.id}" in workflow "${deps.definition.name}" [${completed.durationMs}ms]`,
    );
    return completed;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const failed: WorkflowStepResult = {
      id: innerStep.id,
      type: innerStep.type,
      status: "failed",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      error: err.message,
      ...(innerStep.continueOnFailure ? { continueOnFailure: true } : {}),
    };
    deps.acc.stepResultsById[innerStep.id] = failed;
    deps.bus.emit("workflow.step.completed", buildStepCompletedPayload(deps.run.metadata, failed));
    deps.log(
      `Failed foreach item[${itemIndex}] step "${innerStep.id}" in workflow "${deps.definition.name}": ${err.message}`,
    );
    return failed;
  }
}

export async function executeForeachStepGroup(
  step: WorkflowForeachStep,
  context: WorkflowStepContext,
  stepStartedAt: number,
  deps: ForeachRunDeps,
): Promise<ForeachGroupResult> {
  let items: unknown[];
  try {
    const resolved = await resolveValue(step.items, context);
    if (!Array.isArray(resolved)) {
      throw new Error(`foreach step "${step.id}" items resolver returned a non-array value`);
    }
    items = resolved;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const failed: WorkflowStepResult = {
      id: step.id,
      type: step.type,
      status: "failed",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      error: `foreach items resolution error: ${error.message}`,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    };
    deps.bus.emit("workflow.step.completed", buildStepCompletedPayload(deps.run.metadata, failed));
    return {
      groupResult: failed,
      itemResults: [],
      hadNewWarnings: false,
      groupFailed: true,
      thrownError: error,
    };
  }

  deps.log(
    `foreach step "${step.id}" iterating over ${items.length} item(s) in workflow "${deps.definition.name}"`,
  );

  const itemResults: ForeachItemResult[] = [];
  let hadNewWarnings = false;
  let groupFailed = false;
  let thrownError: Error | undefined;

  async function executeOneItem(item: unknown, i: number): Promise<ForeachItemResult> {
    const itemContext: WorkflowStepContext = {
      ...context,
      foreach: { [step.as]: item },
      // Reflect any outputs written so far so inner steps see previous iterations
      stepOutputs: deps.acc.stepOutputsById,
      stepResults: deps.acc.stepResultsById,
      stepOutputList: deps.acc.stepOutputs,
    };

    const iterationStepResults: Record<string, WorkflowStepResult> = {};
    let iterationFailed = false;

    for (const innerStep of step.steps) {
      const result = await executeInnerStep(innerStep, itemContext, i, deps);
      iterationStepResults[innerStep.id] = result;

      if (result.status === "failed") {
        if (result.continueOnFailure) {
          // inner step allows continuation; item succeeds but accumulates a warning
          hadNewWarnings = true;
        } else {
          iterationFailed = true;
          break;
        }
      }
    }

    return { index: i, status: iterationFailed ? "failed" : "success", steps: iterationStepResults };
  }

  function handleItemResult(itemResult: ForeachItemResult, index: number): void {
    itemResults.push(itemResult);
    if (itemResult.status === "failed") {
      const failedStep = Object.values(itemResult.steps).find((s) => s.status === "failed" && !s.continueOnFailure);
      groupFailed = true;
      thrownError = thrownError ?? new Error(failedStep?.error ?? `Item ${index} failed`);
      if (step.continueOnFailure) {
        hadNewWarnings = true;
      }
    }
  }

  const maxConcurrency = step.maxConcurrency ?? 1;

  if (maxConcurrency <= 1) {
    for (let i = 0; i < items.length; i++) {
      handleItemResult(await executeOneItem(items[i], i), i);
      if (groupFailed && !step.continueOnFailure) break;
    }
  } else {
    for (let batchStart = 0; batchStart < items.length; batchStart += maxConcurrency) {
      const batchEnd = Math.min(batchStart + maxConcurrency, items.length);
      const batchSettled = await Promise.allSettled(
        items.slice(batchStart, batchEnd).map((item, j) => executeOneItem(item, batchStart + j)),
      );

      for (let j = 0; j < batchSettled.length; j++) {
        const settled = batchSettled[j];
        // executeOneItem never throws; fulfilled is always expected
        const itemResult = settled.status === "fulfilled"
          ? settled.value
          : { index: batchStart + j, status: "failed" as const, steps: {} };
        handleItemResult(itemResult, batchStart + j);
      }

      if (groupFailed && !step.continueOnFailure) break;
    }
  }

  const groupStatus = groupFailed ? "failed" : "success";
  const groupResult: WorkflowStepResult = {
    id: step.id,
    type: step.type,
    status: groupStatus,
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
    output: { items: items.length, results: itemResults },
    ...(step.continueOnFailure && groupFailed ? { continueOnFailure: true } : {}),
    ...(groupFailed && thrownError ? { error: thrownError.message } : {}),
  };

  return { groupResult, itemResults, hadNewWarnings, groupFailed, thrownError };
}
