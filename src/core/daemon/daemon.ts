import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ChannelStatus } from "#core/channels/channel.js";
import { initEventBus } from "#core/events/event-bus.js";
import { EventJournal, installEventJournal } from "#core/events/event-journal.js";
import type { DaemonConfig } from "./daemon-config.js";
import {
  recordEventEmitFailureDeadLetter,
  scopeLineageForId,
} from "./daemon-event-failures.js";
import { buildDaemonInit, type DaemonRuntimeContext } from "./daemon-init.js";
import { DaemonLogger } from "./daemon-logger.js";
import { runDaemonShutdown } from "./daemon-shutdown.js";
import { runDaemonStartup } from "./daemon-startup.js";
import type { DaemonState } from "./daemon-state.js";
import { loadDaemonStateFromDisk, saveDaemonStateToDisk } from "./daemon-state-persistence.js";
import {
  anyDaemonWorkflowRuntimeBusy,
  setDaemonWorkflowDispatchPaused,
} from "./daemon-workflows.js";
import { installEventIdempotency } from "./idempotency-events.js";
import { ProjectRuntimeRegistry } from "./project-runtime.js";
import {
  resolveConfiguredProjects,
  ScopeRegistry,
} from "./scope-registry.js";

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
    const logger = new DaemonLogger(config.logFormat);
    const log = (message: string) => logger.line(message);
    const configuredProjects = resolveConfiguredProjects({
      projects: config.projects,
      projectDir: config.projectDir,
      fallbackProjectDir: process.cwd(),
    });
    const stateDir =
      config.stateDir ?? join(configuredProjects[0]!.projectDir, ".kota");

    const projectRegistry = new ScopeRegistry({
      stateDir,
      projects: configuredProjects,
    });
    const defaultProject = projectRegistry.getDefault();
    const projectDir = defaultProject.projectDir;

    const loaded = loadDaemonStateFromDisk(stateDir);
    const state: DaemonState = loaded ?? {
      startedAt: new Date().toISOString(),
      completedRuns: 0,
      pid: process.pid,
    };
    state.pid = process.pid;
    state.startedAt = new Date().toISOString();
    const token = randomBytes(32).toString("hex");

    const bus = initEventBus();
    const eventJournal = new EventJournal(join(stateDir, "events"), {
      scopeLineage: (scopeId) => scopeLineageForId(scopeId, projectRegistry),
    });

    const projectRuntimes = ProjectRuntimeRegistry.create({
      registry: projectRegistry,
      bus,
      eventJournal,
      config: config.config,
      workflows: config.workflows,
      model: config.model ?? config.config?.model,
      idleIntervalMs: config.idleIntervalMs,
      resolveAgentDef: config.resolveAgentDef,
      resolveSkillsPrompt: config.resolveSkillsPrompt,
      onLog: log,
      quietHours: config.config?.notifications?.quietHours,
    });
    const uninstallEventIdempotency = installEventIdempotency(bus, {
      defaultScopeId: defaultProject.projectId,
      resolveStore: (scopeId) => projectRuntimes.get(scopeId).idempotencyStore,
      log,
    });
    const uninstallEventDeadLetters = bus.addEmitFailureHandler((failure) => {
      if (failure.stage === "fanout") return;
      recordEventEmitFailureDeadLetter({
        failure,
        runtimes: projectRuntimes,
        defaultProjectId: defaultProject.projectId,
        log,
      });
    });
    const uninstallEventJournalMiddleware = installEventJournal(bus, eventJournal);
    const uninstallEventJournal = () => {
      uninstallEventJournalMiddleware();
      uninstallEventDeadLetters();
      uninstallEventIdempotency();
    };

    this.ctx = buildDaemonInit({
      config,
      projectDir,
      stateDir,
      bus,
      logger,
      log,
      state,
      token,
      eventJournal,
      uninstallEventJournal,
      projectRegistry,
      projectRuntimes,
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
        onSignalStop: (gracePeriodMs) => {
          void this.stop(gracePeriodMs);
        },
      });
    } catch (err) {
      await runDaemonShutdown(this.ctx, {
        workflowsStopArgs: [1, 1_000],
        saveState: false,
        logShutdown: false,
      });
      throw err;
    }
    if (this.restartHandoff !== null) {
      const restartError = await this.restartHandoff;
      if (restartError !== null) throw restartError;
    }
  }

  async stop(gracePeriodMs = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS): Promise<void> {
    if (this.ctx.stopping) return;
    this.ctx.stopping = true;
    await runDaemonShutdown(this.ctx, {
      workflowsStopArgs: [gracePeriodMs],
      saveState: true,
      logShutdown: true,
    });
  }

  getState(): DaemonState {
    return { ...this.ctx.state };
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
    const wfState = this.ctx.workflows.getState();
    const dispatchWindow = this.ctx.workflows.getDispatchWindowStatus();
    const recovery = this.ctx.workflows.getRecoveryStatus();
    const dispatchPause = this.ctx.workflows.getDispatchPauseStatus(recovery);
    return {
      pid: this.ctx.state.pid,
      startedAt: this.ctx.state.startedAt,
      running: this.ctx.running,
      stopping: this.ctx.stopping,
      completedRuns: this.ctx.state.completedRuns,
      totalCostUsd: wfState.totalCostUsd,
      lastCompletedWorkflow: this.ctx.state.lastCompletedWorkflow,
      lastCompletedAt: this.ctx.state.lastCompletedAt,
      lastCompletedStatus: this.ctx.state.lastCompletedStatus,
      activeRuns: wfState.activeRuns ?? [],
      pendingRuns: wfState.pendingRuns,
      dispatchPaused: dispatchPause.paused,
      dispatchPause,
      dispatchWindowBlocked: dispatchWindow.blocked,
      dispatchWindowOpensAt: dispatchWindow.opensAt,
      agentBackoff: wfState.agentBackoff,
      ...(recovery.status !== "none" && { recovery }),
      definitionCount: this.ctx.workflows.getDefinitionCount(),
      sessionCount: this.ctx.sessions.size,
    };
  }

  private requestRestart(reason: string): void {
    if (this.ctx.restartRequested) return;
    this.ctx.restartRequested = true;
    this.ctx.restartReason = reason;
    setDaemonWorkflowDispatchPaused(this.ctx, true);
    this.ctx.log(`${reason} — restart requested`);
    this.maybeRestart();
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

  private async finishRestart(): Promise<void> {
    await this.stop();
    const restartExit = this.ctx.config.restartExit ?? ((code: number) => {
      process.exit(code);
    });
    restartExit(RESTART_EXIT_CODE);
  }
}
