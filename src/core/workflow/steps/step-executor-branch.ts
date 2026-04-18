import type { EventBus } from "#core/events/event-bus.js";
import type { ActiveWorkflowRunHandle } from "../active-run-handle.js";
import { buildStepCompletedPayload, buildStepStartedPayload, resolveStepAutonomyMode } from "../event-payloads.js";
import { buildSkippedResult, executeWorkflowStep, type StepAccumulators } from "../run-executor-step.js";
import type { WorkflowStepContext, WorkflowStepResult } from "../run-types.js";
import type {
  WorkflowBranchStep,
  WorkflowDefinition,
  WorkflowForeachStep,
  WorkflowRunTrigger,
  WorkflowStep,
} from "../types.js";
import { shouldRunStep } from "./step-executor.js";
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
  log: (message: string) => void;
};

export type BranchGroupResult = {
  branchResult: WorkflowStepResult;
  arm: "ifTrue" | "ifFalse";
  hadNewWarnings: boolean;
  branchFailed: boolean;
  thrownError?: Error;
};

async function executeArmSteps(
  armSteps: WorkflowStep[],
  deps: BranchRunDeps,
  getContext: () => WorkflowStepContext,
): Promise<{ hadWarnings: boolean; failed: boolean; thrownError?: Error }> {
  let hadWarnings = false;

  for (const armStep of armSteps) {
    const context = getContext();
    const stepStartedAt = Date.now();

    if (!(await shouldRunStep(armStep, context))) {
      buildSkippedResult(
        armStep,
        stepStartedAt,
        deps.acc,
        (r) => deps.run.recordStep(r),
        deps.bus,
        deps.run.metadata,
        deps.definition.defaultAutonomyMode,
      );
      continue;
    }

    deps.bus.emit(
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
      };
      const { groupResult, innerResults, hadNewWarnings, groupFailed } =
        await executeParallelStepGroup(armStep, context, stepStartedAt, parallelDeps);
      deps.run.recordStep(groupResult);
      deps.acc.stepOutputsById[armStep.id] = groupResult.output;
      deps.acc.stepResultsById[armStep.id] = groupResult;
      for (const child of innerResults) {
        deps.acc.stepResultsById[child.id] = child;
        deps.acc.stepOutputsById[child.id] =
          child.status === "success" ? child.output : { skipped: true };
      }
      deps.acc.stepOutputs.push(groupResult.output);
      deps.bus.emit(
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
        const err = new Error(
          `Parallel group "${armStep.id}" failed: ${failedChildren.map((r) => `${r.id}: ${r.error ?? "unknown"}`).join("; ")}`,
        );
        return { hadWarnings, failed: true, thrownError: err };
      }
      if (hadNewWarnings) hadWarnings = true;
      continue;
    }

    if (armStep.type === "branch") {
      const nestedResult = await executeBranchStepGroup(armStep, context, stepStartedAt, deps, getContext);
      deps.run.recordStep(nestedResult.branchResult);
      deps.acc.stepOutputsById[armStep.id] = nestedResult.branchResult.output;
      deps.acc.stepResultsById[armStep.id] = nestedResult.branchResult;
      deps.acc.stepOutputs.push(nestedResult.branchResult.output);
      deps.bus.emit(
        "workflow.step.completed",
        buildStepCompletedPayload(
          deps.run.metadata,
          nestedResult.branchResult,
          resolveStepAutonomyMode(armStep, deps.definition.defaultAutonomyMode),
        ),
      );
      if (nestedResult.branchFailed) {
        if (armStep.continueOnFailure) { hadWarnings = true; continue; }
        return { hadWarnings, failed: true, thrownError: nestedResult.thrownError };
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
        log: deps.log,
      };
      const { groupResult, hadNewWarnings: foreachHadWarnings, groupFailed, thrownError }: ForeachGroupResult =
        await executeForeachStepGroup(armStep as WorkflowForeachStep, context, stepStartedAt, foreachDeps);
      deps.run.recordStep(groupResult);
      deps.acc.stepOutputsById[armStep.id] = groupResult.output;
      deps.acc.stepResultsById[armStep.id] = groupResult;
      deps.acc.stepOutputs.push(groupResult.output);
      deps.bus.emit(
        "workflow.step.completed",
        buildStepCompletedPayload(
          deps.run.metadata,
          groupResult,
          resolveStepAutonomyMode(armStep, deps.definition.defaultAutonomyMode),
        ),
      );
      if (groupFailed) {
        if (armStep.continueOnFailure) { hadWarnings = true; continue; }
        return { hadWarnings, failed: true, thrownError };
      }
      if (foreachHadWarnings) hadWarnings = true;
      continue;
    }

    const stepDeps = { bus: deps.bus, log: deps.log };
    const { completed, thrownError } = await executeWorkflowStep(
      deps.definition, armStep, deps.run, deps.trigger, context,
      deps.runAbortController, deps.agentConfig, deps.acc, stepDeps, stepStartedAt,
    );
    if (completed.status === "success") {
      /* output already written to acc by executeWorkflowStep */
    } else if (completed.continueOnFailure) {
      hadWarnings = true;
    } else if (thrownError) {
      return { hadWarnings, failed: true, thrownError };
    }
  }

  return { hadWarnings, failed: false };
}

export async function executeBranchStepGroup(
  step: WorkflowBranchStep,
  context: WorkflowStepContext,
  stepStartedAt: number,
  deps: BranchRunDeps,
  getContext: () => WorkflowStepContext,
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
    deps.bus.emit(
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
          };
        }
      }
    }
  };
  skipArmSteps(skippedArm);

  deps.log(`Branch "${step.id}" taking ${arm} arm (${armSteps.length} step(s)) in workflow "${deps.definition.name}"`);

  const { hadWarnings, failed, thrownError } = await executeArmSteps(armSteps, deps, getContext);

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

  return { branchResult, arm, hadNewWarnings: hadWarnings, branchFailed: failed, thrownError };
}
