import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "#core/config/config.js";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { AgentBackoffManager } from "./agent-backoff.js";
import { isWithinDispatchWindow, msUntilDispatchWindowOpens } from "./dispatch-window.js";
import { enqueueMatchingWorkflows, workflowUsesAgent } from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import { formatRunId } from "./run-store-helpers.js";
import type { WorkflowRunExecutionResult, WorkflowRuntimeState } from "./run-types.js";
import type { WorkflowRuntimeConfig } from "./runtime-config.js";
import {
  emitIdleEvent,
  loadDefinitions,
  maybeStartNext,
  resolveDefinitions,
  runWorkflow,
  type WorkflowRuntimeDispatchState,
} from "./runtime-dispatch.js";
import {
  ABORT_SIGNAL_FILE,
  PAUSE_SIGNAL_FILE,
  RELOAD_SIGNAL_FILE,
} from "./runtime-signals.js";
import { ScheduleTriggerManager } from "./schedule-triggers.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowRunTrigger,
} from "./types.js";
import { WorkflowDefinitionError } from "./validation.js";
import { WatchTriggerManager } from "./watch-triggers.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

export type { WorkflowRuntimeConfig };
export { ABORT_SIGNAL_FILE, PAUSE_SIGNAL_FILE, RELOAD_SIGNAL_FILE };

export const WORKFLOW_STOP_ABORT_WAIT_MS = 15_000;

export class WorkflowRuntime {
  private readonly projectDir: string;
  private readonly store: WorkflowRunStore;
  private readonly idleIntervalMs: number;
  private readonly agentConcurrency: number;
  private readonly codeConcurrency: number;
  private readonly model?: string;
  private readonly config?: KotaConfig;
  private readonly resolveAgentDef?: (name: string) => import("#core/agents/agent-types.js").AgentDef | undefined;
  private readonly resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;

  private readonly onLog?: (message: string) => void;
  private workflowInputs?: readonly RegisteredWorkflowDefinitionInput[];
  private readonly backoff: AgentBackoffManager;
  private readonly scheduleTriggers: ScheduleTriggerManager;
  private readonly watchTriggers: WatchTriggerManager;

  private definitions: WorkflowDefinition[] = [];
  private readonly wfQueue: WorkflowQueueManager;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private stopBus: (() => void) | null = null;
  /**
   * Active runs keyed by workflow name.
   * Same-workflow serialisation is enforced by never dispatching a workflow
   * that already has an entry here.
   */
  private activeRuns: Map<
    string,
    { promise: Promise<WorkflowRunExecutionResult>; abortController: AbortController }
  > = new Map();
  private dispatchPaused = false;
  private stopping = false;
  /** Maps workflow name → its source `enabled` value before a runtime override was applied. */
  private readonly definitionSourceEnabled: Map<string, boolean> = new Map();

  constructor(private readonly runtimeConfig: WorkflowRuntimeConfig) {
    this.projectDir = runtimeConfig.projectDir ?? process.cwd();
    this.store = new WorkflowRunStore(this.projectDir);
    this.idleIntervalMs = runtimeConfig.idleIntervalMs ?? 30_000;
    this.agentConcurrency = runtimeConfig.agentConcurrency ?? 1;
    this.codeConcurrency = runtimeConfig.codeConcurrency ?? 4;
    this.model = runtimeConfig.model;
    this.config = runtimeConfig.config;
    this.resolveAgentDef = runtimeConfig.resolveAgentDef;
    this.resolveSkillsPrompt = runtimeConfig.resolveSkillsPrompt;

    this.onLog = runtimeConfig.onLog;
    this.workflowInputs = runtimeConfig.workflows;
    this.backoff = new AgentBackoffManager(
      this.store,
      () => this.wfQueue.getRuns(),
      (q) => { this.wfQueue.setRuns(q); },
      () => this.wfQueue.persist(),
      () => this.definitions,
      (def) => workflowUsesAgent(def),
      (msg) => this.log(msg),
    );
    this.wfQueue = new WorkflowQueueManager({
      store: this.store,
      getActiveBackoff: () => this.backoff.getActive(),
      shouldSuppressBackoff: (def) => this.backoff.shouldSuppress(def),
      workflowUsesAgent,
      isActiveRun: (name) => this.activeRuns.has(name),
      getDefinitions: () => this.definitions,
      log: (msg) => this.log(msg),
    });
    this.scheduleTriggers = new ScheduleTriggerManager(
      this.store,
      () => this.stopping,
      (def, trigger, run) => this.wfQueue.enqueue(def, trigger, run),
      () => this.maybeStartNext(),
      () => this.config?.scheduler?.dispatchWindow,
    );
    this.watchTriggers = new WatchTriggerManager(
      this.projectDir,
      () => this.stopping,
      (def, trigger, run) => this.wfQueue.enqueue(def, trigger, run),
      () => this.maybeStartNext(),
      (msg) => this.log(msg),
    );
  }

  start(): void {
    if (this.stopBus || this.idleTimer) return;
    this.stopping = false;
    this.dispatchPaused = false;

    try {
      this.store.pruneRuns();
    } catch (error) {
      this.log(`Workflow run pruning failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const interrupted = this.store.recoverInterruptedRuns();
    for (const run of interrupted) {
      this.log(
        `Recovered interrupted workflow run ${run.id} for "${run.workflow}"`,
      );
    }
    if (interrupted.length > 0) {
      this.log(`${interrupted.length} run${interrupted.length === 1 ? "" : "s"} marked interrupted from previous session.`);
      const reason = "Interrupted: daemon restarted while run was in progress.";
      for (const run of interrupted) {
        const text = `Workflow interrupted: *${run.workflow}*\nRun: \`${run.id}\`\nReason: ${reason}`;
        this.runtimeConfig.bus.emit("workflow.interrupted.alert", {
          workflow: run.workflow,
          runId: run.id,
          durationMs: run.durationMs ?? 0,
          reason,
          text,
        });
      }
    }

    this.definitions = this.loadDefinitions();
    this.wfQueue.restorePending();
    this.queueInterruptedRunRecovery(interrupted);
    this.queueRecovery();
    const activeAgentBackoff = this.backoff.getActive();
    if (activeAgentBackoff) {
      this.log(
        `Agent dispatch backoff active until ${new Date(activeAgentBackoff.until).toLocaleString()} (${activeAgentBackoff.kind})`,
      );
    }

    this.stopBus = this.runtimeConfig.bus.on("*", (envelope) => {
      this.handleEvent(envelope);
    });

    this.scheduleTriggers.setup(this.definitions);
    this.watchTriggers.setup(this.definitions, (handler) =>
      this.runtimeConfig.bus.on("file.changed", handler),
    );
    this.maybeStartNext();

    this.idleTimer = setInterval(() => {
      this.emitIdleEvent();
    }, this.idleIntervalMs);
    this.idleTimer.unref();

    this.emitIdleEvent();
  }

  async stop(
    gracePeriodMs = 60_000,
    abortWaitMs = WORKFLOW_STOP_ABORT_WAIT_MS,
  ): Promise<void> {
    this.stopping = true;

    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.stopBus) {
      this.stopBus();
      this.stopBus = null;
    }
    this.scheduleTriggers.clearAll();
    this.watchTriggers.clearAll();

    if (this.activeRuns.size === 0) return;

    const promises = [...this.activeRuns.values()].map((r) => r.promise);
    const waitForActiveRuns = Promise.all(promises).then(() => "completed" as const);

    if (gracePeriodMs === 0) {
      await waitForActiveRuns;
      return;
    }

    let abortWaitTimer: ReturnType<typeof setTimeout> | undefined;
    const abortWaitExpired = new Promise<"abort-timeout">((resolve) => {
      abortWaitTimer = setTimeout(() => resolve("abort-timeout"), gracePeriodMs + abortWaitMs);
      abortWaitTimer.unref();
    });

    const graceTimer = setTimeout(() => {
      for (const { abortController } of this.activeRuns.values()) {
        abortController.abort();
      }
    }, gracePeriodMs);
    graceTimer.unref();

    try {
      const result = await Promise.race([waitForActiveRuns, abortWaitExpired]);
      if (result === "abort-timeout") {
        this.log(
          `Workflow runtime stop gave up waiting for ${this.activeRuns.size} active run(s) after abort`,
        );
      }
    } finally {
      clearTimeout(graceTimer);
      if (abortWaitTimer) clearTimeout(abortWaitTimer);
    }
  }

  isBusy(): boolean {
    return this.activeRuns.size > 0;
  }

  isDispatchPaused(): boolean {
    return this.dispatchPaused || existsSync(join(this.projectDir, ".kota", PAUSE_SIGNAL_FILE));
  }

  setDispatchPaused(paused: boolean): void {
    this.dispatchPaused = paused;
    if (!paused) this.maybeStartNext();
  }

  getDispatchWindowStatus(): { blocked: boolean; opensAt?: string } {
    const window = this.config?.scheduler?.dispatchWindow;
    if (!window) return { blocked: false };
    if (isWithinDispatchWindow(window)) return { blocked: false };
    const msUntil = msUntilDispatchWindowOpens(window);
    const opensAt = new Date(Date.now() + msUntil).toISOString();
    return { blocked: true, opensAt };
  }

  abortActiveRuns(): { aborted: number } {
    const count = this.activeRuns.size;
    for (const { abortController } of this.activeRuns.values()) {
      abortController.abort();
    }
    return { aborted: count };
  }

  abortActiveRun(runId: string): { ok: boolean; notFound?: boolean; queued?: boolean } {
    const state = this.store.readState();
    const activeEntry = (state.activeRuns ?? []).find((r) => r.runId === runId);
    if (activeEntry) {
      const inMemory = this.activeRuns.get(activeEntry.workflow);
      if (inMemory) {
        inMemory.abortController.abort();
        return { ok: true };
      }
    }
    const isQueued = this.wfQueue.getRuns().some((r) => r.runId === runId);
    if (isQueued) return { ok: false, queued: true };
    return { ok: false, notFound: true };
  }

  setWorkflowInputs(inputs: readonly RegisteredWorkflowDefinitionInput[]): void {
    this.workflowInputs = inputs;
  }

  reloadWorkflowDefinitions(): { count: number } {
    const defs = this.loadDefinitions();
    this.scheduleTriggers.reconcile(defs);
    this.watchTriggers.reconcile(defs, (handler) =>
      this.runtimeConfig.bus.on("file.changed", handler),
    );
    this.definitionSourceEnabled.clear();
    this.definitions = defs;
    return { count: defs.length };
  }

  validateDefinitions(): { count: number } {
    const defs = resolveDefinitions(this as unknown as WorkflowRuntimeDispatchState);
    return { count: defs.length };
  }

  enqueuePendingRun(name: string, tags?: string[], extraPayload?: Record<string, unknown>): { ok: boolean; queued?: string; runId?: string; alreadyQueued?: boolean; error?: string } {
    const definition = this.definitions.find((d) => d.name === name);
    if (!definition) return { ok: false, error: `Unknown workflow "${name}"` };
    if (!definition.enabled) return { ok: false, error: `Workflow "${name}" is disabled` };
    const state = this.store.readState();
    if (state.pendingRuns.some((r) => r.workflowName === name)) return { ok: false, alreadyQueued: true };
    const now = Date.now();
    const runId = formatRunId(name);
    const trigger = {
      event: "manual",
      payload: {
        ...(extraPayload ?? {}),
        triggeredAt: new Date().toISOString(),
        _runId: runId,
        ...(tags && tags.length > 0 && { tags }),
      },
    };
    this.store.setPendingRuns([...state.pendingRuns, { runId, workflowName: name, trigger, enqueuedAtMs: now, notBeforeMs: now }]);
    this.maybeStartNext();
    return { ok: true, queued: name, runId };
  }

  enqueueWebhookRun(
    name: string,
    webhookPayload: { body: unknown; headers: Record<string, string>; timestamp: string },
  ): { ok: boolean; runId?: string; alreadyRunning?: boolean; error?: string } {
    const definition = this.definitions.find((d) => d.name === name);
    if (!definition) return { ok: false, error: `Unknown workflow "${name}"` };
    if (!definition.enabled) return { ok: false, error: `Workflow "${name}" is disabled` };
    if (!definition.triggers.some((t) => t.webhook === true)) {
      return { ok: false, error: `Workflow "${name}" has no webhook trigger` };
    }
    if (this.activeRuns.has(name)) return { ok: false, alreadyRunning: true };
    const runId = formatRunId(name);
    const now = Date.now();
    const trigger: WorkflowRunTrigger = {
      event: "webhook",
      payload: { ...webhookPayload, _runId: runId },
    };
    const state = this.store.readState();
    this.store.setPendingRuns([...state.pendingRuns, { runId, workflowName: name, trigger, enqueuedAtMs: now, notBeforeMs: now }]);
    this.maybeStartNext();
    return { ok: true, runId };
  }

  cancelQueuedRun(runId: string): { ok: boolean; notFound?: boolean; active?: boolean } {
    const { cancelled } = this.wfQueue.cancel(runId);
    if (cancelled) return { ok: true };
    const state = this.store.readState();
    const isActive = (state.activeRuns ?? []).some((r) => r.runId === runId);
    if (isActive) return { ok: false, active: true };
    return { ok: false, notFound: true };
  }

  getDefinitionCount(): number {
    return this.definitions.length;
  }

  getDefinitions(): WorkflowDefinition[] {
    return this.definitions;
  }

  /** Returns the source `enabled` value for a definition that has been runtime-overridden, or undefined if no override is active. */
  getDefinitionSourceEnabled(name: string): boolean | undefined {
    return this.definitionSourceEnabled.get(name);
  }

  disableWorkflow(name: string): { ok: boolean; notFound?: boolean } {
    const def = this.definitions.find((d) => d.name === name);
    if (!def) return { ok: false, notFound: true };
    if (!this.definitionSourceEnabled.has(name)) {
      this.definitionSourceEnabled.set(name, def.enabled);
    }
    def.enabled = false;
    this.wfQueue.cancelByWorkflow(name);
    return { ok: true };
  }

  enableWorkflow(name: string): { ok: boolean; notFound?: boolean } {
    const def = this.definitions.find((d) => d.name === name);
    if (!def) return { ok: false, notFound: true };
    if (!this.definitionSourceEnabled.has(name)) {
      this.definitionSourceEnabled.set(name, def.enabled);
    }
    def.enabled = true;
    this.maybeStartNext();
    return { ok: true };
  }

  getState(): WorkflowRuntimeState & { queueLength: number; agentConcurrency: number; codeConcurrency: number } {
    const state = this.store.readState();
    return {
      ...state,
      queueLength: this.wfQueue.length,
      agentConcurrency: this.agentConcurrency,
      codeConcurrency: this.codeConcurrency,
    };
  }

  private loadDefinitions(): WorkflowDefinition[] {
    return loadDefinitions(this as unknown as WorkflowRuntimeDispatchState);
  }

  private emitIdleEvent(): void {
    emitIdleEvent(this as unknown as WorkflowRuntimeDispatchState);
  }

  private handleEvent(envelope: BusEnvelope): void {
    if (this.stopping) return;
    enqueueMatchingWorkflows(envelope, this.definitions, (def, trigger, run) =>
      this.wfQueue.enqueue(def, trigger, run));
    maybeStartNext(this as unknown as WorkflowRuntimeDispatchState);
  }

  private maybeStartNext(): void {
    maybeStartNext(this as unknown as WorkflowRuntimeDispatchState);
  }

  private queueMatchingEventFirst(
    event: string,
    payload: Record<string, unknown>,
    definitionFilter?: (def: WorkflowDefinition) => boolean,
  ): number {
    const filteredDefs = definitionFilter
      ? this.definitions.filter(definitionFilter)
      : this.definitions;
    const queued: Array<{
      workflowName: string;
      trigger: WorkflowRunTrigger;
    }> = [];
    enqueueMatchingWorkflows(
      { type: event, payload },
      filteredDefs,
      (definition, _trigger, run) => {
        queued.push({ workflowName: definition.name, trigger: run });
      },
    );
    if (queued.length === 0) return 0;

    const now = Date.now();
    const queuedNames = new Set(queued.map((run) => run.workflowName));
    const remaining = this.wfQueue
      .getRuns()
      .filter((run) => !queuedNames.has(run.workflowName));
    this.wfQueue.setRuns([
      ...queued.map(({ workflowName, trigger }) => {
        const runId =
          typeof trigger.payload._runId === "string" && trigger.payload._runId.trim().length > 0
            ? trigger.payload._runId
            : formatRunId(workflowName);
        return {
          runId,
          workflowName,
          trigger: {
            ...trigger,
            payload: {
              ...trigger.payload,
              _runId: runId,
            },
          },
          enqueuedAtMs: 0,
          notBeforeMs: now,
        };
      }),
      ...remaining,
    ]);
    this.wfQueue.persist();
    return queued.length;
  }

  private queueInterruptedRunRecovery(
    interrupted: Array<{ id: string; workflow: string }>,
  ): void {
    if (interrupted.length === 0) return;
    const worktree = getRepoWorktreeStatus(this.projectDir);
    if (!worktree.available || !worktree.trackedDirty) return;

    const recoveryFilter = (def: WorkflowDefinition) => def.recoveryCapable;
    const queued = this.queueMatchingEventFirst("runtime.recovered", {
      recoveredRunIds: interrupted.map((run) => run.id),
      recoveredWorkflows: interrupted.map((run) => run.workflow),
      recoveredAt: new Date().toISOString(),
      worktreeSummary: worktree.summary,
    }, recoveryFilter);
    if (queued === 0) {
      this.log(
        `Recovered interrupted run(s) left a dirty worktree, but no recovery-capable workflow matched runtime.recovered: ${worktree.summary}`,
      );
      return;
    }
    this.log(
      `Queued ${queued} recovery workflow${queued === 1 ? "" : "s"} for interrupted run(s) with uncommitted changes: ${worktree.summary}`,
    );
  }

  private queueRecovery(): void {
    const recovery = this.store.getRecovery();
    if (!recovery) return;

    const worktree = getRepoWorktreeStatus(this.projectDir);
    if (!worktree.available) {
      this.log(
        `Recovery pending, but git status is unavailable: ${worktree.summary}`,
      );
      return;
    }
    if (!worktree.trackedDirty) {
      this.store.setRecovery(null);
      return;
    }

    const refreshedRecovery = {
      ...recovery,
      worktreeFingerprint: worktree.fingerprint,
      worktreeSummary: worktree.summary,
      updatedAt: new Date().toISOString(),
    };

    if (recovery.attempts >= 1) {
      this.store.setRecovery(refreshedRecovery);
      this.pauseDispatch(
        `Recovery exhausted after a failed recovery attempt from "${recovery.sourceWorkflow}" (${recovery.sourceRunId}): ${worktree.summary}`,
      );
      return;
    }

    this.store.setRecovery({
      ...refreshedRecovery,
      attempts: recovery.attempts + 1,
    });
    const recoveryFilter = (def: WorkflowDefinition) => def.recoveryCapable;
    const queued = this.queueMatchingEventFirst("runtime.recovered", {
      recoveredAt: new Date().toISOString(),
      sourceRunId: recovery.sourceRunId,
      sourceWorkflow: recovery.sourceWorkflow,
      worktreeSummary: worktree.summary,
    }, recoveryFilter);
    if (queued === 0) {
      this.pauseDispatch(
        `Recovery pending for dirty worktree, but no recovery-capable workflow matched runtime.recovered: ${worktree.summary}`,
      );
      return;
    }
    this.log(
      `Queued ${queued} recovery workflow${queued === 1 ? "" : "s"} for dirty worktree left by "${recovery.sourceWorkflow}" (${recovery.sourceRunId}): ${worktree.summary}`,
    );
  }

  private pauseDispatch(reason: string): void {
    this.dispatchPaused = true;
    this.wfQueue.setRuns([]);
    this.wfQueue.persist();
    writeFileSync(join(this.projectDir, ".kota", PAUSE_SIGNAL_FILE), "");
    this.log(reason);
  }

  private async runWorkflow(
    definition: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
  ): Promise<void> {
    return runWorkflow(this as unknown as WorkflowRuntimeDispatchState, definition, trigger);
  }

  private log(message: string): void {
    this.onLog?.(message);
  }
}

export { WorkflowDefinitionError };
