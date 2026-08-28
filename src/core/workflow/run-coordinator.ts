import { isWorkflowConcurrency, MAX_WORKFLOW_CONCURRENCY } from "./concurrency.js";
import type { RunStateDatabase, StoredRun } from "./run-state-database.js";
import type {
  PendingRunPublication,
  RunPublication,
  RunSuspensionState,
  TerminalRunState,
} from "./run-state-types.js";
import type { WorkflowRunStatus } from "./runtime-state-types.js";

export type RunExecutionOutcome =
  | {
      kind: "terminal";
      state: TerminalRunState;
      error?: string;
      publication?: Omit<RunPublication, "createdAt" | "deliveredAt">;
      resultStatus?: WorkflowRunStatus;
    }
  | {
      kind: "suspended";
      state: RunSuspensionState;
      wait?: Record<string, unknown>;
      error?: string;
      /** Waiting runs may opt into a durable automatic retry. */
      resumeAt?: string;
    };

export type RunExecutor = (
  run: StoredRun,
  signal: AbortSignal,
) => Promise<RunExecutionOutcome>;

export type RunCoordinatorOptions = {
  store: RunStateDatabase;
  daemonEpoch: number;
  concurrency: number;
  execute: RunExecutor;
  now?: () => string;
  onError?: (error: unknown, run: StoredRun) => void;
  deliverPublication?: (publication: PendingRunPublication) => void | Promise<void>;
  onPublicationError?: (error: unknown, publication: PendingRunPublication) => void;
  publicationRetryMs?: number;
  prepareCancellation?: (
    run: StoredRun,
  ) => { ready: true } | { ready: false; blockers: string[] };
};

export type RunCancellationResult =
  | { cancelled: true }
  | { cancelled: false; reason: "not-found" }
  | { cancelled: false; reason: "sandbox-preserved"; blockers: string[] };

type ActiveRun = {
  run: StoredRun;
  controller: AbortController;
  cancelled: boolean;
  holdsCapacity: boolean;
};

type CapacityWaiter = {
  runId: string;
  signal: AbortSignal;
  resolve: () => void;
  reject: (reason: unknown) => void;
  onAbort: () => void;
};

type TerminalWaiter = {
  resolve: (run: StoredRun) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

type CoordinatorPhase = "active" | "disposing" | "disposed";

const TERMINAL_STATES = new Set<TerminalRunState>([
  "succeeded",
  "failed",
  "cancelled",
]);

/**
 * Owns daemon-wide run admission. Durable state remains authoritative; this
 * class keeps only the AbortControllers for attempts executing in this process.
 */
export class RunCoordinator {
  private readonly store: RunStateDatabase;
  private readonly daemonEpoch: number;
  private readonly concurrency: number;
  private readonly execute: RunExecutor;
  private readonly now: () => string;
  private readonly onError: (error: unknown, run: StoredRun) => void;
  private readonly deliverPublication?: RunCoordinatorOptions["deliverPublication"];
  private readonly onPublicationError: NonNullable<RunCoordinatorOptions["onPublicationError"]>;
  private readonly publicationRetryMs: number;
  private readonly prepareCancellation: NonNullable<RunCoordinatorOptions["prepareCancellation"]>;
  private readonly active = new Map<string, ActiveRun>();
  private readonly idleWaiters = new Set<() => void>();
  private readonly scopeIdleWaiters = new Map<string, Set<() => void>>();
  private readonly capacityWaiters: CapacityWaiter[] = [];
  private readonly terminalWaiters = new Map<string, Set<TerminalWaiter>>();
  private readonly dependencyRunIds = new Set<string>();
  private readonly pausedScopeIds = new Set<string>();
  private globalAdmissionPaused = false;
  private eligibilityTimer: ReturnType<typeof setTimeout> | null = null;
  private publicationDrain: Promise<void> | null = null;
  private publicationDrainRequested = false;
  private publicationRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private phase: CoordinatorPhase = "active";
  private disposal: Promise<void> | null = null;

  constructor(options: RunCoordinatorOptions) {
    if (!isWorkflowConcurrency(options.concurrency)) {
      throw new Error(`Run concurrency must be an integer from 1 to ${MAX_WORKFLOW_CONCURRENCY}`);
    }
    this.store = options.store;
    this.daemonEpoch = options.daemonEpoch;
    this.concurrency = options.concurrency;
    this.execute = options.execute;
    this.now = options.now ?? (() => new Date().toISOString());
    this.onError = options.onError ?? (() => undefined);
    this.deliverPublication = options.deliverPublication;
    this.onPublicationError = options.onPublicationError ?? (() => undefined);
    this.publicationRetryMs = options.publicationRetryMs ?? 1_000;
    this.prepareCancellation =
      options.prepareCancellation ??
      ((run) =>
        run.sandbox
          ? { ready: false, blockers: ["sandbox-cleanup-owner-unavailable"] }
          : { ready: true });
    if (
      !Number.isSafeInteger(this.publicationRetryMs) ||
      this.publicationRetryMs < 1 ||
      this.publicationRetryMs > 2_147_483_647
    ) {
      throw new Error("Publication retry delay must be a positive timer interval");
    }
  }

  isGlobalAdmissionPaused(): boolean {
    return this.globalAdmissionPaused;
  }

  get isDisposed(): boolean {
    return this.phase === "disposed";
  }

  isScopeAdmissionPaused(scopeId: string): boolean {
    return this.pausedScopeIds.has(scopeId);
  }

  get activeCount(): number {
    return this.active.size;
  }

  get occupiedCapacity(): number {
    return this.countOccupiedCapacity();
  }

  get capacity(): number {
    return this.concurrency;
  }

  get activeRunIds(): readonly string[] {
    return [...this.active.keys()].sort();
  }

  activeRunIdsForScope(scopeId: string): readonly string[] {
    return [...this.active.values()]
      .filter((active) => active.run.scopeId === scopeId)
      .map((active) => active.run.id)
      .sort();
  }

  isScopeBusy(scopeId: string): boolean {
    return this.activeRunIdsForScope(scopeId).length > 0;
  }

  pauseGlobalAdmission(): void {
    this.globalAdmissionPaused = true;
    this.clearEligibilityTimer();
  }

  resumeGlobalAdmission(): number {
    if (this.phase !== "active") return 0;
    this.globalAdmissionPaused = false;
    return this.refill();
  }

  pauseScopeAdmission(scopeId: string): void {
    this.pausedScopeIds.add(scopeId);
    this.clearEligibilityTimer();
    if (this.phase === "active") this.refill();
  }

  resumeScopeAdmission(scopeId: string): number {
    if (this.phase !== "active") return 0;
    this.pausedScopeIds.delete(scopeId);
    return this.refill();
  }

  /** Starts as many eligible durable queued runs as the global limit permits. */
  refill(): number {
    if (this.phase !== "active") return 0;
    this.clearEligibilityTimer();
    this.grantCapacityWaiters();
    const observedAt = this.now();
    let started = this.startCandidates(
      this.store.listDispatchableRuns({
        now: observedAt,
        limit: this.concurrency - this.countOccupiedCapacity(),
        excludedScopeIds: [],
        includedRunIds: [...this.dependencyRunIds],
      }),
      observedAt,
    );
    if (!this.globalAdmissionPaused) {
      started += this.startCandidates(
        this.store.listDispatchableRuns({
          now: observedAt,
          limit: this.concurrency - this.countOccupiedCapacity(),
          excludedScopeIds: [...this.pausedScopeIds],
        }),
        observedAt,
      );
    }
    this.scheduleNextEligibility(observedAt);
    return started;
  }

  /**
   * Cancels queued work without executing it, or durably cancels and aborts an
   * active attempt. Active capacity is released only after execute() settles.
   */
  cancel(runId: string): RunCancellationResult {
    if (this.phase === "disposed") return { cancelled: false, reason: "not-found" };
    const active = this.active.get(runId);
    if (active) {
      const run = this.store.getRun(runId);
      if (!run || (run.state !== "running" && run.state !== "integrating")) {
        return { cancelled: false, reason: "not-found" };
      }
      active.cancelled = true;
      active.controller.abort(new Error(`Run "${runId}" was cancelled`));
      return { cancelled: true };
    }

    const run = this.store.getRun(runId);
    if (
      !run ||
      (run.state !== "queued" && run.state !== "waiting" && run.state !== "needs_attention")
    ) {
      return { cancelled: false, reason: "not-found" };
    }
    const prepared = this.prepareCancellation(run);
    if (!prepared.ready) {
      this.store.requireRunAttention(
        run.id,
        "sandbox-cleanup-blocked",
        prepared.blockers,
      );
      return {
        cancelled: false,
        reason: "sandbox-preserved",
        blockers: prepared.blockers,
      };
    }
    if (!this.store.cancelQueuedRun(runId, this.now())) {
      return { cancelled: false, reason: "not-found" };
    }
    if (this.notifyTerminal(runId)) {
      queueMicrotask(() => this.refill());
    } else {
      this.refill();
    }
    return { cancelled: true };
  }

  cancelScope(scopeId: string): number {
    let cancelled = 0;
    for (const runId of this.activeRunIdsForScope(scopeId)) {
      if (this.cancel(runId).cancelled) cancelled += 1;
    }
    return cancelled;
  }

  /**
   * Waits for a child run without making a blocked parent consume execution
   * capacity. The parent reacquires a slot before its workflow continues.
   */
  async waitForChild(
    parentRunId: string,
    childRunId: string,
    signal: AbortSignal,
  ): Promise<StoredRun> {
    if (this.phase !== "active") {
      throw new Error("Run coordinator is shutting down");
    }
    signal.throwIfAborted();
    const current = this.store.getRun(childRunId);
    if (!current) throw new Error(`Unknown child run "${childRunId}"`);
    if (TERMINAL_STATES.has(current.state as TerminalRunState)) return current;

    const parent = this.active.get(parentRunId);
    if (!parent) throw new Error(`Parent run "${parentRunId}" is not active`);
    if (!parent.holdsCapacity) {
      throw new Error(`Parent run "${parentRunId}" is already waiting for capacity`);
    }
    const sharedResource = parent.run.resources.find((resource) =>
      current.resources.includes(resource) &&
      (parent.run.scopeId === current.scopeId || resource.startsWith("global:"))
    );
    if (sharedResource !== undefined) {
      throw new Error(
        `Parent run "${parentRunId}" cannot wait for child run "${childRunId}" because both require resource "${sharedResource}"`,
      );
    }

    parent.holdsCapacity = false;
    this.dependencyRunIds.add(childRunId);
    const abortChild = () => {
      this.cancel(childRunId);
    };
    signal.addEventListener("abort", abortChild, { once: true });
    try {
      const terminal = this.waitForTerminal(childRunId, signal);
      this.refill();
      const completed = await terminal;
      await this.reacquireCapacity(parentRunId, signal);
      return completed;
    } finally {
      signal.removeEventListener("abort", abortChild);
      this.dependencyRunIds.delete(childRunId);
    }
  }

  whenIdle(): Promise<void> {
    if (this.active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  whenScopeIdle(scopeId: string): Promise<void> {
    if (!this.isScopeBusy(scopeId)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = this.scopeIdleWaiters.get(scopeId) ?? new Set<() => void>();
      waiters.add(resolve);
      this.scopeIdleWaiters.set(scopeId, waiters);
    });
  }

  /** Delivers terminal events that were committed before a crash or emit failure. */
  drainPublications(): Promise<void> {
    if (this.phase !== "active") return this.publicationDrain ?? Promise.resolve();
    if (this.deliverPublication === undefined) return Promise.resolve();
    this.clearPublicationRetry();
    this.publicationDrainRequested = true;
    if (this.publicationDrain === null) {
      const operation = this.runPublicationDrain().finally(() => {
        if (this.publicationDrain === operation) this.publicationDrain = null;
      });
      this.publicationDrain = operation;
    }
    return this.publicationDrain;
  }

  /**
   * Fence this daemon generation before its trigger hosts begin shutting down.
   * Existing attempts may still finish durably, but no timer, waiter, retry, or
   * completion callback can admit more work.
   */
  beginDisposal(): void {
    if (this.phase !== "active") return;
    this.phase = "disposing";
    this.globalAdmissionPaused = true;
    this.clearEligibilityTimer();
    this.clearPublicationRetry();
    this.publicationDrainRequested = false;
  }

  /**
   * Cancel and drain the remaining process-owned attempts. Once this resolves,
   * the coordinator is permanently inert and its RunStateDatabase may close.
   */
  dispose(maxWaitMs = 15_000): Promise<void> {
    if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1) {
      return Promise.reject(new Error("Coordinator disposal wait must be a positive integer"));
    }
    if (this.disposal !== null) return this.disposal;
    this.beginDisposal();
    const operation = this.finishDisposal(maxWaitMs);
    this.disposal = operation.catch((error) => {
      if (this.disposal === operation || this.phase !== "disposed") this.disposal = null;
      throw error;
    });
    return this.disposal;
  }

  private launch(run: StoredRun): void {
    const active: ActiveRun = {
      run,
      controller: new AbortController(),
      cancelled: false,
      holdsCapacity: true,
    };
    this.active.set(run.id, active);

    void Promise.resolve()
      .then(() =>
        active.cancelled
          ? ({ kind: "terminal", state: "cancelled" } satisfies RunExecutionOutcome)
          : this.execute(run, active.controller.signal),
      )
      .catch((error): RunExecutionOutcome => ({
        kind: "terminal",
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      }))
      .then((outcome) => this.applyOutcome(run, outcome))
      .catch((error) => {
        this.pauseGlobalAdmission();
        this.onError(error, run);
      })
      .finally(() => {
        this.active.delete(run.id);
        this.resolveScopeIdleWaiters(run.scopeId);
        if (this.notifyTerminal(run.id)) {
          queueMicrotask(() => {
            this.grantCapacityWaiters();
            if (this.phase === "active") this.refill();
            this.resolveIdleWaiters();
          });
        } else {
          this.grantCapacityWaiters();
          if (this.phase === "active") this.refill();
          this.resolveIdleWaiters();
        }
      });
  }

  private async applyOutcome(run: StoredRun, outcome: RunExecutionOutcome): Promise<void> {
    const transitionedAt = this.now();
    const cancellationWins =
      this.active.get(run.id)?.cancelled === true &&
      !(outcome.kind === "suspended" && outcome.state === "needs_attention");
    if (cancellationWins) {
      this.store.finishRun(
        run.id,
        this.daemonEpoch,
        "cancelled",
        transitionedAt,
      );
      await this.drainPublications();
      return;
    }
    if (outcome.kind === "terminal") {
      this.store.finishRun(
        run.id,
        this.daemonEpoch,
        outcome.state,
        transitionedAt,
        outcome.error,
        outcome.publication,
        outcome.resultStatus,
      );
      await this.drainPublications();
      return;
    }
    if (outcome.state === "waiting" && outcome.resumeAt !== undefined) {
      this.store.deferRun({
        runId: run.id,
        epoch: this.daemonEpoch,
        deferredAt: transitionedAt,
        resumeAt: outcome.resumeAt,
      });
      return;
    }
    this.store.suspendRun({
      runId: run.id,
      epoch: this.daemonEpoch,
      state: outcome.state,
      suspendedAt: transitionedAt,
      ...(outcome.wait === undefined ? {} : { wait: outcome.wait }),
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    });
  }

  private async runPublicationDrain(): Promise<void> {
    do {
      this.publicationDrainRequested = false;
      await this.drainPublicationPass();
    } while (this.publicationDrainRequested);
  }

  private async drainPublicationPass(): Promise<void> {
    const blockedRunIds = new Set<string>();
    while (true) {
      const pending = this.store
        .listPendingPublicationHeads()
        .filter((publication) => !blockedRunIds.has(publication.runId));
      if (pending.length === 0) break;
      for (const publication of pending) {
        try {
          await this.deliverPublication!(publication);
          this.store.markPublicationDelivered(publication.id, this.now());
        } catch (error) {
          blockedRunIds.add(publication.runId);
          this.onPublicationError(error, publication);
        }
      }
    }
    if (blockedRunIds.size > 0) {
      this.schedulePublicationRetry();
    }
  }

  private schedulePublicationRetry(): void {
    if (this.phase !== "active") return;
    if (this.publicationRetryTimer !== null) return;
    this.publicationRetryTimer = setTimeout(() => {
      this.publicationRetryTimer = null;
      if (this.phase === "active") void this.drainPublications();
    }, this.publicationRetryMs);
    this.publicationRetryTimer.unref?.();
  }

  private clearPublicationRetry(): void {
    if (this.publicationRetryTimer === null) return;
    clearTimeout(this.publicationRetryTimer);
    this.publicationRetryTimer = null;
  }

  private resolveIdleWaiters(): void {
    if (this.active.size > 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  private resolveScopeIdleWaiters(scopeId: string): void {
    if (this.isScopeBusy(scopeId)) return;
    const waiters = this.scopeIdleWaiters.get(scopeId);
    if (!waiters) return;
    this.scopeIdleWaiters.delete(scopeId);
    for (const resolve of waiters) resolve();
  }

  private countOccupiedCapacity(): number {
    let occupied = 0;
    for (const run of this.active.values()) {
      if (run.holdsCapacity) occupied += 1;
    }
    return occupied;
  }

  private startCandidates(candidates: readonly StoredRun[], observedAt: string): number {
    let started = 0;
    for (const candidate of candidates) {
      if (this.countOccupiedCapacity() >= this.concurrency) break;
      if (this.active.has(candidate.id)) continue;

      try {
        const attempt = this.store.startRun(candidate.id, this.daemonEpoch, observedAt);
        if (attempt === null) continue;
      } catch (error) {
        // startRun's conditional update is the cross-coordinator claim boundary.
        // A candidate another caller already started is no longer ours to run.
        if (this.store.getRun(candidate.id)?.state !== "queued") continue;
        throw error;
      }

      const run = this.store.getRun(candidate.id);
      if (!run || run.state !== "running") {
        throw new Error(`Run "${candidate.id}" did not enter running state`);
      }
      this.launch(run);
      started += 1;
    }
    return started;
  }

  private reacquireCapacity(runId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const active = this.active.get(runId);
    if (!active) throw new Error(`Parent run "${runId}" is no longer active`);
    if (active.holdsCapacity) return Promise.resolve();
    if (this.countOccupiedCapacity() < this.concurrency) {
      active.holdsCapacity = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: CapacityWaiter = {
        runId,
        signal,
        resolve: () => {
          signal.removeEventListener("abort", waiter.onAbort);
          resolve();
        },
        reject,
        onAbort: () => {
          const index = this.capacityWaiters.indexOf(waiter);
          if (index >= 0) this.capacityWaiters.splice(index, 1);
          reject(signal.reason);
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.capacityWaiters.push(waiter);
    });
  }

  private grantCapacityWaiters(): void {
    while (
      this.capacityWaiters.length > 0 &&
      this.countOccupiedCapacity() < this.concurrency
    ) {
      const waiter = this.capacityWaiters.shift()!;
      const active = this.active.get(waiter.runId);
      if (!active || active.cancelled || waiter.signal.aborted) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.reject(waiter.signal.reason ?? new Error(`Run "${waiter.runId}" stopped`));
        continue;
      }
      active.holdsCapacity = true;
      waiter.resolve();
    }
  }

  private waitForTerminal(runId: string, signal: AbortSignal): Promise<StoredRun> {
    signal.throwIfAborted();
    const current = this.store.getRun(runId);
    if (!current) throw new Error(`Unknown child run "${runId}"`);
    if (TERMINAL_STATES.has(current.state as TerminalRunState)) {
      return Promise.resolve(current);
    }

    return new Promise<StoredRun>((resolve, reject) => {
      const waiter: TerminalWaiter = {
        resolve: (run) => {
          signal.removeEventListener("abort", waiter.onAbort);
          resolve(run);
        },
        reject,
        signal,
        onAbort: () => {
          const waiters = this.terminalWaiters.get(runId);
          waiters?.delete(waiter);
          if (waiters?.size === 0) this.terminalWaiters.delete(runId);
          reject(signal.reason);
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      const waiters = this.terminalWaiters.get(runId) ?? new Set<TerminalWaiter>();
      waiters.add(waiter);
      this.terminalWaiters.set(runId, waiters);
    });
  }

  private notifyTerminal(runId: string): boolean {
    const run = this.store.getRun(runId);
    if (!run || !TERMINAL_STATES.has(run.state as TerminalRunState)) return false;
    const waiters = this.terminalWaiters.get(runId);
    if (!waiters) return false;
    this.terminalWaiters.delete(runId);
    for (const waiter of waiters) waiter.resolve(run);
    return true;
  }

  private scheduleNextEligibility(observedAt: string): void {
    if (this.phase !== "active") return;
    if (this.countOccupiedCapacity() >= this.concurrency) return;
    const dependencyEligibility = this.store.nextQueuedEligibility({
      after: observedAt,
      excludedScopeIds: [],
      includedRunIds: [...this.dependencyRunIds],
    });
    const normalEligibility = this.globalAdmissionPaused
      ? null
      : this.store.nextQueuedEligibility({
          after: observedAt,
          excludedScopeIds: [...this.pausedScopeIds],
        });
    const eligibleAt = [dependencyEligibility, normalEligibility]
      .filter((value): value is string => value !== null)
      .sort()[0] ?? null;
    if (!eligibleAt) return;
    const delay = Math.max(0, Date.parse(eligibleAt) - Date.parse(observedAt));
    this.eligibilityTimer = setTimeout(() => {
      this.eligibilityTimer = null;
      if (this.phase === "active") this.refill();
    }, Math.min(delay, 2_147_483_647));
    this.eligibilityTimer.unref?.();
  }

  private clearEligibilityTimer(): void {
    if (this.eligibilityTimer === null) return;
    clearTimeout(this.eligibilityTimer);
    this.eligibilityTimer = null;
  }

  private async finishDisposal(maxWaitMs: number): Promise<void> {
    for (const active of this.active.values()) {
      active.cancelled = true;
      active.controller.abort(new Error(`Run "${active.run.id}" was cancelled during shutdown`));
    }
    const deadline = Date.now() + maxWaitMs;
    await this.waitForDisposalPhase(this.whenIdle(), deadline, "active attempts");
    if (this.publicationDrain !== null) {
      await this.waitForDisposalPhase(
        this.publicationDrain,
        deadline,
        "terminal publication delivery",
      );
    }
    this.rejectWaiters(new Error("Run coordinator was disposed"));
    this.phase = "disposed";
  }

  private async waitForDisposalPhase(
    operation: Promise<void>,
    deadline: number,
    description: string,
  ): Promise<void> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Run coordinator disposal timed out waiting for ${description}`);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Run coordinator disposal timed out waiting for ${description}`)),
        remainingMs,
      );
      timer.unref?.();
    });
    try {
      await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.capacityWaiters.splice(0)) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.reject(error);
    }
    for (const waiters of this.terminalWaiters.values()) {
      for (const waiter of waiters) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.reject(error);
      }
    }
    this.terminalWaiters.clear();
    this.dependencyRunIds.clear();
  }
}
