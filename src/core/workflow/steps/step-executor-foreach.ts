import type { EventBus } from "#core/events/event-bus.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { ActiveWorkflowRunHandle } from "../active-run-handle.js";
import { buildStepCompletedPayload, buildStepStartedPayload, resolveStepAutonomyMode } from "../event-payloads.js";
import { buildSkippedResult, executeWorkflowStep, type StepAccumulators } from "../run-executor-step.js";
import type { WorkflowStepContext, WorkflowStepResult, WorkflowStepSkipReason } from "../run-types.js";
import type { WorkflowAgentStep, WorkflowCodeStep, WorkflowForeachStep } from "../step-types.js";
import type { WorkflowAgentBackoffSignal, WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";
import { evaluateStepRunDecision, resolveValue } from "./step-executor.js";
import type { AgentStepConfig } from "./step-executor-agent.js";

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
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
};

type ForeachAgentDeps = {
  definition: WorkflowDefinition;
  run: Pick<ActiveWorkflowRunHandle, "metadata" | "recordStep" | "appendAgentMessage" | "writeAgentInputs">;
  trigger: WorkflowRunTrigger;
  runAbortController: AbortController;
  agentConfig: AgentStepConfig;
};

type ForeachRunDeps = ForeachAgentDeps & {
  acc: StepAccumulators;
  bus: EventBus;
  pbus: ProjectScopedEventBus;
  log: (message: string) => void;
  /** Preserved item results from a prior run, used by retryFailedItems partial-resume. */
  priorItemResults?: ForeachItemResult[];
};

type InnerStepExecution = {
  result: WorkflowStepResult;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
};

type ItemExecution = {
  itemResult: ForeachItemResult;
  thrownError?: Error;
};

async function executeInnerStep(
  innerStep: WorkflowCodeStep | WorkflowAgentStep,
  context: WorkflowStepContext,
  itemIndex: number,
  deps: ForeachRunDeps,
): Promise<InnerStepExecution> {
  const stepStartedAt = Date.now();
  const innerContext: WorkflowStepContext = {
    ...context,
    runTool: (name, input, toolContext) =>
      context.runTool(name, input, {
        stepId: toolContext?.stepId ?? innerStep.id,
      }),
  };

  const runDecision = await evaluateStepRunDecision(innerStep, innerContext);
  if (!runDecision.run) {
    return {
      result: buildSkippedResult(
        innerStep,
        stepStartedAt,
        deps.acc,
        (result) => deps.run.recordStep(result),
        deps.pbus,
        deps.run.metadata,
        deps.definition.defaultAutonomyMode,
        runDecision.skipReason,
      ),
    };
  }

  deps.pbus.emit(
    "workflow.step.started",
    buildStepStartedPayload(deps.run.metadata, innerStep, deps.definition.defaultAutonomyMode),
  );
  deps.log(
    `Starting foreach item[${itemIndex}] step "${innerStep.id}" (${innerStep.type}) in workflow "${deps.definition.name}"`,
  );

  const { completed, agentBackoff, thrownError } = await executeWorkflowStep(
    deps.definition,
    innerStep,
    deps.run,
    deps.trigger,
    innerContext,
    deps.runAbortController,
    deps.agentConfig,
    deps.acc,
    { bus: deps.bus, pbus: deps.pbus, log: deps.log },
    stepStartedAt,
  );
  return { result: completed, agentBackoff, thrownError };
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
    deps.pbus.emit(
      "workflow.step.completed",
      buildStepCompletedPayload(
        deps.run.metadata,
        failed,
        resolveStepAutonomyMode(step, deps.definition.defaultAutonomyMode),
      ),
    );
    return {
      groupResult: failed,
      itemResults: [],
      hadNewWarnings: false,
      groupFailed: true,
      thrownError: error,
    };
  }

  // Partial-resume: when priorItemResults is provided and count matches, skip
  // already-successful items and preserve their results.
  const priorResults = deps.priorItemResults;
  const usePartialResume = priorResults !== undefined && priorResults.length === items.length;
  if (priorResults !== undefined && !usePartialResume) {
    deps.log(
      `foreach step "${step.id}" item count changed (prior: ${priorResults.length}, now: ${items.length}) — falling back to full re-run in workflow "${deps.definition.name}"`,
    );
  }

  deps.log(
    `foreach step "${step.id}" iterating over ${items.length} item(s) in workflow "${deps.definition.name}"`,
  );

  if (items.length === 0) {
    const foreachEmptyReason: WorkflowStepSkipReason = { kind: "foreach-empty" };
    const skippedAt = new Date(stepStartedAt).toISOString();
    for (const innerStep of step.steps) {
      const skipped: WorkflowStepResult = {
        id: innerStep.id,
        type: innerStep.type,
        status: "skipped",
        startedAt: skippedAt,
        completedAt: skippedAt,
        durationMs: 0,
        skipReason: foreachEmptyReason,
      };
      deps.acc.stepOutputsById[innerStep.id] = { skipped: true };
      deps.acc.stepResultsById[innerStep.id] = skipped;
      deps.pbus.emit(
        "workflow.step.completed",
        buildStepCompletedPayload(
          deps.run.metadata,
          skipped,
          resolveStepAutonomyMode(innerStep, deps.definition.defaultAutonomyMode),
        ),
      );
    }
  }

  const itemResults: ForeachItemResult[] = [];
  let hadNewWarnings = false;
  let groupFailed = false;
  let agentBackoff: WorkflowAgentBackoffSignal | undefined;
  let thrownError: Error | undefined;

  async function executeOneItem(item: unknown, i: number): Promise<ItemExecution> {
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
    let iterationThrownError: Error | undefined;

    for (const innerStep of step.steps) {
      const execution = await executeInnerStep(innerStep, itemContext, i, deps);
      const result = execution.result;
      if (execution.agentBackoff !== undefined && agentBackoff === undefined) {
        agentBackoff = execution.agentBackoff;
      }
      iterationStepResults[innerStep.id] = result;

      if (result.status === "failed") {
        if (result.continueOnFailure) {
          // inner step allows continuation; item succeeds but accumulates a warning
          hadNewWarnings = true;
        } else {
          iterationFailed = true;
          iterationThrownError = execution.thrownError ?? new Error(result.error ?? `Step "${innerStep.id}" failed`);
          break;
        }
      }
    }

    return {
      itemResult: {
        index: i,
        status: iterationFailed ? "failed" : "success",
        steps: iterationStepResults,
      },
      ...(iterationThrownError ? { thrownError: iterationThrownError } : {}),
    };
  }

  function handleItemResult(
    itemResult: ForeachItemResult,
    index: number,
    itemThrownError?: Error,
  ): void {
    itemResults.push(itemResult);
    if (itemResult.status === "failed") {
      const failedStep = Object.values(itemResult.steps).find((s) => s.status === "failed" && !s.continueOnFailure);
      groupFailed = true;
      thrownError = thrownError ?? itemThrownError ?? new Error(failedStep?.error ?? `Item ${index} failed`);
      if (step.continueOnFailure) {
        hadNewWarnings = true;
      }
    }
  }

  const maxConcurrency = step.maxConcurrency ?? 1;

  if (maxConcurrency <= 1) {
    for (let i = 0; i < items.length; i++) {
      if (usePartialResume && priorResults![i].status === "success") {
        handleItemResult(priorResults![i], i);
        continue;
      }
      const execution = await executeOneItem(items[i], i);
      handleItemResult(execution.itemResult, i, execution.thrownError);
      if (groupFailed && !step.continueOnFailure) break;
    }
  } else {
    for (let batchStart = 0; batchStart < items.length; batchStart += maxConcurrency) {
      const batchEnd = Math.min(batchStart + maxConcurrency, items.length);
      const batchSettled = await Promise.allSettled(
        items.slice(batchStart, batchEnd).map((item, j): Promise<ItemExecution> => {
          const absIndex = batchStart + j;
          if (usePartialResume && priorResults![absIndex].status === "success") {
            return Promise.resolve({ itemResult: priorResults![absIndex] });
          }
          return executeOneItem(item, absIndex);
        }),
      );

      for (let j = 0; j < batchSettled.length; j++) {
        const settled = batchSettled[j];
        if (settled.status === "fulfilled") {
          handleItemResult(
            settled.value.itemResult,
            batchStart + j,
            settled.value.thrownError,
          );
        } else {
          handleItemResult(
            { index: batchStart + j, status: "failed" as const, steps: {} },
            batchStart + j,
            settled.reason instanceof Error ? settled.reason : new Error(String(settled.reason)),
          );
        }
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

  return {
    groupResult,
    itemResults,
    hadNewWarnings,
    groupFailed,
    ...(agentBackoff ? { agentBackoff } : {}),
    ...(thrownError ? { thrownError } : {}),
  };
}
