import { join } from "node:path";
import { resolveAgentHarness } from "#core/agent-harness/index.js";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { createDelegateBudget } from "#core/tools/delegate-budget.js";
import {
  activeTimingMetadata,
  createActiveTimeout,
} from "./active-timeout.js";
import { AgentBackoffAdmissionError } from "./agent-backoff.js";
import {
  buildStepStartedPayload,
  buildWorkflowStartedPayload,
} from "./event-payloads.js";
import { validatePayloadSchema } from "./payload-validator.js";
import { WorkflowContinuationSuspension } from "./repair-loop.js";
import type { RunExecutorDeps } from "./run-executor-deps.js";
import { executeGroupStep } from "./run-executor-groups.js";
import { buildSkippedResult, executeWorkflowStep } from "./run-executor-step.js";
import { buildResumeInitialState, buildRetryInitialState } from "./run-executor-utils.js";
import {
  parseWorkflowContinuationRecord,
  parseWorkflowRunMetadata,
} from "./run-metadata.js";
import type {
  WorkflowRunExecutionResult,
  WorkflowRunStatus,
  WorkflowRuntimeResources,
  WorkflowRunWarning,
  WorkflowStepResult,
} from "./run-types.js";
import { createStepContext } from "./steps/step-context.js";
import {
  type AgentStepConfig,
  AgentStepRuntimeError,
  evaluateStepRunDecision,
} from "./steps/step-executor.js";
import { resolveWorkflowRunTokenBudget } from "./steps/step-executor-agent-token-budget.js";
import { workflowAgentBackoffSignalFromError } from "./steps/step-executor-retry.js";
import { createWorkflowAgentHarnessRunner } from "./steps/workflow-agent-harness-runner.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export type { RunExecutorDeps } from "./run-executor-deps.js";

function readDurableContinuationResume(
  wait: Readonly<Record<string, unknown>> | undefined,
): Readonly<{
  record: ReturnType<typeof parseWorkflowContinuationRecord>;
  metadata: WorkflowRunExecutionResult["metadata"];
}> | null {
  if (wait?.kind !== "continuation") return null;
  return Object.freeze({
    record: parseWorkflowContinuationRecord(
      wait.record,
      "durable continuation wait.record",
    ),
    metadata: parseWorkflowRunMetadata(
      wait.lineage,
      "durable continuation wait.lineage",
    ),
  });
}

function collectAgentSessionIds(
  steps: readonly WorkflowStepResult[],
): Record<string, string> {
  const sessions: Record<string, string> = {};
  const visit = (result: WorkflowStepResult): void => {
    if (
      result.type === "agent" &&
      result.output !== null &&
      typeof result.output === "object" &&
      typeof (result.output as { sessionId?: unknown }).sessionId === "string"
    ) {
      sessions[result.id] = (result.output as { sessionId: string }).sessionId;
    }
    if (
      result.type !== "parallel" &&
      result.type !== "branch" &&
      result.type !== "foreach"
    ) return;
    if (result.output === null || typeof result.output !== "object") return;
    const children = (result.output as { steps?: unknown }).steps;
    if (!Array.isArray(children)) return;
    for (const child of children) {
      if (child !== null && typeof child === "object") {
        visit(child as WorkflowStepResult);
      }
    }
  };
  for (const step of steps) visit(step);
  return sessions;
}

export function executeWorkflowRun(
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
  inputDeps: RunExecutorDeps,
  abortController: AbortController = new AbortController(),
): { promise: Promise<WorkflowRunExecutionResult>; abortController: AbortController } {
  const runContext = inputDeps.runContext;
  const runtimeResources: WorkflowRuntimeResources = {
    profileId: `${runContext.run.id}:${runContext.run.attempt}`,
    env: { ...runContext.resources.env },
    agentRunDir: runContext.resources.agentDir,
    tempRoot: runContext.resources.tempDir,
    artifactRoot: runContext.resources.artifactDir,
    ports: {
      start: runContext.resources.ports.start,
      end: runContext.resources.ports.end,
    },
  };
  // Resolve `pbus` once: callers from the daemon path supply the
  // per-scope wrapper directly; standalone callers (CLI exec, focused
  // tests) get a wrapper bound to their own `workspaceRoot`. Either way the
  // run is attributed to the project producing it, never the registry's
  // default.
  const pbus = inputDeps.pbus
    ?? new ScopedEventBus(
      inputDeps.bus,
      deriveDirectoryScopeId(runContext.scope.root),
    );
  const approvalQueue = inputDeps.approvalQueue
    ?? new ApprovalQueue(
      join(runContext.scope.root, ".kota", "approvals"),
      pbus,
      {
        scopeId: pbus.getScopeId(),
        defaultTtlMs: inputDeps.config?.approvalTtlMs,
      },
    );
  const deps: RunExecutorDeps & {
    workspaceRoot: string;
    scopeRoot: string;
    pbus: ScopedEventBus;
    runtimeResources: WorkflowRuntimeResources;
    approvalQueue: ApprovalQueue;
  } = {
    ...inputDeps,
    workspaceRoot: runContext.sandbox.workspaceDir,
    scopeRoot: runContext.scope.root,
    runtimeResources,
    pbus,
    approvalQueue,
    resolveAgentHarness: inputDeps.resolveAgentHarness ?? resolveAgentHarness,
  };
  const durableResume = readDurableContinuationResume(
    runContext.run.resumeWait,
  );
  let artifactPreviousAttempt: WorkflowRunExecutionResult["metadata"] | null = null;
  if (runContext.run.attempt > 1) {
    try {
      artifactPreviousAttempt = deps.store.getRun(runContext.run.id, { authorityCritical: true });
    } catch (error) {
      if (durableResume === null) throw error;
      deps.log(
        `Run evidence for resumed workflow "${runContext.run.id}" is unavailable; rebuilding from durable continuation state: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const previousAttempt = durableResume?.metadata ?? artifactPreviousAttempt;
  const resumeSessionIds = collectAgentSessionIds(previousAttempt?.steps ?? []);
  const run = deps.store.createRun(
    definition,
    trigger,
    runContext.run.id,
    runContext.sandbox.repository === "none"
      ? null
      : runContext.sandbox.baseCommit,
    previousAttempt === null && durableResume === null
      ? undefined
      : {
          ...(previousAttempt === null
            ? {}
            : { priorMetadata: previousAttempt }),
          ...(durableResume === null
            ? {}
            : { durableContinuation: durableResume.record }),
        },
  );
  const startedAt = Date.now();
  const nestedAgentHarnessRunner = createWorkflowAgentHarnessRunner(
    runContext.processes.register,
    deps.agentBackoff,
    runContext.scope.id,
  );
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
    let deferredByAgentBackoff: WorkflowRunExecutionResult["deferredByAgentBackoff"];
    const retryOfId = typeof trigger.payload.retryOf === "string" ? trigger.payload.retryOf : undefined;
    const resumedFromRunId = durableResume?.metadata.id ??
      (typeof trigger.payload.resumedFromRunId === "string"
        ? trigger.payload.resumedFromRunId
        : undefined);
    const resumeFromStep = durableResume?.record.stepId ??
      (typeof trigger.payload.resumeFromStep === "string"
        ? trigger.payload.resumeFromStep
        : undefined);
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
        if (abortController.signal.aborted) {
          throw abortController.signal.reason instanceof Error
            ? abortController.signal.reason
            : new Error("Workflow run aborted");
        }
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

        const scopeId = deps.pbus.getScopeId();
        const scopePolicySnapshot = deps.scopePolicyAuthority?.getSnapshot(scopeId);
        const agentConfig: AgentStepConfig = {
          model: deps.model,
          config: deps.config,
          scopeRoot: deps.scopeRoot,
          workspaceRoot: deps.workspaceRoot,
          authorityConfigPath: deps.authorityConfigPath,
          runtimeResources: contextDeps.runtimeResources,
          repository: runContext.sandbox.repository,
          log: deps.log,
          resolveAgentDef: deps.resolveAgentDef,
          resolveSkillsPrompt: deps.resolveSkillsPrompt,
          resolveAgentHarness: deps.resolveAgentHarness,
          createCanUseTool: deps.createAgentCanUseTool,
          delegateBudget,
          runTokenBudget,
          approvalQueue: deps.approvalQueue,
          idempotencyStore: deps.idempotencyStore,
          onProcessSpawn: runContext.processes.register,
          scopeId,
          scopePolicyAuthority: deps.scopePolicyAuthority,
          resolveRuntimeScope: deps.resolveRuntimeScope,
          scopePolicySnapshot,
          scopePolicy: scopePolicySnapshot?.policy,
          ...(deps.agentBackoff === undefined
            ? {}
            : {
              agentBackoff: deps.agentBackoff,
              agentBackoffAbortController: abortController,
            }),
          ...(Object.keys(resumeSessionIds).length > 0
            ? { resumeSessionIds }
            : {}),
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
        if (stepBackoff && !agentBackoff) agentBackoff = stepBackoff;
        if (completed.status === "success") previousOutput = completed.output;
        else if (completed.continueOnFailure) { hadWarnings = true; }
        else if (thrownError) throw thrownError;
      }

      if (abortController.signal.aborted) {
        throw abortController.signal.reason instanceof Error
          ? abortController.signal.reason
          : new Error("Workflow run aborted");
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
      deps.log(`Completed workflow "${definition.name}" (${completed.id})`);
      return {
        metadata: completed,
        ...(agentBackoff ? { agentBackoff } : {}),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err instanceof AgentBackoffAdmissionError) {
        deferredByAgentBackoff = err.backoff;
        agentBackoff = agentBackoff ?? err.incidentSignal;
      }
      if (!agentBackoff && err instanceof AgentStepRuntimeError) {
        agentBackoff = workflowAgentBackoffSignalFromError(err);
      }
      const status: WorkflowRunStatus = err instanceof AgentBackoffAdmissionError
        ? err.incidentSignal === undefined ? "interrupted" : "failed"
        : abortController.signal.aborted || err.name === "AbortError"
          ? "interrupted"
          : "failed";
      const timing = runTimeout?.snapshot();
      runTimeout?.dispose();
      if (err instanceof WorkflowContinuationSuspension) {
        const existing = run.metadata.continuations ?? [];
        if (
          !existing.some(
            (record) =>
              record.packet.evidenceFingerprint ===
              err.continuation.packet.evidenceFingerprint,
          )
        ) {
          run.metadata.continuations = [...existing, err.continuation];
        }
        const status = err.continuation.decision.decision === "decompose"
          ? "failed"
          : "interrupted";
        const fallback: WorkflowRunExecutionResult["metadata"] = {
          ...run.metadata,
          status,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          ...activeTimingMetadata(timing),
        };
        let completed = fallback;
        try {
          completed = run.finish({
            status,
            durationMs: fallback.durationMs!,
            ...activeTimingMetadata(timing),
            error: err.message,
          });
        } catch (artifactError) {
          err.recordCheckpointFailure(
            "workflow artifact persistence failed",
            artifactError,
          );
          deps.log(
            `Continuation checkpoint artifacts for workflow "${definition.name}" (${run.metadata.id}) could not be persisted; runtime suspension will preserve the sandbox: ${
              artifactError instanceof Error
                ? artifactError.message
                : String(artifactError)
            }`,
          );
        }
        const transition = status === "failed" ? "Classified" : "Suspended";
        deps.log(
          `${transition} workflow "${definition.name}" (${completed.id}) for ${err.continuation.decision.decision}`,
        );
        return {
          metadata: completed,
          continuation: err.continuation,
          ...(err.checkpointFailure === undefined
            ? {}
            : { continuationCheckpointFailure: err.checkpointFailure }),
        };
      }
      const completed = run.finish({
        status,
        durationMs: Date.now() - startedAt,
        ...activeTimingMetadata(timing),
        error: err.message,
      });
      deps.log(
        `${status === "interrupted" ? "Interrupted" : "Failed"} workflow "${definition.name}" (${completed.id}): ${err.message}`,
      );
      return {
        metadata: completed,
        ...(agentBackoff ? { agentBackoff } : {}),
        ...(deferredByAgentBackoff ? { deferredByAgentBackoff } : {}),
      };
    } finally {
      runTimeout?.dispose();
    }
  })();

  return { promise, abortController };
}
