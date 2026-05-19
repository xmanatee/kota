import type { EventBus } from "#core/events/event-bus.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { ActiveWorkflowRunHandle } from "../active-run-handle.js";
import { buildStepCompletedPayload, buildStepStartedPayload, resolveStepAutonomyMode } from "../event-payloads.js";
import { buildSkippedResult, executeWorkflowStep, type StepAccumulators } from "../run-executor-step.js";
import type { WorkflowStepContext, WorkflowStepResult, WorkflowStepSkipReason } from "../run-types.js";
import type { WorkflowBranchStep, WorkflowForeachStep, WorkflowStep } from "../step-types.js";
import type { WorkflowAgentBackoffSignal, WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";
import { evaluateStepRunDecision } from "./step-executor.js";
import type { AgentStepConfig } from "./step-executor-agent.js";
import { executeForeachStepGroup, type ForeachGroupResult } from "./step-executor-foreach.js";
import { executeParallelStepGroup, type ParallelAgentDeps } from "./step-executor-parallel.js";

type BranchRunDeps = {
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

type StepContextFactory = (currentStepId?: string) => WorkflowStepContext;

export type BranchGroupResult = {
  branchResult: WorkflowStepResult;
  arm: "ifTrue" | "ifFalse";
  hadNewWarnings: boolean;
  branchFailed: boolean;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
};

async function executeArmSteps(
  armSteps: WorkflowStep[],
  deps: BranchRunDeps,
  getContext: StepContextFactory,
): Promise<{
  hadWarnings: boolean;
  failed: boolean;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
}> {
  let hadWarnings = false;
  let agentBackoff: WorkflowAgentBackoffSignal | undefined;

  for (const armStep of armSteps) {
    const context = getContext(armStep.id);
    const stepStartedAt = Date.now();

    const runDecision = await evaluateStepRunDecision(armStep, context);
    if (!runDecision.run) {
      buildSkippedResult(
        armStep,
        stepStartedAt,
        deps.acc,
        (r) => deps.run.recordStep(r),
        deps.pbus,
        deps.run.metadata,
        deps.definition.defaultAutonomyMode,
        runDecision.skipReason,
      );
      continue;
    }

    deps.pbus.emit(
      "workflow.step.started",
      buildStepStartedPayload(deps.run.metadata, armStep, deps.definition.defaultAutonomyMode),
    );
    deps.log(`Starting step "${armStep.id}" (${armStep.type}) in workflow "${deps.definition.name}"`);

    if (armStep.type === "parallel") {
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
      const {
        groupResult,
        innerResults,
        hadNewWarnings,
        groupFailed,
        agentBackoff: parallelBackoff,
        thrownError,
      } =
        await executeParallelStepGroup(armStep, context, stepStartedAt, parallelDeps);
      if (parallelBackoff && !agentBackoff) agentBackoff = parallelBackoff;
      deps.run.recordStep(groupResult);
      deps.acc.stepOutputsById[armStep.id] = groupResult.output;
      deps.acc.stepResultsById[armStep.id] = groupResult;
      for (const child of innerResults) {
        deps.acc.stepResultsById[child.id] = child;
        deps.acc.stepOutputsById[child.id] =
          child.status === "success" ? child.output : { skipped: true };
      }
      deps.acc.stepOutputs.push(groupResult.output);
      deps.pbus.emit(
        "workflow.step.completed",
        buildStepCompletedPayload(
          deps.run.metadata,
          groupResult,
          resolveStepAutonomyMode(armStep, deps.definition.defaultAutonomyMode),
        ),
      );
      deps.log(`Completed step "${armStep.id}" (parallel) in workflow "${deps.definition.name}" [${groupResult.durationMs}ms]`);
      if (groupFailed) {
        if (armStep.continueOnFailure) { hadWarnings = true; continue; }
        const failedChildren = innerResults.filter((r) => r.status === "failed" && !r.continueOnFailure);
        const err = thrownError ?? new Error(
          `Parallel group "${armStep.id}" failed: ${failedChildren.map((r) => `${r.id}: ${r.error ?? "unknown"}`).join("; ")}`,
        );
        return { hadWarnings, failed: true, agentBackoff, thrownError: err };
      }
      if (hadNewWarnings) hadWarnings = true;
      continue;
    }

    if (armStep.type === "branch") {
      const nestedResult = await executeBranchStepGroup(armStep, context, stepStartedAt, deps, getContext);
      if (nestedResult.agentBackoff && !agentBackoff) {
        agentBackoff = nestedResult.agentBackoff;
      }
      deps.run.recordStep(nestedResult.branchResult);
      deps.acc.stepOutputsById[armStep.id] = nestedResult.branchResult.output;
      deps.acc.stepResultsById[armStep.id] = nestedResult.branchResult;
      deps.acc.stepOutputs.push(nestedResult.branchResult.output);
      deps.pbus.emit(
        "workflow.step.completed",
        buildStepCompletedPayload(
          deps.run.metadata,
          nestedResult.branchResult,
          resolveStepAutonomyMode(armStep, deps.definition.defaultAutonomyMode),
        ),
      );
      if (nestedResult.branchFailed) {
        if (armStep.continueOnFailure) { hadWarnings = true; continue; }
        return {
          hadWarnings,
          failed: true,
          agentBackoff,
          thrownError: nestedResult.thrownError,
        };
      }
      if (nestedResult.hadNewWarnings) hadWarnings = true;
      continue;
    }

    if (armStep.type === "foreach") {
      const foreachDeps = {
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
      const {
        groupResult,
        hadNewWarnings: foreachHadWarnings,
        groupFailed,
        thrownError,
        agentBackoff: foreachBackoff,
      }: ForeachGroupResult =
        await executeForeachStepGroup(armStep as WorkflowForeachStep, context, stepStartedAt, foreachDeps);
      if (foreachBackoff && !agentBackoff) agentBackoff = foreachBackoff;
      deps.run.recordStep(groupResult);
      deps.acc.stepOutputsById[armStep.id] = groupResult.output;
      deps.acc.stepResultsById[armStep.id] = groupResult;
      deps.acc.stepOutputs.push(groupResult.output);
      deps.pbus.emit(
        "workflow.step.completed",
        buildStepCompletedPayload(
          deps.run.metadata,
          groupResult,
          resolveStepAutonomyMode(armStep, deps.definition.defaultAutonomyMode),
        ),
      );
      if (groupFailed) {
        if (armStep.continueOnFailure) { hadWarnings = true; continue; }
        return { hadWarnings, failed: true, agentBackoff, thrownError };
      }
      if (foreachHadWarnings) hadWarnings = true;
      continue;
    }

    const stepDeps = { bus: deps.bus, pbus: deps.pbus, log: deps.log };
    const { completed, agentBackoff: stepBackoff, thrownError } = await executeWorkflowStep(
      deps.definition, armStep, deps.run, deps.trigger, context,
      deps.runAbortController, deps.agentConfig, deps.acc, stepDeps, stepStartedAt,
    );
    if (stepBackoff && !agentBackoff) agentBackoff = stepBackoff;
    if (completed.status === "success") {
      /* output already written to acc by executeWorkflowStep */
    } else if (completed.continueOnFailure) {
      hadWarnings = true;
    } else if (thrownError) {
      return { hadWarnings, failed: true, agentBackoff, thrownError };
    }
  }

  return {
    hadWarnings,
    failed: false,
    ...(agentBackoff ? { agentBackoff } : {}),
  };
}

export async function executeBranchStepGroup(
  step: WorkflowBranchStep,
  context: WorkflowStepContext,
  stepStartedAt: number,
  deps: BranchRunDeps,
  getContext: StepContextFactory,
): Promise<BranchGroupResult> {
  let conditionResult: boolean;
  try {
    conditionResult = Boolean(await step.condition(context));
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const failed: WorkflowStepResult = {
      id: step.id,
      type: step.type,
      status: "failed",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      error: `Branch condition error: ${error.message}`,
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
    return { branchResult: failed, arm: "ifTrue", hadNewWarnings: false, branchFailed: true, thrownError: error };
  }

  const arm: "ifTrue" | "ifFalse" = conditionResult ? "ifTrue" : "ifFalse";
  const armSteps = conditionResult ? step.ifTrue : step.ifFalse;
  const skippedArm = conditionResult ? step.ifFalse : step.ifTrue;
  const skippedAt = new Date(stepStartedAt).toISOString();
  const armNotTakenReason: WorkflowStepSkipReason = { kind: "branch-arm-not-taken" };

  // Mark skipped arm steps as skipped
  const skipArmSteps = (steps: WorkflowStep[]) => {
    for (const s of steps) {
      deps.acc.stepOutputsById[s.id] = { skipped: true };
      deps.acc.stepResultsById[s.id] = {
        id: s.id,
        type: s.type,
        status: "skipped",
        startedAt: skippedAt,
        completedAt: skippedAt,
        durationMs: 0,
        skipReason: armNotTakenReason,
      };
      if (s.type === "branch") {
        skipArmSteps(s.ifTrue);
        skipArmSteps(s.ifFalse);
      } else if (s.type === "foreach") {
        for (const innerStep of s.steps) {
          deps.acc.stepOutputsById[innerStep.id] = { skipped: true };
          deps.acc.stepResultsById[innerStep.id] = {
            id: innerStep.id,
            type: innerStep.type,
            status: "skipped",
            startedAt: skippedAt,
            completedAt: skippedAt,
            durationMs: 0,
            skipReason: armNotTakenReason,
          };
        }
      }
    }
  };
  skipArmSteps(skippedArm);

  deps.log(`Branch "${step.id}" taking ${arm} arm (${armSteps.length} step(s)) in workflow "${deps.definition.name}"`);

  const { hadWarnings, failed, agentBackoff, thrownError } = await executeArmSteps(armSteps, deps, getContext);

  const status = failed ? "failed" : "success";
  const branchResult: WorkflowStepResult = {
    id: step.id,
    type: step.type,
    status,
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
    output: { arm, steps: armSteps.length },
    ...(failed && thrownError ? { error: thrownError.message } : {}),
    ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
  };

  return {
    branchResult,
    arm,
    hadNewWarnings: hadWarnings,
    branchFailed: failed,
    ...(agentBackoff ? { agentBackoff } : {}),
    ...(thrownError ? { thrownError } : {}),
  };
}
