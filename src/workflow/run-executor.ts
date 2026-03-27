import type { KotaConfig } from "../config.js";
import type { EventBus } from "../event-bus.js";
import {
  buildStepCompletedPayload,
  buildStepStartedPayload,
  buildWorkflowCompletedPayload,
} from "./event-payloads.js";
import { buildRetryInitialState } from "./run-executor-utils.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunExecutionResult, WorkflowRunStatus, WorkflowStepResult } from "./run-types.js";
import { createStepContext } from "./step-context.js";
import {
  type AgentStepConfig,
  AgentStepRuntimeError,
  executeStep,
  shouldRunStep,
} from "./step-executor.js";
import { executeParallelStepGroup } from "./step-executor-parallel.js";
import type { WorkflowDefinition, WorkflowRunTrigger } from "./types.js";

export type RunExecutorDeps = {
  projectDir: string;
  bus: EventBus;
  store: WorkflowRunStore;
  model?: string;
  config?: KotaConfig;
  log: (message: string) => void;
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
          const skipped: WorkflowStepResult = {
            id: step.id,
            type: step.type,
            status: "skipped",
            startedAt: new Date(stepStartedAt).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stepStartedAt,
          };
          run.recordStep(skipped);
          stepOutputsById[step.id] = { skipped: true };
          stepResultsById[step.id] = skipped;
          stepOutputs.push({ skipped: true });
          if (step.type === "parallel") {
            const skippedAt = new Date(stepStartedAt).toISOString();
            for (const childStep of step.steps) {
              const childSkipped: WorkflowStepResult = {
                id: childStep.id,
                type: childStep.type,
                status: "skipped",
                startedAt: skippedAt,
                completedAt: skippedAt,
                durationMs: 0,
              };
              stepOutputsById[childStep.id] = { skipped: true };
              stepResultsById[childStep.id] = childSkipped;
            }
          }
          deps.bus.emit(
            "workflow.step.completed",
            buildStepCompletedPayload(run.metadata, skipped),
          );
          continue;
        }

        deps.bus.emit(
          "workflow.step.started",
          buildStepStartedPayload(run.metadata, step),
        );
        deps.log(`Starting step "${step.id}" (${step.type}) in workflow "${definition.name}"`);

        if (step.type === "parallel") {
          const { groupResult, innerResults, hadNewWarnings, groupFailed } =
            await executeParallelStepGroup(step, context, stepStartedAt);
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

        try {
          const output = await executeStep(
            definition,
            step,
            run.metadata,
            trigger,
            context,
            abortController,
            (message) => run.appendAgentMessage(step.id, message),
            (systemPromptAppend, prompt) =>
              run.writeAgentInputs(step.id, systemPromptAppend, prompt),
            agentConfig,
          );

          const completed: WorkflowStepResult = {
            id: step.id,
            type: step.type,
            status: "success",
            startedAt: new Date(stepStartedAt).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stepStartedAt,
            output,
          };
          run.recordStep(completed);
          stepOutputsById[step.id] = output;
          stepResultsById[step.id] = completed;
          stepOutputs.push(output);
          previousOutput = output;

          deps.bus.emit(
            "workflow.step.completed",
            buildStepCompletedPayload(run.metadata, completed),
          );
          const logDetails: string[] = [`${completed.durationMs}ms`];
          if (completed.type === "agent" && completed.output && typeof completed.output === "object") {
            const o = completed.output as { turns?: unknown; totalCostUsd?: unknown; subtype?: unknown };
            if (typeof o.turns === "number") logDetails.push(`${o.turns} turn(s)`);
            if (typeof o.totalCostUsd === "number") logDetails.push(`$${o.totalCostUsd.toFixed(2)}`);
            if (typeof o.subtype === "string" && o.subtype) logDetails.push(o.subtype);
          }
          deps.log(`Completed step "${completed.id}" (${completed.type}) in workflow "${definition.name}" [${logDetails.join(", ")}]`);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          if (!agentBackoff && err instanceof AgentStepRuntimeError) {
            agentBackoff = {
              kind: err.kind,
              reason: err.message,
            };
          }
          const failed: WorkflowStepResult = {
            id: step.id,
            type: step.type,
            status: "failed",
            startedAt: new Date(stepStartedAt).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stepStartedAt,
            error: err.message,
            ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
          };
          run.recordStep(failed);
          stepResultsById[step.id] = failed;
          deps.bus.emit(
            "workflow.step.completed",
            buildStepCompletedPayload(run.metadata, failed),
          );
          deps.log(`Failed step "${failed.id}" (${failed.type}) in workflow "${definition.name}": ${failed.error ?? "unknown error"}`);
          if (step.continueOnFailure) {
            hadWarnings = true;
            continue;
          }
          throw err;
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
