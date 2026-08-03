import type { AwaitSuspension } from "./awaits-store.js";
import type {
  WorkflowBatchDispatchInput,
  WorkflowBatchDispatchResult,
} from "./event-batches.js";
import type { WorkflowEnqueueOptions } from "./operator-trigger.js";
import {
  reconcileWorkflowRecovery,
  resolveWorkflowDispatchPause,
} from "./recovery-status.js";
import type {
  WorkflowDispatchPauseStatus,
  WorkflowRecoveryStatus,
} from "./recovery-status-types.js";
import type {
  WorkflowRuntimeState,
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
import type { WebhookRunPayload } from "./workflow-dispatcher-provider.js";

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

  constructor(runtimeConfig: WorkflowRuntimeConfig) {
    this.ctx = createWorkflowRuntimeContext(runtimeConfig);
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

  isBusy(): boolean {
    return isBusy(this.ctx);
  }

  isDispatchPaused(): boolean {
    return isDispatchPaused(this.ctx);
  }

  setDispatchPaused(paused: boolean, mode: WorkflowDispatchPauseMode = "runtime"): void {
    setDispatchPaused(this.ctx, paused, mode);
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

  getRecoveryStatus(): WorkflowRecoveryStatus {
    return reconcileWorkflowRecovery({
      projectDir: this.ctx.projectDir,
      workspaceDir: this.ctx.workspaceDir ?? this.ctx.runtimeConfig.workspaceDir,
      store: this.ctx.store,
    });
  }

  getDispatchPauseStatus(recovery = this.getRecoveryStatus()): WorkflowDispatchPauseStatus {
    return resolveWorkflowDispatchPause({
      projectDir: this.ctx.projectDir,
      runtimePaused: this.ctx.dispatchPaused,
      recovery,
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
    reason?: "not_found" | "not_redrivable" | "unknown_workflow";
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

  getState(): WorkflowRuntimeState & {
    queueLength: number;
    agentConcurrency: number;
    codeConcurrency: number;
  } {
    return getRuntimeState(this.ctx);
  }
}

export { WorkflowDefinitionError };
