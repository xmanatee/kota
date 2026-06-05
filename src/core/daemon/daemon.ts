import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelDef, ChannelStatus } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import { initEventBus } from "#core/events/event-bus.js";
import type { ControlRouteRegistration, RouteRegistration } from "#core/modules/module-types.js";
import type { ModuleSetupRequirementContribution } from "#core/modules/setup-requirements.js";
import type { LogFormat } from "#core/util/log-format.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
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
import { ProjectRuntimeRegistry } from "./project-runtime.js";
import {
  type ConfiguredProjectInput,
  resolveConfiguredProjects,
  ScopeRegistry,
} from "./scope-registry.js";

export type { DaemonControlAddress } from "./daemon-control.js";
export type { DaemonState } from "./daemon-state.js";

export type DaemonConfig = {
  /**
   * Single-project shorthand. When `projects` is set, that array is
   * authoritative and `projectDir` is ignored. When neither is set,
   * defaults to `process.cwd()`.
   */
  projectDir?: string;
  /**
   * Multi-project configuration. The first entry becomes the registry's
   * default project. Operators that supervise more than one project from a
   * single daemon set this; KOTA-on-itself can leave it unset and let the
   * `projectDir` shorthand drive a single-project registry.
   *
   * The per-project runtime bundle (workflow runtime, run store, task store,
   * scheduler, module-log store, notification gate, approval queue,
   * owner-question queue, push-token store) is wired in a follow-up slice;
   * today the daemon still constructs one global runtime against the
   * registry's default project.
   */
  projects?: readonly ConfiguredProjectInput[];
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  idleIntervalMs?: number;
  pollIntervalMs?: number;
  stateDir?: string;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
  channels?: readonly ChannelDef[];
  /**
   * Daemon-control routes contributed by loaded modules. Registered on the
   * daemon's control server alongside its built-in routes; collisions fail
   * at server construction.
   */
  controlRoutes?: readonly ControlRouteRegistration[];
  /**
   * Module HTTP routes (`KotaModule.routes`). Registered on the daemon's
   * control server as a fallthrough after built-in and control routes do
   * not match, so a running daemon serves the same `/api/*` surface those
   * modules publish to `kota serve`. Bearer-token auth still applies unless
   * a route declares `bypassAuth: true`.
   */
  routes?: readonly RouteRegistration[];
  /** Setup/auth requirements contributed by loaded modules. */
  setupRequirements?: readonly ModuleSetupRequirementContribution[];
  /** How long a session may be idle before it is swept. Default: 5 minutes. */
  sessionIdleTtlMs?: number;
  /** How often to run the session sweep. Default: 1 minute. */
  sessionSweepIntervalMs?: number;
  /**
   * How long (ms) to wait for active runs before aborting them on SIGTERM.
   * 0 = drain indefinitely. Default: 60000 (60 s), or `daemon.shutdownGracePeriodMs` from kota.config.
   */
  shutdownGracePeriodMs?: number;
  /**
   * Log format for daemon operational output.
   * "json" emits NDJSON; "text" (default) emits human-readable lines.
   * Also controlled by KOTA_DAEMON_LOG_FORMAT=json env var.
   */
  logFormat?: LogFormat;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  probeModuleHealthChecks?: () => Promise<Record<string, import("#core/modules/module-types.js").HealthCheckResult>>;
  moduleConfigKeys?: ReadonlySet<string>;
  /**
   * Called after a restart-requested daemon has completed clean shutdown.
   * The CLI child uses this to exit immediately with the supervised restart
   * code; tests can inject a recorder instead of terminating the process.
   */
  restartExit?: (code: number) => void;
};

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

    const projectRuntimes = ProjectRuntimeRegistry.create({
      registry: projectRegistry,
      bus,
      config: config.config,
      workflows: config.workflows,
      model: config.model ?? config.config?.model,
      idleIntervalMs: config.idleIntervalMs,
      resolveAgentDef: config.resolveAgentDef,
      resolveSkillsPrompt: config.resolveSkillsPrompt,
      onLog: log,
      quietHours: config.config?.notifications?.quietHours,
    });

    this.ctx = buildDaemonInit({
      config,
      projectDir,
      stateDir,
      bus,
      logger,
      log,
      state,
      token,
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
      dispatchPaused: this.ctx.workflows.isDispatchPaused(),
      dispatchWindowBlocked: dispatchWindow.blocked,
      dispatchWindowOpensAt: dispatchWindow.opensAt,
      agentBackoff: wfState.agentBackoff,
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
      void this.stop()
        .then(() => {
          const restartExit = this.ctx.config.restartExit ?? ((code: number) => {
            process.exitCode = code;
          });
          restartExit(RESTART_EXIT_CODE);
        })
        .catch((error) => {
          this.restartShutdownScheduled = false;
          this.ctx.log(`Restart shutdown failed: ${(error as Error).message}`);
        });
    });
  }
}
