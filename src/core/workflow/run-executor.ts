import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import { deriveProjectId } from "#core/daemon/project-registry.js";
import type { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
  buildStepCompletedPayload,
  buildStepStartedPayload,
  buildWorkflowCompletedPayload,
  buildWorkflowStartedPayload,
} from "./event-payloads.js";
import { validatePayloadSchema } from "./payload-validator.js";
import { buildSkippedResult, DEFAULT_STEP_TIMEOUT_MS, executeWorkflowStep } from "./run-executor-step.js";
import { buildResumeInitialState, buildRetryInitialState } from "./run-executor-utils.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunExecutionResult, WorkflowRunStatus, WorkflowRunWarning, WorkflowStepResult } from "./run-types.js";
import type { WorkflowBranchStep, WorkflowForeachStep } from "./step-types.js";
import { createStepContext } from "./steps/step-context.js";
import {
  type AgentStepConfig,
  AgentStepRuntimeError,
  evaluateStepRunDecision,
} from "./steps/step-executor.js";
import { type BranchGroupResult, executeBranchStepGroup } from "./steps/step-executor-branch.js";
import { executeForeachStepGroup, type ForeachGroupResult } from "./steps/step-executor-foreach.js";
import { executeParallelStepGroup, type ParallelAgentDeps } from "./steps/step-executor-parallel.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export type RunExecutorDeps = {
  projectDir: string;
  bus: EventBus;
  /**
   * Per-project view over {@link bus}. The executor emits every workflow-
   * lifecycle event through this wrapper so subscribers can attribute the
   * emitting project without inferring scope from paths. When omitted, the
   * executor builds the wrapper from `deriveProjectId(projectDir)` so a
   * standalone run is still attributed to its own project.
   */
  pbus?: ProjectScopedEventBus;
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
  ) => Promise<{ runId: string; status: "queued" | "completed" | "failed"; childOutput?: unknown }>;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
};

export function executeWorkflowRun(
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
  inputDeps: RunExecutorDeps,
  abortController: AbortController = new AbortController(),
): { promise: Promise<WorkflowRunExecutionResult>; abortController: AbortController } {
  // Resolve `pbus` once: callers from the daemon path supply the
  // per-project wrapper directly; standalone callers (CLI exec, focused
  // tests) get a wrapper bound to their own `projectDir`. Either way the
  // run is attributed to the project producing it, never the registry's
  // default.
  const deps: RunExecutorDeps & { pbus: ProjectScopedEventBus } = {
    ...inputDeps,
    pbus:
      inputDeps.pbus ??
      new ProjectScopedEventBus(inputDeps.bus, deriveProjectId(inputDeps.projectDir)),
  };
  const run = deps.store.createRun(definition, trigger);
  const startedAt = Date.now();

  let runTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (definition.runTimeoutMs !== undefined) {
    runTimeoutHandle = setTimeout(() => {
      abortController.abort(
        new Error(`Workflow "${definition.name}" run timed out after ${definition.runTimeoutMs}ms`),
      );
    }, definition.runTimeoutMs);
  }

  deps.pbus.emit(
    "workflow.started",
    buildWorkflowStartedPayload(run.metadata, definition),
  );
  deps.log(`Starting workflow "${definition.name}" (${run.metadata.id})`);

  const promise = (async (): Promise<WorkflowRunExecutionResult> => {
    let agentBackoff: WorkflowRunExecutionResult["agentBackoff"];
    const retryOfId = typeof trigger.payload.retryOf === "string" ? trigger.payload.retryOf : undefined;
    const resumedFromRunId = typeof trigger.payload.resumedFromRunId === "string" ? trigger.payload.resumedFromRunId : undefined;
    const resumeFromStep = typeof trigger.payload.resumeFromStep === "string" ? trigger.payload.resumeFromStep : undefined;
    const stepDeps = { bus: deps.bus, pbus: deps.pbus, log: deps.log };

    try {
      const retryState = resumedFromRunId && resumeFromStep
        ? buildResumeInitialState(resumedFromRunId, resumeFromStep, definition.steps, (result) => run.recordStep(result), deps.store.runsDir)
        : buildRetryInitialState(retryOfId, definition.steps, (result) => run.recordStep(result), deps.store.runsDir);
      const { stepOutputsById, stepResultsById, stepOutputs, retryFromIndex } = retryState;
      let previousOutput = retryState.previousOutput;
      let hadWarnings = retryState.hadWarnings;
      const acc = { stepOutputsById, stepResultsById, stepOutputs, warnings: [] as WorkflowRunWarning[] };

      // Inject webhook trigger payload so steps can access it via stepOutputs.trigger
      if (trigger.event === "webhook") {
        const { _runId: _ignored, ...webhookPayload } = trigger.payload as { _runId?: string; body: unknown; headers: Record<string, string>; timestamp: string };
        stepOutputsById.trigger = webhookPayload;
      }

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
          resolveAgentDef: deps.resolveAgentDef,
          resolveSkillsPrompt: deps.resolveSkillsPrompt,
        };

        const runDecision = await evaluateStepRunDecision(step, context);
        if (!runDecision.run) {
          buildSkippedResult(
            step,
            stepStartedAt,
            acc,
            (r) => run.recordStep(r),
            deps.pbus,
            run.metadata,
            definition.defaultAutonomyMode,
            runDecision.skipReason,
          );
          continue;
        }

        deps.pbus.emit(
          "workflow.step.started",
          buildStepStartedPayload(run.metadata, step, definition.defaultAutonomyMode),
        );
        deps.log(`Starting step "${step.id}" (${step.type}) in workflow "${definition.name}"`);

        if (step.type === "parallel") {
          const parallelAgentDeps: ParallelAgentDeps = {
            definition,
            run,
            trigger,
            runAbortController: abortController,
            agentConfig,
            acc,
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
            await executeParallelStepGroup(step, context, stepStartedAt, parallelAgentDeps);
          if (parallelBackoff && !agentBackoff) agentBackoff = parallelBackoff;
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
          deps.pbus.emit(
            "workflow.step.completed",
            buildStepCompletedPayload(run.metadata, groupResult, definition.defaultAutonomyMode),
          );
          deps.log(
            `Completed step "${step.id}" (parallel) in workflow "${definition.name}" [${groupResult.durationMs}ms]`,
          );
          if (groupFailed) {
            if (step.continueOnFailure) { hadWarnings = true; continue; }
            if (thrownError) throw thrownError;
            const failedChildren = innerResults.filter((r) => r.status === "failed" && !r.continueOnFailure);
            throw new Error(
              `Parallel group "${step.id}" failed: ${failedChildren.map((r) => `${r.id}: ${r.error ?? "unknown"}`).join("; ")}`,
            );
          }
          if (hadNewWarnings) hadWarnings = true;
          continue;
        }

        if (step.type === "branch") {
          const stepAbortController = new AbortController();
          const forwardBranchAbort = () => stepAbortController.abort(abortController.signal.reason);
          abortController.signal.addEventListener("abort", forwardBranchAbort, { once: true });
          const branchTimeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
          let branchTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const branchTimeoutPromise = new Promise<never>((_, reject) => {
            branchTimeoutHandle = setTimeout(() => {
              const err = new Error(`Step "${step.id}" timed out after ${branchTimeoutMs}ms`);
              stepAbortController.abort(err);
              reject(err);
            }, branchTimeoutMs);
          });
          let branchGroupResult: BranchGroupResult | undefined;
          try {
            const branchDeps = {
              definition,
              run,
              trigger,
              runAbortController: stepAbortController,
              agentConfig,
              acc,
              bus: deps.bus,
              pbus: deps.pbus,
              log: deps.log,
            };
            const getContext = () => createStepContext(
              run.metadata, trigger, previousOutput, stepOutputsById, stepResultsById, stepOutputs, deps,
            );
            branchGroupResult = await Promise.race([
              executeBranchStepGroup(step as WorkflowBranchStep, context, stepStartedAt, branchDeps, getContext),
              branchTimeoutPromise,
            ]);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            const failed: WorkflowStepResult = {
              id: step.id,
              type: step.type,
              status: "failed",
              startedAt: new Date(stepStartedAt).toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - stepStartedAt,
              error: error.message,
              ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
            };
            run.recordStep(failed);
            stepOutputsById[step.id] = undefined;
            stepResultsById[step.id] = failed;
            deps.pbus.emit("workflow.step.completed", buildStepCompletedPayload(run.metadata, failed, definition.defaultAutonomyMode));
            deps.log(`Failed step "${step.id}" (branch) in workflow "${definition.name}": ${error.message}`);
            if (step.continueOnFailure) { hadWarnings = true; continue; }
            throw error;
          } finally {
            clearTimeout(branchTimeoutHandle);
            abortController.signal.removeEventListener("abort", forwardBranchAbort);
          }
          const {
            branchResult,
            hadNewWarnings,
            branchFailed,
            thrownError,
            agentBackoff: branchBackoff,
          } = branchGroupResult!;
          if (branchBackoff && !agentBackoff) agentBackoff = branchBackoff;
          run.recordStep(branchResult);
          stepOutputsById[step.id] = branchResult.output;
          stepResultsById[step.id] = branchResult;
          stepOutputs.push(branchResult.output);
          previousOutput = branchResult.output;
          deps.pbus.emit("workflow.step.completed", buildStepCompletedPayload(run.metadata, branchResult, definition.defaultAutonomyMode));
          deps.log(`Completed step "${step.id}" (branch) in workflow "${definition.name}" [${branchResult.durationMs}ms]`);
          if (branchFailed) {
            if (step.continueOnFailure) { hadWarnings = true; continue; }
            if (thrownError) throw thrownError;
            throw new Error(`Branch step "${step.id}" failed`);
          }
          if (hadNewWarnings) hadWarnings = true;
          continue;
        }

        if (step.type === "foreach") {
          const stepAbortController = new AbortController();
          const forwardForeachAbort = () => stepAbortController.abort(abortController.signal.reason);
          abortController.signal.addEventListener("abort", forwardForeachAbort, { once: true });
          const foreachTimeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
          let foreachTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const foreachTimeoutPromise = new Promise<never>((_, reject) => {
            foreachTimeoutHandle = setTimeout(() => {
              const err = new Error(`Step "${step.id}" timed out after ${foreachTimeoutMs}ms`);
              stepAbortController.abort(err);
              reject(err);
            }, foreachTimeoutMs);
          });
          let foreachGroupResult: ForeachGroupResult | undefined;
          try {
            let priorItemResults: import("./steps/step-executor-foreach.js").ForeachItemResult[] | undefined;
            if (step.retryFailedItems && step.continueOnFailure && retryState.priorRunSteps) {
              const priorForeachResult = retryState.priorRunSteps.find((s) => s.id === step.id);
              const priorOutput = priorForeachResult?.output as { items?: number; results?: import("./steps/step-executor-foreach.js").ForeachItemResult[] } | undefined;
              if (Array.isArray(priorOutput?.results)) {
                priorItemResults = priorOutput.results;
              }
            }
            const foreachDeps = {
              definition,
              run,
              trigger,
              runAbortController: stepAbortController,
              agentConfig,
              acc,
              bus: deps.bus,
              pbus: deps.pbus,
              log: deps.log,
              priorItemResults,
            };
            const getContext = () => createStepContext(
              run.metadata, trigger, previousOutput, stepOutputsById, stepResultsById, stepOutputs, deps,
            );
            const foreachContext = getContext();
            foreachGroupResult = await Promise.race([
              executeForeachStepGroup(step as WorkflowForeachStep, foreachContext, stepStartedAt, foreachDeps),
              foreachTimeoutPromise,
            ]);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            const failed: WorkflowStepResult = {
              id: step.id,
              type: step.type,
              status: "failed",
              startedAt: new Date(stepStartedAt).toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - stepStartedAt,
              error: error.message,
              ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
            };
            run.recordStep(failed);
            stepOutputsById[step.id] = undefined;
            stepResultsById[step.id] = failed;
            deps.pbus.emit("workflow.step.completed", buildStepCompletedPayload(run.metadata, failed, definition.defaultAutonomyMode));
            deps.log(`Failed step "${step.id}" (foreach) in workflow "${definition.name}": ${error.message}`);
            if (step.continueOnFailure) { hadWarnings = true; continue; }
            throw error;
          } finally {
            clearTimeout(foreachTimeoutHandle);
            abortController.signal.removeEventListener("abort", forwardForeachAbort);
          }
          const {
            groupResult,
            hadNewWarnings,
            groupFailed,
            thrownError,
            agentBackoff: foreachBackoff,
          } = foreachGroupResult!;
          if (foreachBackoff && !agentBackoff) agentBackoff = foreachBackoff;
          run.recordStep(groupResult);
          stepOutputsById[step.id] = groupResult.output;
          stepResultsById[step.id] = groupResult;
          stepOutputs.push(groupResult.output);
          previousOutput = groupResult.output;
          deps.pbus.emit("workflow.step.completed", buildStepCompletedPayload(run.metadata, groupResult, definition.defaultAutonomyMode));
          deps.log(`Completed step "${step.id}" (foreach) in workflow "${definition.name}" [${groupResult.durationMs}ms]`);
          if (groupFailed) {
            if (step.continueOnFailure) { hadWarnings = true; continue; }
            if (thrownError) throw thrownError;
            throw new Error(`Foreach step "${step.id}" failed`);
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
      }

      const outputWarnings: WorkflowRunWarning[] = [...acc.warnings];
      if (definition.outputSchema !== undefined) {
        const outputError = validatePayloadSchema(
          definition.outputSchema,
          previousOutput as Record<string, unknown>,
        );
        if (outputError !== null) {
          outputWarnings.push({ type: "output-schema-mismatch", message: outputError });
          deps.log(`Output schema mismatch in workflow "${definition.name}": ${outputError}`);
        }
      }
      if (outputWarnings.length > 0) hadWarnings = true;
      const finalStatus = hadWarnings ? "completed-with-warnings" : "success";
      const completed = run.finish({
        status: finalStatus,
        durationMs: Date.now() - startedAt,
        ...(outputWarnings.length > 0 ? { warnings: outputWarnings } : {}),
      });
      deps.pbus.emit(
        "workflow.completed",
        buildWorkflowCompletedPayload(completed, finalStatus, definition.tags, undefined, definition.defaultAutonomyMode),
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
      deps.pbus.emit(
        "workflow.completed",
        buildWorkflowCompletedPayload(completed, status, definition.tags, agentBackoff?.kind, definition.defaultAutonomyMode),
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
