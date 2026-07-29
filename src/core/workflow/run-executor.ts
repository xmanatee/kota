import { join } from "node:path";
import type { AgentCanUseTool } from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { EventJournal } from "#core/events/event-journal.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { createDelegateBudget } from "#core/tools/delegate-budget.js";
import {
  activeTimingMetadata,
  createActiveTimeout,
} from "./active-timeout.js";
import {
  buildStepStartedPayload,
  buildWorkflowCompletedPayload,
  buildWorkflowStartedPayload,
} from "./event-payloads.js";
import { validatePayloadSchema } from "./payload-validator.js";
import { executeGroupStep } from "./run-executor-groups.js";
import { replayRunRuntimeState, updateRunRuntimeStateFromStep } from "./run-executor-runtime-state.js";
import { buildSkippedResult, executeWorkflowStep } from "./run-executor-step.js";
import { buildResumeInitialState, buildRetryInitialState } from "./run-executor-utils.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunExecutionResult, WorkflowRunStatus, WorkflowRunToolRunner, WorkflowRuntimeResources, WorkflowRunWarning } from "./run-types.js";
import { type AgentRunLimiter, createAgentRunLimiter } from "./steps/agent-run-limiter.js";
import { createStepContext } from "./steps/step-context.js";
import { createWorkflowAgentHarnessRunner } from "./steps/workflow-agent-harness-runner.js";
import {
  type AgentStepConfig,
  AgentStepRuntimeError,
  evaluateStepRunDecision,
} from "./steps/step-executor.js";
import { resolveWorkflowRunTokenBudget } from "./steps/step-executor-agent-token-budget.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export type RunExecutorDeps = {
  projectDir: string;
  workspaceDir?: string;
  runtimeResources?: WorkflowRuntimeResources;
  bus: EventBus;
  /**
   * Per-project view over {@link bus}. The executor emits every workflow-
   * lifecycle event through this wrapper so subscribers can attribute the
   * emitting project without inferring scope from paths. When omitted, the
   * executor builds the wrapper from `deriveDirectoryScopeId(projectDir)` so a
   * standalone run is still attributed to its own project.
   */
  pbus?: ProjectScopedEventBus;
  store: WorkflowRunStore;
  deadLetterQueue?: DeadLetterQueueStore;
  eventJournal?: EventJournal;
	approvalQueue?: ApprovalQueue;
  idempotencyStore?: IdempotencyStore;
  model?: string;
  config?: KotaConfig;
  runId?: string;
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
  runTool?: WorkflowRunToolRunner;
  createAgentCanUseTool?: (stepId: string) => AgentCanUseTool;
  /**
   * Shared gate for active agent harness runs. Runtime callers pass the
   * daemon-wide limiter; focused executor tests may pass agentConcurrency to
   * create a local limiter for the run.
   */
  agentRunLimiter?: AgentRunLimiter;
  agentConcurrency?: number;
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
  const pbus = inputDeps.pbus
    ?? new ProjectScopedEventBus(
      inputDeps.bus,
      deriveDirectoryScopeId(inputDeps.projectDir),
    );
  const approvalQueue = inputDeps.approvalQueue
    ?? new ApprovalQueue(
      join(inputDeps.projectDir, ".kota", "approvals"),
      pbus,
      pbus.getScopeId(),
    );
  const deps: RunExecutorDeps & {
    pbus: ProjectScopedEventBus;
    workspaceDir: string;
    approvalQueue: ApprovalQueue;
  } = {
    ...inputDeps,
    workspaceDir: inputDeps.workspaceDir ?? inputDeps.projectDir,
    pbus,
    approvalQueue,
  };
  const run = deps.store.createRun(definition, trigger, deps.runId);
  const startedAt = Date.now();
  const agentRunLimiter =
    deps.agentRunLimiter ?? createAgentRunLimiter(deps.agentConcurrency);
  const nestedAgentHarnessRunner = createWorkflowAgentHarnessRunner(agentRunLimiter);
  const contextDeps = {
    ...deps,
    runAgentHarness: nestedAgentHarnessRunner,
  };
  const delegateBudget = createDelegateBudget();
  const runTokenBudget = resolveWorkflowRunTokenBudget(deps.config);

  const runTimeout =
    definition.runTimeoutMs === undefined
      ? undefined
      : createActiveTimeout(
          definition.runTimeoutMs,
          () =>
            new Error(
              `Workflow "${definition.name}" run timed out after ${definition.runTimeoutMs}ms of active runtime`,
            ),
          (error) => abortController.abort(error),
        );

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
      replayRunRuntimeState(
        deps,
        definition,
        retryState.retryFromIndex,
        retryState.stepResultsById,
      );
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
          { ...contextDeps, currentStepId: step.id },
        );
        const stepStartedAt = Date.now();

        const agentConfig: AgentStepConfig = {
          model: deps.model,
          config: deps.config,
          projectDir: deps.projectDir,
          workspaceDir: deps.workspaceDir,
          runtimeResources: deps.runtimeResources,
          log: deps.log,
          resolveAgentDef: deps.resolveAgentDef,
          resolveSkillsPrompt: deps.resolveSkillsPrompt,
          createCanUseTool: deps.createAgentCanUseTool,
          agentRunLimiter,
          delegateBudget,
          runTokenBudget,
			approvalQueue: deps.approvalQueue,
          idempotencyStore: deps.idempotencyStore,
          scopeId: deps.pbus.getScopeId(),
          projectId: deps.pbus.getProjectId(),
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

        if (step.type === "parallel" || step.type === "branch" || step.type === "foreach") {
          const group = await executeGroupStep(step, context, stepStartedAt, {
            definition,
            run,
            trigger,
            runAbortController: abortController,
            agentConfig,
            acc,
            bus: deps.bus,
            pbus: deps.pbus,
            log: deps.log,
            contextDeps,
            previousOutput,
            ...(retryState.priorRunSteps
              ? { priorRunSteps: retryState.priorRunSteps }
              : {}),
          });
          if (group.agentBackoff && !agentBackoff) {
            agentBackoff = group.agentBackoff;
          }
          previousOutput = group.previousOutput;
          if (group.hadWarnings) hadWarnings = true;
          continue;
        }

        const { completed, agentBackoff: stepBackoff, thrownError } = await executeWorkflowStep(
          definition, step, run, trigger, context, abortController, agentConfig, acc, stepDeps, stepStartedAt,
        );
        updateRunRuntimeStateFromStep(deps, step, completed);
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
      const timing = runTimeout?.snapshot();
      runTimeout?.dispose();
      const completed = run.finish({
        status: finalStatus,
        durationMs: Date.now() - startedAt,
        ...activeTimingMetadata(timing),
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
      const timing = runTimeout?.snapshot();
      runTimeout?.dispose();
      const completed = run.finish({
        status,
        durationMs: Date.now() - startedAt,
        ...activeTimingMetadata(timing),
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
      runTimeout?.dispose();
    }
  })();

  return { promise, abortController };
}
