import type { EventBus } from "#core/events/event-bus.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { ActiveWorkflowRunHandle } from "../active-run-handle.js";
import { buildStepStartedPayload } from "../event-payloads.js";
import { buildSkippedResult, executeWorkflowStep, type StepAccumulators } from "../run-executor-step.js";
import type { WorkflowStepContext, WorkflowStepResult } from "../run-types.js";
import type { WorkflowParallelGroup } from "../step-types.js";
import type { WorkflowAgentBackoffSignal, WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";
import { evaluateStepRunDecision } from "./step-executor.js";
import type { AgentStepConfig } from "./step-executor-agent.js";

export type ParallelGroupResult = {
  groupResult: WorkflowStepResult;
  innerResults: WorkflowStepResult[];
  hadNewWarnings: boolean;
  groupFailed: boolean;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
};

type ParallelChildOutcome = {
  childStep: WorkflowParallelGroup["steps"][number];
  result: WorkflowStepResult;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
};

/** Deps required only when the parallel group contains agent steps. */
export type ParallelAgentDeps = {
  definition: WorkflowDefinition;
  run: Pick<ActiveWorkflowRunHandle, "metadata" | "recordStep" | "appendAgentMessage" | "writeAgentInputs">;
  trigger: WorkflowRunTrigger;
  runAbortController: AbortController;
  agentConfig: AgentStepConfig;
  acc: StepAccumulators;
  bus: EventBus;
  pbus: ProjectScopedEventBus;
  log: (message: string) => void;
};

class Semaphore {
  private slots: number;
  private waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.slots = limit;
  }

  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.slots++;
    }
  }
}

export async function executeParallelStepGroup(
  step: WorkflowParallelGroup,
  context: WorkflowStepContext,
  stepStartedAt: number,
  agentDeps: ParallelAgentDeps,
): Promise<ParallelGroupResult> {
  const agentStepCount = step.steps.filter((s) => s.type === "agent").length;
  const semaphore = agentStepCount > 0 && step.maxParallelAgents !== undefined
    ? new Semaphore(step.maxParallelAgents)
    : null;

  const runChild = async (
    childStep: WorkflowParallelGroup["steps"][number],
  ): Promise<ParallelChildOutcome> => {
    const childStepStartedAt = Date.now();
    const childContext: WorkflowStepContext = {
      ...context,
      stepOutputs: { ...context.stepOutputs },
      stepResults: { ...context.stepResults },
      stepOutputList: [...context.stepOutputList],
      runTool: (name, input, toolContext) =>
        context.runTool(name, input, {
          stepId: toolContext?.stepId ?? childStep.id,
        }),
    };
    const runDecision = await evaluateStepRunDecision(childStep, childContext);
    if (!runDecision.run) {
      return {
        childStep,
        result: buildSkippedResult(
          childStep,
          childStepStartedAt,
          agentDeps.acc,
          (result) => agentDeps.run.recordStep(result),
          agentDeps.pbus,
          agentDeps.run.metadata,
          agentDeps.definition.defaultAutonomyMode,
          runDecision.skipReason,
        ),
      };
    }

    agentDeps.pbus.emit(
      "workflow.step.started",
      buildStepStartedPayload(
        agentDeps.run.metadata,
        childStep,
        agentDeps.definition.defaultAutonomyMode,
      ),
    );
    agentDeps.log(
      `Starting parallel child step "${childStep.id}" (${childStep.type}) in workflow "${agentDeps.definition.name}"`,
    );

    const { completed, agentBackoff, thrownError } = await executeWorkflowStep(
      agentDeps.definition,
      childStep,
      agentDeps.run,
      agentDeps.trigger,
      childContext,
      agentDeps.runAbortController,
      agentDeps.agentConfig,
      agentDeps.acc,
      { bus: agentDeps.bus, pbus: agentDeps.pbus, log: agentDeps.log },
      childStepStartedAt,
    );
    return { childStep, result: completed, agentBackoff, thrownError };
  };

  const childResults = await Promise.allSettled(
    step.steps.map(async (childStep) => {
      if (childStep.type === "agent") {
        if (semaphore) await semaphore.acquire();
        try {
          return await runChild(childStep);
        } finally {
          if (semaphore) semaphore.release();
        }
      }

      return runChild(childStep);
    }),
  ) as Array<PromiseSettledResult<ParallelChildOutcome>>;

  let groupFailed = false;
  let hadNewWarnings = false;
  let agentBackoff: WorkflowAgentBackoffSignal | undefined;
  let thrownError: Error | undefined;
  const innerResults: WorkflowStepResult[] = [];

  for (let i = 0; i < step.steps.length; i++) {
    const childStep = step.steps[i];
    const result = childResults[i];
    if (result.status === "fulfilled") {
      const childResult = result.value.result;
      innerResults.push(childResult);
      if (result.value.agentBackoff !== undefined && agentBackoff === undefined) {
        agentBackoff = result.value.agentBackoff;
      }
      if (childResult.status === "failed") {
        if (childStep.continueOnFailure) {
          hadNewWarnings = true;
        } else {
          groupFailed = true;
          thrownError = thrownError ?? result.value.thrownError ?? new Error(childResult.error ?? `Step "${childStep.id}" failed`);
        }
      }
    } else {
      const err = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
      const failed: WorkflowStepResult = {
        id: childStep.id,
        type: childStep.type,
        status: "failed",
        startedAt: new Date(stepStartedAt).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stepStartedAt,
        error: err.message,
        ...(childStep.continueOnFailure ? { continueOnFailure: true } : {}),
      };
      agentDeps.run.recordStep(failed);
      agentDeps.acc.stepResultsById[childStep.id] = failed;
      innerResults.push(failed);
      if (childStep.continueOnFailure) hadNewWarnings = true;
      else {
        groupFailed = true;
        thrownError = thrownError ?? err;
      }
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
    ...(groupFailed && thrownError ? { error: thrownError.message } : {}),
  };

  return {
    groupResult,
    innerResults,
    hadNewWarnings,
    groupFailed,
    ...(agentBackoff ? { agentBackoff } : {}),
    ...(thrownError ? { thrownError } : {}),
  };
}
