import type { ChannelStatus } from "#core/channels/channel.js";
import type { DaemonConfig } from "./daemon-config.js";
import { createDaemonRuntimeContext } from "./daemon-context-factory.js";
import { buildDaemonDashboardSnapshot } from "./daemon-dashboard-snapshot.js";
import type { DaemonRuntimeContext } from "./daemon-init.js";
import { runDaemonShutdown } from "./daemon-shutdown.js";
import { runDaemonStartup } from "./daemon-startup.js";
import type { DaemonState, DaemonStopReason } from "./daemon-state.js";
import { saveDaemonStateToDisk } from "./daemon-state-persistence.js";
import {
  anyDaemonWorkflowRuntimeBusy,
  setDaemonWorkflowDispatchPaused,
} from "./daemon-workflows.js";
import type { ScopeAuthorityOperatorAction } from "./scope-authority-operator-token.js";
import type {
  ScopeAuthorityFailure,
  ScopeAuthorityMutation,
  ScopeAuthorityMutationResult,
  ScopeAuthorityValidationResult,
  ScopeAuthorityView,
} from "./scope-authority-types.js";
import type {
  DirectoryScopeRegistrationInput,
  ScopeDrainResult,
  ScopeMutationResult,
  ScopeRegistrationResult,
  ScopeRemovalResult,
} from "./scope-lifecycle.js";
import type { ScopeId, ScopeRegistryProjection } from "./scope-registry.js";

export type { DaemonConfig } from "./daemon-config.js";
export type { DaemonControlAddress } from "./daemon-control.js";
export type { DaemonState } from "./daemon-state.js";

export const RESTART_EXIT_CODE = 75;
const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 60_000;

type DaemonStopRequest = Readonly<{
  gracePeriodMs: number;
  reason: DaemonStopReason;
  abortWaitMs?: number;
}>;

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

type DaemonGeneration = {
  context: DaemonRuntimeContext | null;
  operation: Promise<void> | null;
  readiness: Deferred<"ready" | "failed">;
  stopped: Deferred<void>;
  stopRequest: DaemonStopRequest | null;
  shutdown: Promise<void> | null;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * The daemon orchestrator. Owns one `DaemonRuntimeContext` and dispatches
 * lifecycle phases (`buildDaemonInit`, `runDaemonStartup`, `runDaemonShutdown`)
 * against it. Per-phase logic lives in sibling files; this class is the
 * stable public surface and the restart bookkeeping.
 */
export class Daemon {
  private generation: DaemonGeneration | null = null;
  private lastState: DaemonState | null = null;
  private restartShutdownScheduled = false;
  private restartIdleWaitScheduled = false;
  private restartHandoff: Promise<Error | null> | null = null;

  constructor(private readonly config: DaemonConfig) {}

  start(): Promise<void> {
    if (this.generation !== null) return this.generation.operation!;
    const generation: DaemonGeneration = {
      context: null,
      operation: null,
      readiness: deferred(),
      stopped: deferred(),
      stopRequest: null,
      shutdown: null,
    };
    this.generation = generation;
    const operation = this.runGeneration(generation).finally(() => {
      generation.stopped.resolve();
      if (generation.context !== null) {
        this.lastState = { ...generation.context.state };
      }
      if (this.generation === generation) this.generation = null;
    });
    generation.operation = operation;
    return operation;
  }

  async whenReady(): Promise<void> {
    const generation = this.generation;
    if (generation === null) throw new Error("Daemon has not been started");
    const readiness = await generation.readiness.promise;
    if (readiness === "failed") await generation.operation;
  }

  private async runGeneration(generation: DaemonGeneration): Promise<void> {
    let ctx: DaemonRuntimeContext | null = null;
    try {
      ctx = await createDaemonRuntimeContext(this.config, {
        onScopeTrustRevoked: (scopeId) => this.beginScopeTrustRevocation(scopeId),
      });
      generation.context = ctx;
      ctx.running = true;
      ctx.restartRequested = false;
      ctx.restartReason = null;
      this.restartShutdownScheduled = false;
      this.restartIdleWaitScheduled = false;
      this.restartHandoff = null;

      if (generation.stopRequest !== null) {
        generation.readiness.resolve("ready");
        await this.shutdownGeneration(generation, generation.stopRequest);
        return;
      }

      await runDaemonStartup(ctx, {
        requestRestart: (reason) => this.requestRestart(reason),
        maybeRestart: () => this.maybeRestart(),
        onSignalStop: (signal, gracePeriodMs) => {
          void this.stop(
            gracePeriodMs,
            signal === "SIGINT" ? "sigint" : "sigterm",
          );
        },
        onReady: () => generation.readiness.resolve("ready"),
        waitForStop: () => generation.stopped.promise,
      });
      if (generation.shutdown !== null) await generation.shutdown;
    } catch (err) {
      generation.readiness.resolve("failed");
      if (ctx !== null && generation.shutdown === null) {
        try {
          await this.shutdownGeneration(generation, {
            gracePeriodMs: 1,
            reason: "programmatic",
            abortWaitMs: 1_000,
          }, false);
        } catch (shutdownError) {
          throw new AggregateError(
            [err, shutdownError],
            "Daemon startup and cleanup both failed",
          );
        }
      } else if (generation.shutdown !== null) {
        await generation.shutdown;
      }
      throw err;
    }
    if (this.restartHandoff !== null) {
      const restartError = await this.restartHandoff;
      if (restartError !== null) throw restartError;
    }
  }

  async stop(
    gracePeriodMs = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS,
    reason: DaemonStopReason = "programmatic",
    abortWaitMs?: number,
  ): Promise<void> {
    const generation = this.generation;
    if (generation === null) return;
    generation.stopRequest ??= {
      gracePeriodMs,
      reason,
      ...(abortWaitMs === undefined ? {} : { abortWaitMs }),
    };
    const readiness = await generation.readiness.promise;
    if (readiness === "failed" || generation.context === null) return;
    await this.shutdownGeneration(generation, generation.stopRequest);
  }

  private shutdownGeneration(
    generation: DaemonGeneration,
    request: DaemonStopRequest,
    saveState = true,
  ): Promise<void> {
    if (generation.shutdown !== null) return generation.shutdown;
    const ctx = generation.context;
    if (ctx === null) return Promise.resolve();
    ctx.stopping = true;
    const shutdown = runDaemonShutdown(ctx, {
      workflowsStopArgs: request.abortWaitMs === undefined
        ? [request.gracePeriodMs]
        : [request.gracePeriodMs, request.abortWaitMs],
      saveState,
      logShutdown: saveState,
      stopReason: request.reason,
    }).finally(() => {
      generation.stopped.resolve();
    });
    generation.shutdown = shutdown;
    return shutdown;
  }

  getState(): DaemonState {
    if (this.generation?.context !== null && this.generation?.context !== undefined) {
      return { ...this.generation.context.state };
    }
    if (this.generation === null && this.lastState !== null) {
      return { ...this.lastState };
    }
    throw new Error("Daemon has not started");
  }

  registerDirectoryScope(
    input: DirectoryScopeRegistrationInput,
  ): Promise<ScopeRegistrationResult> {
    return this.context().scopeLifecycle.registerDirectoryScope(input);
  }

  updateScopeDisplayName(
    scopeId: ScopeId,
    displayName: string,
  ): Promise<ScopeMutationResult> {
    return this.context().scopeLifecycle.updateDisplayName(scopeId, displayName);
  }

  setDefaultScope(scopeId: ScopeId): Promise<ScopeMutationResult> {
    return this.context().scopeLifecycle.setDefaultScope(scopeId);
  }

  drainScope(scopeId: ScopeId): Promise<ScopeDrainResult> {
    return this.context().scopeLifecycle.drainScope(scopeId);
  }

  removeScope(scopeId: ScopeId): Promise<ScopeRemovalResult> {
    return this.context().scopeLifecycle.removeScope(scopeId);
  }

  getScopeRegistryProjection(): ScopeRegistryProjection {
    return this.context().scopeRegistry.toProjection();
  }

  inspectScopeAuthority(scopeId: ScopeId): ScopeAuthorityView | ScopeAuthorityFailure {
    return this.context().scopeAuthority.inspect(scopeId);
  }

  validateScopeAuthority(
    scopeId: ScopeId,
    mutation: ScopeAuthorityMutation,
  ): ScopeAuthorityValidationResult {
    return this.context().scopeAuthority.validate(scopeId, mutation);
  }

  applyScopeAuthority(
    scopeId: ScopeId,
    mutation: ScopeAuthorityMutation,
    operatorAction?: ScopeAuthorityOperatorAction,
  ): Promise<ScopeAuthorityMutationResult> {
    return this.context().scopeAuthority.apply(scopeId, mutation, operatorAction);
  }

  getHostedScopeCount(): number {
    return this.generation?.context?.scopeRuntimeHost.hostedCount() ?? 0;
  }

  isRunning(): boolean {
    const ctx = this.generation?.context;
    return ctx?.running === true && !ctx.stopping;
  }

  hasActiveWorkflow(): boolean {
    const ctx = this.generation?.context;
    return ctx !== null && ctx !== undefined && anyDaemonWorkflowRuntimeBusy(ctx);
  }

  /** Snapshot of every contributed channel's startup posture. */
  getChannelStatuses(): readonly ChannelStatus[] {
    return this.generation?.context?.channelStatuses ?? [];
  }

  getDashboardSnapshot() {
    return buildDaemonDashboardSnapshot(this.context());
  }

  private requestRestart(reason: string): void {
    const ctx = this.context();
    if (ctx.restartRequested) return;
    ctx.restartRequested = true;
    ctx.restartReason = reason;
    setDaemonWorkflowDispatchPaused(ctx, true);
    ctx.log(`${reason} — restart requested`);
    this.maybeRestart();
  }

  private beginScopeTrustRevocation(scopeId: string): void {
    const ctx = this.context();
    if (!ctx.running || ctx.stopping || this.restartHandoff !== null) return;
    const reason = `Scope ${scopeId} was untrusted; reloading machine authority`;
    ctx.restartRequested = true;
    ctx.restartReason = reason;
    setDaemonWorkflowDispatchPaused(ctx, true);
    for (const runtime of ctx.scopeRuntimes.list()) {
      runtime.workflowRuntime.abortActiveRuns();
    }
    ctx.controlServer.quarantine(reason);
    ctx.log(`${reason} — daemon quarantined and restart requested`);
    this.restartShutdownScheduled = true;
    this.restartHandoff = this.finishRestart(1, 1_000)
      .then(() => null)
      .catch((error) => {
        const restartError = error instanceof Error ? error : new Error(String(error));
        ctx.log(`Authority-revocation restart failed: ${restartError.message}`);
        return restartError;
      });
  }

  private maybeRestart(): void {
    const ctx = this.context();
    if (!ctx.restartRequested || ctx.stopping) return;
    if (anyDaemonWorkflowRuntimeBusy(ctx)) {
      if (this.restartIdleWaitScheduled) return;
      this.restartIdleWaitScheduled = true;
      void ctx.runCoordinator.whenIdle().then(() => {
        this.restartIdleWaitScheduled = false;
        if (this.generation?.context === ctx) this.maybeRestart();
      });
      return;
    }
    if (this.restartShutdownScheduled) return;
    this.restartShutdownScheduled = true;

    const reason = ctx.restartReason ?? "workflow requested restart";
    setImmediate(() => {
      if (ctx.stopping || !ctx.running) {
        this.restartShutdownScheduled = false;
        return;
      }
      ctx.log(`Restarting daemon: ${reason}`);
      saveDaemonStateToDisk(ctx.stateDir, ctx.state);
      this.restartHandoff = this.finishRestart()
        .then(() => null)
        .catch((error) => {
          this.restartShutdownScheduled = false;
          const restartError = error instanceof Error ? error : new Error(String(error));
          ctx.log(`Restart shutdown failed: ${restartError.message}`);
          return restartError;
        });
    });
  }

  private async finishRestart(
    gracePeriodMs = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS,
    abortWaitMs?: number,
  ): Promise<void> {
    const restartExit = this.context().config.restartExit ?? ((code: number) => {
      process.exit(code);
    });
    await this.stop(gracePeriodMs, "restart", abortWaitMs);
    restartExit(RESTART_EXIT_CODE);
  }

  private context(): DaemonRuntimeContext {
    const ctx = this.generation?.context;
    if (ctx === null || ctx === undefined) {
      throw new Error("Daemon has not started");
    }
    return ctx;
  }
}
