import type { AwaitSuspension } from "./awaits-store.js";
import { resolveWorkflowDispatchPause } from "./dispatch-pause.js";
import type { WorkflowDispatchPauseStatus } from "./dispatch-pause-types.js";
import type {
  WorkflowBatchDispatchInput,
  WorkflowBatchDispatchResult,
} from "./event-batches.js";
import type { WorkflowEnqueueOptions } from "./operator-trigger.js";
import type { RunExecutionOutcome } from "./run-coordinator.js";
import {
  continueRunIntegration,
  validateRunIntegration,
  verifyRunPostReconcileInvariant,
} from "./run-integration-policy.js";
import { formatRunId } from "./run-io.js";
import { RunLifecycle } from "./run-lifecycle.js";
import type { StoredRun } from "./run-state-database.js";
import type { PendingRunPublication, RunPublication } from "./run-state-types.js";
import type {
  WorkflowRunStatus,
  WorkflowRuntimeSnapshot,
} from "./run-types.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import {
  createWorkflowRuntimeContext,
  type WorkflowRuntimeContext,
} from "./runtime-context.js";
import {
  disableWorkflow,
  enableWorkflow,
  getDefinitionCount,
  getDefinitionSourceEnabled,
  getDefinitions,
  getRuntimeState,
  reloadWorkflowDefinitions,
  setWorkflowInputs,
  validateDefinitions,
} from "./runtime-definitions.js";
import {
  createIntegratedWorkflowPublication,
  deliverIntegratedWorkflowPublication,
  executeAdmittedWorkflowRun,
} from "./runtime-dispatch.js";
import { triggerWorkflowFromStep } from "./runtime-dispatch-trigger.js";
import {
  getDispatchWindowStatus,
  isBusy,
  isDispatchPaused,
  listAwaitEventSuspensions,
  setDispatchPaused,
  startRuntime,
  stopRuntime,
  WORKFLOW_STOP_ABORT_WAIT_MS,
  type WorkflowDispatchPauseMode,
  type WorkflowRuntimeInitialDispatch,
} from "./runtime-lifecycle.js";
import {
  abortActiveRun,
  abortActiveRuns,
  cancelQueuedRun,
  enqueuePendingRun,
  enqueueWebhookRun,
  redriveDeadLetter,
} from "./runtime-runs-control.js";
import {
  ABORT_SIGNAL_FILE,
  PAUSE_SIGNAL_FILE,
  RELOAD_SIGNAL_FILE,
} from "./runtime-signals.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";
import { WorkflowDefinitionError } from "./validation.js";
import type { PendingWatchTriggerBuffer } from "./watch-triggers.js";
import type {
  ExecuteWorkflowRequest,
  ExecuteWorkflowResult,
  WebhookRunPayload,
} from "./workflow-dispatcher-provider.js";

export type { WorkflowRuntimeConfig };
export { ABORT_SIGNAL_FILE, PAUSE_SIGNAL_FILE, RELOAD_SIGNAL_FILE, WORKFLOW_STOP_ABORT_WAIT_MS };

/**
 * Thin orchestrator over the per-lifecycle-phase sibling helpers. The class
 * owns the {@link WorkflowRuntimeContext} container; each public method
 * forwards to one phase's helper, which mutates the shared context as the
 * runtime advances.
 */
export class WorkflowRuntime {
  private readonly ctx: WorkflowRuntimeContext;
  private readonly lifecycle: RunLifecycle;

  constructor(runtimeConfig: WorkflowRuntimeConfig) {
    this.ctx = createWorkflowRuntimeContext(runtimeConfig);
    this.lifecycle = new RunLifecycle({
      store: runtimeConfig.runState,
      daemonEpoch: runtimeConfig.daemonEpoch,
      executeWorkflow: (context, run) =>
        executeAdmittedWorkflowRun(this.ctx, run, context),
      validate: (context, input) => {
        const definition = this.ctx.definitions.find(
          (candidate) => candidate.name === context.workflow,
        );
        if (!definition?.integration) {
          throw new Error(`Writer workflow "${context.workflow}" has no integration policy`);
        }
        return validateRunIntegration(context, definition.integration, input);
      },
      verifyPostReconcile: (context, input) => {
        const definition = this.ctx.definitions.find(
          (candidate) => candidate.name === context.workflow,
        );
        if (!definition?.integration) {
          throw new Error(`Writer workflow "${context.workflow}" has no integration policy`);
        }
        return verifyRunPostReconcileInvariant(
          context,
          definition.integration,
          this.ctx.store.rootDir,
          input,
        );
      },
      continueIntegration: (context, issue) =>
        continueRunIntegration(
          context,
          issue,
          runtimeConfig.config,
          runtimeConfig.authorityConfigPath,
        ),
    });
  }

  start(initialDispatch: WorkflowRuntimeInitialDispatch = "active"): void {
    startRuntime(this.ctx, initialDispatch);
  }

  stop(
    gracePeriodMs = 60_000,
    abortWaitMs = WORKFLOW_STOP_ABORT_WAIT_MS,
  ): Promise<void> {
    return stopRuntime(this.ctx, gracePeriodMs, abortWaitMs);
  }

  executeAdmittedRun(
    run: StoredRun,
    signal: AbortSignal,
  ): Promise<RunExecutionOutcome> {
    return this.lifecycle.execute(run, signal).then((outcome) => {
      if (
        outcome.kind === "terminal" &&
        this.ctx.store.getRun(run.id) !== null
      ) {
        return this.finalizeTerminalOutcome(run, outcome);
      }
      return outcome;
    });
  }

  createPublication(
    run: StoredRun,
    status: WorkflowRunStatus,
  ): Omit<RunPublication, "createdAt" | "deliveredAt"> {
    return createIntegratedWorkflowPublication(this.ctx, run, status);
  }

  finalizeTerminalOutcome(
    run: StoredRun,
    outcome: Extract<RunExecutionOutcome, { kind: "terminal" }>,
  ): Extract<RunExecutionOutcome, { kind: "terminal" }> {
    const metadata = this.ctx.store.getRun(run.id);
    if (metadata === null || metadata.status === "running") {
      throw new Error(`Cannot finalize terminal workflow run "${run.id}"`);
    }
    const status: WorkflowRunStatus = outcome.state === "succeeded"
      ? metadata.status === "completed-with-warnings"
        ? "completed-with-warnings"
        : "success"
      : outcome.state === "cancelled"
        ? "interrupted"
        : "failed";
    this.ctx.store.reconcileTerminalStatus(run.id, status, outcome.error);
    return {
      ...outcome,
      publication: this.createPublication(run, status),
    };
  }

  deliverPublication(publication: PendingRunPublication): void {
    if (publication.projectId !== this.ctx.runtimeConfig.projectId) {
      throw new Error(
        `Publication "${publication.id}" belongs to project "${publication.projectId}"`,
      );
    }
    deliverIntegratedWorkflowPublication(this.ctx, publication);
  }

  isBusy(): boolean {
    return isBusy(this.ctx);
  }

  isDispatchPaused(): boolean {
    return isDispatchPaused(this.ctx);
  }

  setDispatchPaused(paused: boolean, mode: WorkflowDispatchPauseMode = "runtime"): void {
    setDispatchPaused(this.ctx, paused, mode);
  }

  clearAgentBackoff(reason: string): boolean {
    return this.ctx.backoff.clear(reason);
  }

  getDispatchWindowStatus(): { blocked: boolean; opensAt?: string } {
    return getDispatchWindowStatus(this.ctx);
  }

  listAwaitEventSuspensions(): AwaitSuspension[] {
    return listAwaitEventSuspensions(this.ctx);
  }

  listPendingWatchTriggerBuffers(): PendingWatchTriggerBuffer[] {
    return this.ctx.watchTriggers.listPendingBuffers();
  }

  getDispatchPauseStatus(): WorkflowDispatchPauseStatus {
    return resolveWorkflowDispatchPause({
      projectDir: this.ctx.projectDir,
      runtimePaused: isDispatchPaused(this.ctx),
    });
  }

  abortActiveRuns(): { aborted: number } {
    return abortActiveRuns(this.ctx);
  }

  abortActiveRun(runId: string): { ok: boolean; notFound?: boolean; queued?: boolean } {
    return abortActiveRun(this.ctx, runId);
  }

  setWorkflowInputs(inputs: readonly RegisteredWorkflowDefinitionInput[]): void {
    setWorkflowInputs(this.ctx, inputs);
  }

  reloadWorkflowDefinitions(): { count: number } {
    return reloadWorkflowDefinitions(this.ctx);
  }

  validateDefinitions(): { count: number } {
    return validateDefinitions(this.ctx);
  }

  enqueuePendingRun(
    name: string,
    options: WorkflowEnqueueOptions = {},
  ): {
    ok: boolean;
    queued?: string;
    runId?: string;
    alreadyQueued?: boolean;
    error?: string;
  } {
    return enqueuePendingRun(this.ctx, name, options);
  }

  async execute(request: ExecuteWorkflowRequest): Promise<ExecuteWorkflowResult> {
    if (request.projectId !== this.ctx.runtimeConfig.projectId) {
      return {
        ok: false,
        error: `Workflow runtime ${this.ctx.runtimeConfig.projectId} cannot execute for ${request.projectId}`,
      };
    }
    if (this.isDispatchPaused()) {
      return { ok: false, error: `Scope ${request.projectId} workflow dispatch is paused` };
    }
    if (request.parent !== undefined) {
      try {
        const child = await triggerWorkflowFromStep(
          this.ctx,
          request.parent.runId,
          request.workflow,
          request.payload,
          "completed",
          request.signal,
          request.parent.triggerId,
          request.event,
        );
        if (child.status !== "completed") {
          return { ok: false, error: `Workflow "${request.workflow}" child run failed` };
        }
        return { ok: true, runId: child.runId, output: child.childOutput };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const runId = formatRunId(request.workflow);
    const admitted = this.enqueuePendingRun(request.workflow, {
      event: request.event,
      payload: { ...request.payload },
      runId,
    });
    if (!admitted.ok || admitted.runId !== runId) {
      return {
        ok: false,
        error: admitted.error ?? `Workflow "${request.workflow}" was not admitted`,
      };
    }
    while (true) {
      const run = this.ctx.runtimeConfig.runState.getRun(runId);
      if (run === null) {
        return { ok: false, error: `Workflow run "${runId}" disappeared` };
      }
      if (run.state === "succeeded") {
        const metadata = this.ctx.store.getRun(runId);
        const output = metadata?.steps
          .slice()
          .reverse()
          .find((step) => step.output !== undefined)?.output;
        return { ok: true, runId, output };
      }
      if (
        run.state === "failed" ||
        run.state === "cancelled" ||
        run.state === "needs_attention"
      ) {
        return {
          ok: false,
          error: run.lastError ?? `Workflow run "${runId}" ended in ${run.state}`,
        };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  enqueueWebhookRun(
    name: string,
    webhookPayload: WebhookRunPayload,
  ): { ok: boolean; runId?: string; alreadyRunning?: boolean; error?: string } {
    return enqueueWebhookRun(this.ctx, name, webhookPayload);
  }

  enqueueBatchedEvent(input: WorkflowBatchDispatchInput): WorkflowBatchDispatchResult {
    return this.ctx.eventBatches.dispatchToWorkflowBatch(input);
  }

  cancelQueuedRun(runId: string): { ok: boolean; notFound?: boolean; active?: boolean } {
    return cancelQueuedRun(this.ctx, runId);
  }

  redriveDeadLetter(
    id: string,
    reason: string,
    target: "original" | "simulation" = "original",
  ): {
    ok: boolean;
    reason?: "not_found" | "not_redrivable" | "unknown_workflow" | "admission_rejected";
    runId?: string;
    workflowName?: string;
    event?: string;
  } {
    return redriveDeadLetter(this.ctx, id, reason, target);
  }

  getDefinitionCount(): number {
    return getDefinitionCount(this.ctx);
  }

  getDefinitions(): WorkflowDefinition[] {
    return getDefinitions(this.ctx);
  }

  /** Returns the source `enabled` value for a definition that has been runtime-overridden, or undefined if no override is active. */
  getDefinitionSourceEnabled(name: string): boolean | undefined {
    return getDefinitionSourceEnabled(this.ctx, name);
  }

  disableWorkflow(name: string): { ok: boolean; notFound?: boolean } {
    return disableWorkflow(this.ctx, name);
  }

  enableWorkflow(name: string): { ok: boolean; notFound?: boolean } {
    return enableWorkflow(this.ctx, name);
  }

  getState(): WorkflowRuntimeSnapshot & {
    queueLength: number;
    concurrency: number;
  } {
    return getRuntimeState(this.ctx);
  }
}

export { WorkflowDefinitionError };
