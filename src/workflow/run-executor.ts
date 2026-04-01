import type { KotaConfig } from "../config.js";
import type { EventBus } from "../event-bus.js";
import {
  buildStepCompletedPayload,
  buildStepStartedPayload,
  buildWorkflowCompletedPayload,
} from "./event-payloads.js";
import { buildSkippedResult, executeWorkflowStep } from "./run-executor-step.js";
import { buildRetryInitialState } from "./run-executor-utils.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunExecutionResult, WorkflowRunStatus } from "./run-types.js";
import { createStepContext } from "./step-context.js";
import {
  type AgentStepConfig,
  AgentStepRuntimeError,
  shouldRunStep,
} from "./step-executor.js";
import { executeParallelStepGroup, type ParallelAgentDeps } from "./step-executor-parallel.js";
import type { WorkflowDefinition, WorkflowRunTrigger } from "./types.js";

export type RunExecutorDeps = {
  projectDir: string;
  bus: EventBus;
  store: WorkflowRunStore;
  model?: string;
  config?: KotaConfig;
  log: (message: string) => void;
  /**
   * Optional callback invoked by trigger steps to queue or run another workflow.
   * When omitted, trigger steps throw at runtime.
   */
  triggerWorkflow?: (
    workflowName: string,
    payload: Record<string, unknown>,
    waitFor: "queued" | "completed",
    signal?: AbortSignal,
  ) => Promise<{ runId: string; status: "queued" | "completed" | "failed" }>;
};

export function executeWorkflowRun(
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
  deps: RunExecutorDeps,
): { promise: Promise<WorkflowRunExecutionResult>; abortController: AbortController } {
  const run = deps.store.createRun(definition, trigger);
  const startedAt = Date.now();
  const abortController = new AbortController();

  let runTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (definition.runTimeoutMs !== undefined) {
    runTimeoutHandle = setTimeout(() => {
      abortController.abort(
        new Error(`Workflow "${definition.name}" run timed out after ${definition.runTimeoutMs}ms`),
      );
    }, definition.runTimeoutMs);
  }

  deps.bus.emit("workflow.started", {
    workflow: definition.name,
    runId: run.metadata.id,
    triggerEvent: trigger.event,
    definitionPath: run.metadata.definitionPath,
    runDir: run.metadata.runDir,
    startedAt: run.metadata.startedAt,
  });
  deps.log(`Starting workflow "${definition.name}" (${run.metadata.id})`);

  const promise = (async (): Promise<WorkflowRunExecutionResult> => {
    let agentBackoff: WorkflowRunExecutionResult["agentBackoff"];
    const retryOfId = typeof trigger.payload.retryOf === "string" ? trigger.payload.retryOf : undefined;
    const retryState = buildRetryInitialState(
      retryOfId,
      definition.steps,
      (result) => run.recordStep(result),
      deps.store.runsDir,
    );
    const { stepOutputsById, stepResultsById, stepOutputs, retryFromIndex } = retryState;
    let previousOutput = retryState.previousOutput;
    let hadWarnings = retryState.hadWarnings;
    const acc = { stepOutputsById, stepResultsById, stepOutputs };

    // Inject webhook trigger payload so steps can access it via stepOutputs.trigger
    if (trigger.event === "webhook") {
      const { _runId: _ignored, ...webhookPayload } = trigger.payload as { _runId?: string; body: unknown; headers: Record<string, string>; timestamp: string };
      stepOutputsById.trigger = webhookPayload;
    }
    const stepDeps = { bus: deps.bus, log: deps.log };

    try {
      for (let stepIdx = 0; stepIdx < definition.steps.length; stepIdx++) {
        if (stepIdx < retryFromIndex) continue;
        const step = definition.steps[stepIdx];
        const context = createStepContext(
          run.metadata,
          trigger,
          previousOutput,
          stepOutputsById,
          stepResultsById,
          stepOutputs,
          deps,
        );
        const stepStartedAt = Date.now();

        const agentConfig: AgentStepConfig = {
          model: deps.model,
          config: deps.config,
          projectDir: deps.projectDir,
          log: deps.log,
        };

        if (!(await shouldRunStep(step, context))) {
          buildSkippedResult(step, stepStartedAt, acc, (r) => run.recordStep(r), deps.bus, run.metadata);
          continue;
        }

        deps.bus.emit(
          "workflow.step.started",
          buildStepStartedPayload(run.metadata, step),
        );
        deps.log(`Starting step "${step.id}" (${step.type}) in workflow "${definition.name}"`);

        if (step.type === "parallel") {
          const parallelAgentDeps: ParallelAgentDeps = {
            definition,
            run,
            trigger,
            runAbortController: abortController,
            agentConfig,
          };
          const { groupResult, innerResults, hadNewWarnings, groupFailed } =
            await executeParallelStepGroup(step, context, stepStartedAt, parallelAgentDeps);
          run.recordStep(groupResult);
          stepOutputsById[step.id] = groupResult.output;
          stepResultsById[step.id] = groupResult;
          for (const child of innerResults) {
            stepResultsById[child.id] = child;
            stepOutputsById[child.id] =
              child.status === "success" ? child.output : { skipped: true };
          }
          stepOutputs.push(groupResult.output);
          previousOutput = groupResult.output;
          deps.bus.emit(
            "workflow.step.completed",
            buildStepCompletedPayload(run.metadata, groupResult),
          );
          deps.log(
            `Completed step "${step.id}" (parallel) in workflow "${definition.name}" [${groupResult.durationMs}ms]`,
          );
          if (groupFailed) {
            if (step.continueOnFailure) { hadWarnings = true; continue; }
            const failedChildren = innerResults.filter((r) => r.status === "failed" && !r.continueOnFailure);
            throw new Error(
              `Parallel group "${step.id}" failed: ${failedChildren.map((r) => `${r.id}: ${r.error ?? "unknown"}`).join("; ")}`,
            );
          }
          if (hadNewWarnings) hadWarnings = true;
          continue;
        }

        const { completed, agentBackoff: stepBackoff, thrownError } = await executeWorkflowStep(
          definition, step, run, trigger, context, abortController, agentConfig, acc, stepDeps, stepStartedAt,
        );
        if (stepBackoff && !agentBackoff) agentBackoff = stepBackoff;
        if (completed.status === "success") previousOutput = completed.output;
        else if (completed.continueOnFailure) { hadWarnings = true; }
        else if (thrownError) throw thrownError;

        if (definition.costLimitUsd !== undefined) {
          const accumulatedCost = run.metadata.steps.reduce((sum, s) => {
            if (s.output && typeof s.output === "object" && !Array.isArray(s.output)) {
              const cost = (s.output as Record<string, unknown>).totalCostUsd;
              if (typeof cost === "number") return sum + cost;
            }
            return sum;
          }, 0);
          if (accumulatedCost > definition.costLimitUsd) {
            throw new Error(
              `Workflow "${definition.name}" exceeded per-run cost cap of $${definition.costLimitUsd.toFixed(2)}: accumulated $${accumulatedCost.toFixed(2)}`,
            );
          }
        }
      }

      const finalStatus = hadWarnings ? "completed-with-warnings" : "success";
      const completed = run.finish({
        status: finalStatus,
        durationMs: Date.now() - startedAt,
      });
      deps.bus.emit(
        "workflow.completed",
        buildWorkflowCompletedPayload(completed, finalStatus),
      );
      deps.log(`Completed workflow "${definition.name}" (${completed.id})`);
      return {
        metadata: completed,
        ...(agentBackoff ? { agentBackoff } : {}),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!agentBackoff && err instanceof AgentStepRuntimeError) {
        agentBackoff = {
          kind: err.kind,
          reason: err.message,
        };
      }
      const status: WorkflowRunStatus =
        abortController.signal.aborted || err.name === "AbortError"
          ? "interrupted"
          : "failed";
      const completed = run.finish({
        status,
        durationMs: Date.now() - startedAt,
        error: err.message,
      });
      deps.bus.emit(
        "workflow.completed",
        buildWorkflowCompletedPayload(completed, status),
      );
      deps.log(
        `${status === "interrupted" ? "Interrupted" : "Failed"} workflow "${definition.name}" (${completed.id}): ${err.message}`,
      );
      return {
        metadata: completed,
        ...(agentBackoff ? { agentBackoff } : {}),
      };
    } finally {
      clearTimeout(runTimeoutHandle);
    }
  })();

  return { promise, abortController };
}
