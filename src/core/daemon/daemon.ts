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

/**
 * The daemon orchestrator. Owns one `DaemonRuntimeContext` and dispatches
 * lifecycle phases (`buildDaemonInit`, `runDaemonStartup`, `runDaemonShutdown`)
 * against it. Per-phase logic lives in sibling files; this class is the
 * stable public surface and the restart bookkeeping.
 */
export class Daemon {
  private readonly ctx: DaemonRuntimeContext;
  private restartShutdownScheduled = false;
  private restartHandoff: Promise<Error | null> | null = null;

  constructor(config: DaemonConfig) {
    this.ctx = createDaemonRuntimeContext(config, {
      onScopeTrustRevoked: (scopeId) => this.beginScopeTrustRevocation(scopeId),
    });
  }

  async start(): Promise<void> {
    if (this.ctx.running) return;
    this.ctx.running = true;
    this.ctx.restartRequested = false;
    this.ctx.restartReason = null;
    this.restartShutdownScheduled = false;
    this.restartHandoff = null;

    try {
      await runDaemonStartup(this.ctx, {
        requestRestart: (reason) => this.requestRestart(reason),
        maybeRestart: () => this.maybeRestart(),
        onSignalStop: (signal, gracePeriodMs) => {
          void this.stop(
            gracePeriodMs,
            signal === "SIGINT" ? "sigint" : "sigterm",
          );
        },
      });
    } catch (err) {
      await runDaemonShutdown(this.ctx, {
        workflowsStopArgs: [1, 1_000],
        saveState: false,
        logShutdown: false,
        stopReason: "programmatic",
      });
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
    if (this.ctx.stopping) return;
    this.ctx.stopping = true;
    await runDaemonShutdown(this.ctx, {
      workflowsStopArgs: abortWaitMs === undefined
        ? [gracePeriodMs]
        : [gracePeriodMs, abortWaitMs],
      saveState: true,
      logShutdown: true,
      stopReason: reason,
    });
  }

  getState(): DaemonState {
    return { ...this.ctx.state };
  }

  registerDirectoryScope(
    input: DirectoryScopeRegistrationInput,
  ): Promise<ScopeRegistrationResult> {
    return this.ctx.scopeLifecycle.registerDirectoryScope(input);
  }

  updateScopeDisplayName(
    scopeId: ScopeId,
    displayName: string,
  ): Promise<ScopeMutationResult> {
    return this.ctx.scopeLifecycle.updateDisplayName(scopeId, displayName);
  }

  setDefaultScope(scopeId: ScopeId): Promise<ScopeMutationResult> {
    return this.ctx.scopeLifecycle.setDefaultScope(scopeId);
  }

  drainScope(scopeId: ScopeId): Promise<ScopeDrainResult> {
    return this.ctx.scopeLifecycle.drainScope(scopeId);
  }

  removeScope(scopeId: ScopeId): Promise<ScopeRemovalResult> {
    return this.ctx.scopeLifecycle.removeScope(scopeId);
  }

  getScopeRegistryProjection(): ScopeRegistryProjection {
    return this.ctx.projectRegistry.toScopeProjection();
  }

  inspectScopeAuthority(scopeId: ScopeId): ScopeAuthorityView | ScopeAuthorityFailure {
    return this.ctx.scopeAuthority.inspect(scopeId);
  }

  validateScopeAuthority(
    scopeId: ScopeId,
    mutation: ScopeAuthorityMutation,
  ): ScopeAuthorityValidationResult {
    return this.ctx.scopeAuthority.validate(scopeId, mutation);
  }

  applyScopeAuthority(
    scopeId: ScopeId,
    mutation: ScopeAuthorityMutation,
    operatorAction?: ScopeAuthorityOperatorAction,
  ): Promise<ScopeAuthorityMutationResult> {
    return this.ctx.scopeAuthority.apply(scopeId, mutation, operatorAction);
  }

  getHostedScopeCount(): number {
    return this.ctx.scopeRuntimeHost.hostedCount();
  }

  isRunning(): boolean {
    return this.ctx.running && !this.ctx.stopping;
  }

  hasActiveWorkflow(): boolean {
    return anyDaemonWorkflowRuntimeBusy(this.ctx);
  }

  /** Snapshot of every contributed channel's startup posture. */
  getChannelStatuses(): readonly ChannelStatus[] {
    return this.ctx.channelStatuses;
  }

  getDashboardSnapshot() {
    return buildDaemonDashboardSnapshot(this.ctx);
  }

  private requestRestart(reason: string): void {
    if (this.ctx.restartRequested) return;
    this.ctx.restartRequested = true;
    this.ctx.restartReason = reason;
    setDaemonWorkflowDispatchPaused(this.ctx, true);
    this.ctx.log(`${reason} — restart requested`);
    this.maybeRestart();
  }

  private beginScopeTrustRevocation(scopeId: string): void {
    if (!this.ctx.running || this.ctx.stopping || this.restartHandoff !== null) return;
    const reason = `Scope ${scopeId} was untrusted; reloading machine authority`;
    this.ctx.restartRequested = true;
    this.ctx.restartReason = reason;
    setDaemonWorkflowDispatchPaused(this.ctx, true);
    for (const runtime of this.ctx.projectRuntimes.list()) {
      runtime.workflowRuntime.abortActiveRuns();
    }
    this.ctx.controlServer.quarantine(reason);
    this.ctx.log(`${reason} — daemon quarantined and restart requested`);
    this.restartShutdownScheduled = true;
    this.restartHandoff = this.finishRestart(1, 1_000)
      .then(() => null)
      .catch((error) => {
        const restartError = error instanceof Error ? error : new Error(String(error));
        this.ctx.log(`Authority-revocation restart failed: ${restartError.message}`);
        return restartError;
      });
  }

  private maybeRestart(): void {
    if (!this.ctx.restartRequested || this.ctx.stopping) return;
    if (anyDaemonWorkflowRuntimeBusy(this.ctx)) return;
    if (this.restartShutdownScheduled) return;
    this.restartShutdownScheduled = true;

    const reason = this.ctx.restartReason ?? "workflow requested restart";
    setImmediate(() => {
      if (this.ctx.stopping || !this.ctx.running) {
        this.restartShutdownScheduled = false;
        return;
      }
      this.ctx.log(`Restarting daemon: ${reason}`);
      saveDaemonStateToDisk(this.ctx.stateDir, this.ctx.state);
      this.restartHandoff = this.finishRestart()
        .then(() => null)
        .catch((error) => {
          this.restartShutdownScheduled = false;
          const restartError = error instanceof Error ? error : new Error(String(error));
          this.ctx.log(`Restart shutdown failed: ${restartError.message}`);
          return restartError;
        });
    });
  }

  private async finishRestart(
    gracePeriodMs = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS,
    abortWaitMs?: number,
  ): Promise<void> {
    await this.stop(gracePeriodMs, "restart", abortWaitMs);
    const restartExit = this.ctx.config.restartExit ?? ((code: number) => {
      process.exit(code);
    });
    restartExit(RESTART_EXIT_CODE);
  }
}
