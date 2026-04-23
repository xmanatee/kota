import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelAdapter, ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import { warnInvalidConcurrencyConfig, warnUnknownConfigKeys } from "#core/config/config-warnings.js";
import { type EventBus, initEventBus } from "#core/events/event-bus.js";
import { AgentSession } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import { initModuleLogStore } from "#core/modules/module-log.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import type { LogFormat } from "#core/util/log-format.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { getHistory } from "#modules/history/history.js";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import { DaemonControlServer, type InteractiveSession } from "./daemon-control.js";
import { buildDaemonHandle } from "./daemon-handle.js";
import { DaemonLogger } from "./daemon-logger.js";
import { assertDaemonState, type DaemonState } from "./daemon-state.js";
import { subscribeDaemon } from "./daemon-subscriptions.js";
import { NotificationGate } from "./notification-gate.js";
import { getScheduler, initScheduler } from "./scheduler.js";
import { sweepExpiredSessions } from "./session-sweep.js";
import { initTaskStore } from "./task-store.js";

export type { DaemonControlAddress } from "./daemon-control.js";
export type { DaemonState } from "./daemon-state.js";

export type DaemonConfig = {
  projectDir?: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  idleIntervalMs?: number;
  pollIntervalMs?: number;
  stateDir?: string;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
  channels?: readonly ChannelDef[];
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
};

export const RESTART_EXIT_CODE = 75;

const STATE_FILE = "daemon-state.json";
const CONTROL_FILE = "daemon-control.json";
const DEFAULT_POLL_INTERVAL = 30_000;
const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 60_000;

export class Daemon {
  private readonly bus: EventBus;
  private readonly logger: DaemonLogger;
  private readonly config: DaemonConfig;
  private readonly stateDir: string;
  private readonly workflows: WorkflowRuntime;
  private readonly projectDir: string;
  private readonly controlServer: DaemonControlServer;
  private readonly token: string;
  private readonly runStore: WorkflowRunStore;

  private state: DaemonState;
  private unsubscribe: (() => void) | null = null;
  private notificationGate: NotificationGate | null = null;
  private activeChannels: ChannelAdapter[] = [];
  private sessions = new Map<string, InteractiveSession>();
  private sessionSweepTimer: ReturnType<typeof setInterval> | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private moduleHealthChecks: Record<string, import("#core/modules/module-types.js").HealthCheckResult> = {};
  private restartRequested = false;
  private restartReason: string | null = null;
  private running = false;
  private stopping = false;
  private shutdownHandler: (() => void) | null = null;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.logger = new DaemonLogger(config.logFormat);
    this.projectDir = config.projectDir ?? process.cwd();
    this.stateDir = config.stateDir ?? join(this.projectDir, ".kota");

    this.bus = initEventBus();
    this.runStore = new WorkflowRunStore(this.projectDir);
    initTaskStore(this.projectDir);
    initScheduler(this.projectDir);
    initModuleLogStore(this.projectDir);

    this.workflows = new WorkflowRuntime({
      bus: this.bus,
      projectDir: this.projectDir,
      model: config.model ?? config.config?.model,
      config: config.config,
      idleIntervalMs: config.idleIntervalMs,
      agentConcurrency: config.config?.scheduler?.agentConcurrency,
      codeConcurrency: config.config?.scheduler?.codeConcurrency,
      onLog: (message) => this.log(message),
      workflows: config.workflows,
      resolveAgentDef: config.resolveAgentDef,
      resolveSkillsPrompt: config.resolveSkillsPrompt,
    });

    this.state = this.loadState() ?? {
      startedAt: new Date().toISOString(),
      completedRuns: 0,
      pid: process.pid,
    };
    this.state.pid = process.pid;
    this.state.startedAt = new Date().toISOString();
    this.token = randomBytes(32).toString("hex");

    const daemonModel = config.model ?? config.config?.model;
    const daemonConfig = config.config;
    const daemonVerbose = config.verbose;
    const chatBindings = new DaemonChatBindingStore(this.stateDir);
    const conversationResolver = {
      conversationExists: (conversationId: string): boolean =>
        getHistory().load(conversationId) !== null,
      createConversation: (_mode: AutonomyMode): string =>
        getHistory().create(daemonModel ?? "claude-sonnet-4-6", this.projectDir, "user"),
    };
    this.controlServer = new DaemonControlServer(
      buildDaemonHandle({
        getState: () => this.state,
        isRunning: () => this.isRunning(),
        workflows: this.workflows,
        bus: this.bus,
        sessions: this.sessions,
        runStore: this.runStore,
        projectDir: this.projectDir,
        config: { config: config.config, verbose: config.verbose },
        log: (message) => this.log(message),
        getModuleHealthChecks: () => this.moduleHealthChecks,
      }),
      this.token,
      {
        eventBufferSize: config.config?.daemon?.eventBufferSize,
        makeAgent: (transport: Transport, autonomyMode, resumeConversation) =>
          new AgentSession({
            autonomyMode,
            model: daemonModel,
            verbose: daemonVerbose,
            transport,
            config: daemonConfig,
            resumeConversation,
          }),
        defaultAutonomyMode: config.config?.serve?.defaultAutonomyMode,
        chatPool: { ttlMs: config.config?.daemon?.sessionIdleTtlMs },
        chatBindings,
        conversationResolver,
      },
    );
  }


  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.restartRequested = false;
    this.restartReason = null;

    // Register signal handlers before any awaits so callers can observe them immediately.
    const gracePeriodMs = this.config.shutdownGracePeriodMs ?? this.config.config?.daemon?.shutdownGracePeriodMs ?? DEFAULT_SHUTDOWN_GRACE_PERIOD_MS;
    this.shutdownHandler = (signal?: NodeJS.Signals) => {
      void this.stop(signal === "SIGINT" ? 1 : gracePeriodMs);
    };
    process.on("SIGINT", this.shutdownHandler);
    process.on("SIGTERM", this.shutdownHandler);

    try {
      await this.ensureSingleInstance();
      this.workflows.validateDefinitions();

      this.log("Daemon starting...");
      warnUnknownConfigKeys(this.projectDir, (msg) => this.log(msg), this.config.moduleConfigKeys);
      warnInvalidConcurrencyConfig(this.projectDir, (msg) => this.log(msg));

      const controlPort = await this.controlServer.start();
      writeJsonFileAtomic(join(this.stateDir, CONTROL_FILE), {
        port: controlPort,
        pid: process.pid,
        startedAt: this.state.startedAt,
        token: this.token,
      });
      this.log(`Control API on http://127.0.0.1:${controlPort}`);

      const idleTtlMs = this.config.sessionIdleTtlMs ?? 5 * 60_000;
      const sweepMs = this.config.sessionSweepIntervalMs ?? 60_000;
      this.sessionSweepTimer = setInterval(() => {
        const expired = sweepExpiredSessions(this.sessions, Date.now(), idleTtlMs);
        for (const id of expired) {
          this.bus.emit("session.unregistered", { id });
        }
      }, sweepMs);

      if (this.config.probeModuleHealthChecks) {
        const probe = this.config.probeModuleHealthChecks;
        const runProbe = () => {
          void probe()
            .then((r) => { this.moduleHealthChecks = r; })
            .catch((err: unknown) => {
              this.log(`Module health probe failed: ${err instanceof Error ? err.message : String(err)}`);
            });
        };
        runProbe();
        this.healthCheckTimer = setInterval(runProbe, 30_000);
      }

      const pollMs = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
      const runsDir = join(this.stateDir, "runs");

      this.unsubscribe = subscribeDaemon({
        bus: this.bus,
        projectDir: this.projectDir,
        pollIntervalMs: pollMs,
        approvalTtlMs: this.config.config?.approvalTtlMs,
        alertCooldownMs: this.config.config?.notifications?.alertCooldownMs,
        moduleCrashAlertOpts: this.config.config?.moduleMonitoring,
        getWorkflowNotify: (name) => this.workflows.getDefinitions().find((d) => d.name === name)?.notify,
        onDueItems: (items) => this.handleDueItems(items),
        onWorkflowCompleted: (payload) => {
          this.state.completedRuns += 1;
          this.state.lastCompletedWorkflow = payload.workflow;
          this.state.lastCompletedAt = new Date().toISOString();
          this.state.lastCompletedStatus = payload.status;
          this.saveState();
          this.maybeRestart();
        },
        onRestartRequested: (reason) => this.requestRestart(reason),
        onLog: (message) => this.log(message),
      });

      const quietHours = this.config.config?.notifications?.quietHours;
      if (quietHours) {
        this.notificationGate = new NotificationGate(this.bus, quietHours);
        this.log(`Notification gate active: quiet hours ${quietHours.start}–${quietHours.end}`);
      }

      this.workflows.start();

      const operator = process.env.KOTA_OPERATOR;
      const channelCtx = {
        projectDir: this.projectDir,
        log: (message: string) => this.log(message),
        getWorkflowStatus: () => ({
          runtimeState: this.workflows.getState(),
          dispatchPaused: this.workflows.isDispatchPaused(),
          runsDir,
        }),
        operator,
        identity: operator ? { operator } : undefined,
      };
      for (const def of this.config.channels ?? []) {
        const adapter = def.create(channelCtx);
        if (adapter) {
          this.activeChannels.push(adapter);
          await adapter.start();
          this.log(`Channel started: ${def.name}`);
        }
      }

      this.saveState();
      this.log(
        `Daemon ready (pid ${process.pid}): ${this.workflows.getDefinitionCount()} workflows, ` +
          `${getScheduler().count()} scheduled items, poll ${pollMs / 1000}s`,
      );

      await new Promise<void>((resolve) => {
        const keepAlive = setInterval(() => {
          if (!this.running) {
            clearInterval(keepAlive);
            resolve();
          } else {
            this.maybeRestart();
          }
        }, 1_000);
      });
    } catch (err) {
      await this.cleanupFailedStart();
      throw err;
    }
  }

  async stop(gracePeriodMs = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.log("Daemon shutting down...");

    if (this.sessionSweepTimer !== null) {
      clearInterval(this.sessionSweepTimer);
      this.sessionSweepTimer = null;
    }
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    for (const adapter of this.activeChannels) {
      await adapter.stop();
    }
    this.activeChannels = [];

    await this.workflows.stop(gracePeriodMs);
    await this.controlServer.stop();

    const controlPath = join(this.stateDir, CONTROL_FILE);
    if (existsSync(controlPath)) rmSync(controlPath);

    this.unsubscribe?.();
    this.unsubscribe = null;

    this.notificationGate?.dispose();
    this.notificationGate = null;

    if (this.shutdownHandler) {
      process.removeListener("SIGINT", this.shutdownHandler);
      process.removeListener("SIGTERM", this.shutdownHandler);
      this.shutdownHandler = null;
    }

    this.saveState();
    this.running = false;
    this.stopping = false;
    this.log("Daemon stopped.");
  }

  getState(): DaemonState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.running && !this.stopping;
  }

  hasActiveWorkflow(): boolean {
    return this.workflows.isBusy();
  }

  getDashboardSnapshot() {
    const wfState = this.workflows.getState();
    const dispatchWindow = this.workflows.getDispatchWindowStatus();
    return {
      pid: this.state.pid,
      startedAt: this.state.startedAt,
      running: this.running,
      stopping: this.stopping,
      completedRuns: this.state.completedRuns,
      totalCostUsd: wfState.totalCostUsd,
      lastCompletedWorkflow: this.state.lastCompletedWorkflow,
      lastCompletedAt: this.state.lastCompletedAt,
      lastCompletedStatus: this.state.lastCompletedStatus,
      activeRuns: wfState.activeRuns ?? [],
      pendingRuns: wfState.pendingRuns,
      dispatchPaused: this.workflows.isDispatchPaused(),
      dispatchWindowBlocked: dispatchWindow.blocked,
      dispatchWindowOpensAt: dispatchWindow.opensAt,
      agentBackoff: wfState.agentBackoff,
      definitionCount: this.workflows.getDefinitionCount(),
      sessionCount: this.sessions.size,
    };
  }

  private handleDueItems(items: import("./scheduler.js").ScheduledItem[]): void {
    if (!this.running || this.stopping) return;
    for (const item of items) {
      this.log(`Reminder: ${item.description}`);
    }
  }

  /**
   * Check for an existing daemon instance before starting. If a live daemon
   * owns the project, refuse to start. If the control file is stale (dead PID
   * or unreachable port), clean it up and proceed.
   */
  private async ensureSingleInstance(): Promise<void> {
    const controlPath = join(this.stateDir, CONTROL_FILE);
    const existing = readOptionalJsonFile<{ port?: number; pid?: number; token?: string }>(controlPath);
    if (!existing || typeof existing.pid !== "number") return;

    const pid = existing.pid;
    const port = existing.port;

    if (!isProcessAlive(pid)) {
      this.log(`Removing stale control file (pid ${pid} is not alive)`);
      rmSync(controlPath, { force: true });
      return;
    }

    // PID is alive — probe the HTTP control port to confirm it is a real daemon.
    if (typeof port === "number") {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2_000);
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        if (res.ok) {
          throw new Error(
            `Another daemon instance is already running (pid ${pid}, port ${port}). ` +
            `Stop it with 'kota daemon stop' before starting a new one.`,
          );
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Another daemon instance")) {
          throw err;
        }
        // HTTP probe failed — PID is alive but not serving on this port.
        // Likely a stale file from PID reuse or the supervisor wrapper.
        this.log(`Control file references pid ${pid} (alive) but port ${port} is unreachable — removing stale control file`);
        rmSync(controlPath, { force: true });
        return;
      }
    }

    // No port in control file — unusual; treat as stale.
    this.log(`Control file references pid ${pid} (alive) but has no port — removing stale control file`);
    rmSync(controlPath, { force: true });
  }

  private maybeRestart(): void {
    if (!this.restartRequested || this.stopping) return;
    if (this.workflows.isBusy()) return;

    const reason = this.restartReason ?? "workflow requested restart";
    this.log(`Restarting daemon: ${reason}`);
    this.saveState();
    void this.stop()
      .then(() => {
        process.exitCode = RESTART_EXIT_CODE;
      })
      .catch((error) => {
        this.log(`Restart shutdown failed: ${(error as Error).message}`);
      });
  }

  private requestRestart(reason: string): void {
    if (this.restartRequested) return;
    this.restartRequested = true;
    this.restartReason = reason;
    this.workflows.setDispatchPaused(true);
    this.log(`${reason} — restart requested`);
    this.maybeRestart();
  }

  private loadState(): DaemonState | null {
    const path = join(this.stateDir, STATE_FILE);
    const state = readOptionalJsonFile<unknown>(path);
    if (state === null) return null;
    assertDaemonState(path, state);
    return state;
  }

  private saveState(): void {
    const path = join(this.stateDir, STATE_FILE);
    writeJsonFileAtomic(path, this.state);
  }

  private async cleanupFailedStart(): Promise<void> {
    if (this.sessionSweepTimer !== null) {
      clearInterval(this.sessionSweepTimer);
      this.sessionSweepTimer = null;
    }
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    for (const adapter of this.activeChannels) {
      await adapter.stop();
    }
    this.activeChannels = [];
    await this.workflows.stop(1, 1_000);
    await this.controlServer.stop();

    const controlPath = join(this.stateDir, CONTROL_FILE);
    if (existsSync(controlPath)) rmSync(controlPath);

    this.unsubscribe?.();
    this.unsubscribe = null;

    this.notificationGate?.dispose();
    this.notificationGate = null;

    if (this.shutdownHandler) {
      process.removeListener("SIGINT", this.shutdownHandler);
      process.removeListener("SIGTERM", this.shutdownHandler);
      this.shutdownHandler = null;
    }

    this.running = false;
    this.stopping = false;
  }

  private log(message: string): void {
    this.logger.line(message);
  }
}
