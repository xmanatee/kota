/**
 * Daemon — long-running process hosting the event bus, scheduler, and idle tasks.
 *
 * Third piece of the self-hosting loop plan (plans/self-hosting-loop.md).
 * Provides an event-driven runtime where scheduled actions fire automatically,
 * idle tasks run when nothing else is active, and the process can self-restart
 * after code changes.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ActionExecutor, partitionDueItems } from "./action-executor.js";
import type { KotaConfig } from "./config.js";
import { EventBus, initEventBus } from "./event-bus.js";
import { AgentSession, type LoopOptions } from "./loop.js";
import { getScheduler, initScheduler } from "./scheduler.js";
import { initTaskStore } from "./task-store.js";
import { CliTransport, type Transport } from "./transport.js";

export type IdleTask = {
  name: string;
  prompt: string;
  /** Minimum time between runs in ms (default: no cooldown). */
  cooldownMs?: number;
};

export type DaemonConfig = {
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  idleTasks?: IdleTask[];
  /** Scheduler poll interval in ms (default: 30000). */
  pollIntervalMs?: number;
  /** Watch dist/ for changes and exit with restart code (default: true). */
  restartOnBuild?: boolean;
  /** Action executor timeout in ms (default: 300000 = 5 min). */
  actionTimeoutMs?: number;
  /** Directory for daemon state persistence (default: ~/.kota). */
  stateDir?: string;
};

export type DaemonState = {
  startedAt: string;
  idleCycles: number;
  lastIdleTask?: string;
  lastIdleTaskAt?: string;
  pid: number;
};

/** Exit code signaling the daemon should be restarted by a wrapper. */
export const RESTART_EXIT_CODE = 75;

const STATE_FILE = "daemon-state.json";
const IDLE_CHECK_INTERVAL = 5_000;
const DEFAULT_POLL_INTERVAL = 30_000;
const DEFAULT_ACTION_TIMEOUT = 300_000;

export class Daemon {
  private bus: EventBus;
  private executor: ActionExecutor;
  private transport: Transport;
  private config: DaemonConfig;
  private state: DaemonState;
  private stateDir: string;

  private stopSchedulerTimer: (() => void) | null = null;
  private stopBus: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private distWatchTimer: ReturnType<typeof setInterval> | null = null;
  private distMtime: number | null = null;
  private running = false;
  private stopping = false;
  private shutdownHandler: (() => void) | null = null;
  private activeIdleSession: AgentSession | null = null;
  private idleTaskIndex = 0;
  private lastIdleRunAt = new Map<string, number>();

  constructor(config: DaemonConfig) {
    this.config = config;
    this.transport = new CliTransport(config.verbose);
    this.stateDir = config.stateDir ?? join(homedir(), ".kota");

    this.bus = initEventBus();
    initTaskStore(process.cwd());
    initScheduler(process.cwd());

    this.executor = new ActionExecutor({
      sessionOptions: {
        model: config.model ?? config.config?.model,
        verbose: config.verbose,
        config: config.config,
      },
      timeoutMs: config.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT,
    });

    this.state = this.loadState() ?? {
      startedAt: new Date().toISOString(),
      idleCycles: 0,
      pid: process.pid,
    };
    this.state.pid = process.pid;
    this.state.startedAt = new Date().toISOString();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.log("Daemon starting...");
    this.saveState();

    const scheduler = getScheduler();

    // Connect scheduler to event bus for event-triggered items
    this.stopBus = scheduler.connectBus(this.bus, (items) => {
      this.handleDueItems(items);
    });

    // Start time-based scheduler polling
    const pollMs = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    this.stopSchedulerTimer = scheduler.startTimer(pollMs, (items) => {
      this.handleDueItems(items);
    });

    // Start idle task loop
    if (this.config.idleTasks && this.config.idleTasks.length > 0) {
      this.idleTimer = setInterval(() => this.checkIdleTasks(), IDLE_CHECK_INTERVAL);
      this.idleTimer.unref();
    }

    // Watch dist/ for changes (self-restart)
    if (this.config.restartOnBuild !== false) {
      this.distMtime = this.getDistMtime();
      this.distWatchTimer = setInterval(() => this.checkDistChanged(), 5_000);
      this.distWatchTimer.unref();
    }

    // Signal handlers (stored for cleanup)
    this.shutdownHandler = () => { this.stop(); };
    process.on("SIGINT", this.shutdownHandler);
    process.on("SIGTERM", this.shutdownHandler);

    this.log(`Daemon running (pid ${process.pid})`);
    this.log(`  Scheduler poll: ${pollMs}ms`);
    this.log(`  Idle tasks: ${this.config.idleTasks?.length ?? 0}`);
    this.log(`  Pending schedules: ${scheduler.count()}`);
    this.log(`  Dist watch: ${this.config.restartOnBuild !== false ? "on" : "off"}`);

    // Keep process alive
    await new Promise<void>((resolve) => {
      const keepAlive = setInterval(() => {
        if (!this.running) {
          clearInterval(keepAlive);
          resolve();
        }
      }, 1_000);
      keepAlive.unref();
    });
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.log("Daemon shutting down...");

    // Stop accepting new work
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.distWatchTimer) {
      clearInterval(this.distWatchTimer);
      this.distWatchTimer = null;
    }

    // Wait for active idle session to finish (with 30s timeout)
    if (this.activeIdleSession) {
      this.log("Waiting for active idle task to complete...");
      const deadline = Date.now() + 30_000;
      while (this.activeIdleSession && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (this.activeIdleSession) {
        this.log("Idle task timed out, closing forcefully");
        this.activeIdleSession.close(true);
        this.activeIdleSession = null;
      }
    }

    // Clean up scheduler connections
    if (this.stopSchedulerTimer) {
      this.stopSchedulerTimer();
      this.stopSchedulerTimer = null;
    }
    if (this.stopBus) {
      this.stopBus();
      this.stopBus = null;
    }

    // Remove signal handlers
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

  /** Get current daemon state (for status endpoints). */
  getState(): DaemonState {
    return { ...this.state };
  }

  /** Check if the daemon is currently running. */
  isRunning(): boolean {
    return this.running && !this.stopping;
  }

  /** Check if an idle task is currently active. */
  isIdleActive(): boolean {
    return this.activeIdleSession !== null;
  }

  private handleDueItems(items: import("./scheduler.js").ScheduledItem[]): void {
    const { actions, notifications } = partitionDueItems(items);

    for (const item of notifications) {
      this.log(`Reminder: ${item.description}`);
    }

    for (const item of actions) {
      if (!this.executor.canExecute()) {
        this.log(`Skipped action "${item.description}" — too many running`);
        continue;
      }
      this.log(`Running action: "${item.description}"...`);
      this.executor.execute(item).then((result) => {
        if (result.error) {
          this.log(`Action "${item.description}" failed: ${result.error}`);
        } else {
          this.log(`Action "${item.description}" completed (${Math.round(result.durationMs / 1000)}s)`);
        }
      }).catch(() => {});
    }
  }

  private checkIdleTasks(): void {
    if (this.stopping) return;
    if (this.activeIdleSession) return;
    if (this.executor.activeCount > 0) return;

    const tasks = this.config.idleTasks;
    if (!tasks || tasks.length === 0) return;

    // Round-robin through idle tasks
    const now = Date.now();
    for (let attempt = 0; attempt < tasks.length; attempt++) {
      const idx = (this.idleTaskIndex + attempt) % tasks.length;
      const task = tasks[idx];

      // Check cooldown
      const lastRun = this.lastIdleRunAt.get(task.name);
      if (lastRun && task.cooldownMs && now - lastRun < task.cooldownMs) {
        continue;
      }

      this.idleTaskIndex = (idx + 1) % tasks.length;
      this.runIdleTask(task);
      return;
    }
  }

  private runIdleTask(task: IdleTask): void {
    this.log(`Starting idle task: "${task.name}"`);
    this.lastIdleRunAt.set(task.name, Date.now());

    let session: AgentSession;
    try {
      session = new AgentSession({
        model: this.config.model ?? this.config.config?.model,
        verbose: this.config.verbose,
        transport: this.transport,
        config: this.config.config,
        label: `idle:${task.name}`,
        noHistory: true,
      });
    } catch (err) {
      this.log(`Idle task "${task.name}" failed to create session: ${(err as Error).message}`);
      return;
    }

    this.activeIdleSession = session;

    session.send(task.prompt).then(() => {
      this.log(`Idle task "${task.name}" completed`);
      this.state.idleCycles++;
      this.state.lastIdleTask = task.name;
      this.state.lastIdleTaskAt = new Date().toISOString();
      this.saveState();
    }).catch((err) => {
      this.log(`Idle task "${task.name}" failed: ${(err as Error).message}`);
    }).finally(() => {
      session.close();
      this.activeIdleSession = null;
    });
  }

  private checkDistChanged(): void {
    if (this.stopping) return;
    try {
      const current = this.getDistMtime();
      if (current === null || this.distMtime === null) return;

      if (current > this.distMtime) {
        this.log("dist/ changed — requesting restart");
        this.saveState();

        this.stop().then(() => {
          process.exitCode = RESTART_EXIT_CODE;
        }).catch((err) => {
          this.log(`Restart shutdown failed: ${(err as Error).message}`);
        });
      }
    } catch (err) {
      this.log(`Dist watch error: ${(err as Error).message}`);
    }
  }

  private getDistMtime(): number | null {
    try {
      const distDir = join(process.cwd(), "dist");
      if (!existsSync(distDir)) return null;

      const dirStat = statSync(distDir);
      const cliPath = join(distDir, "cli.js");
      if (existsSync(cliPath)) {
        const cliStat = statSync(cliPath);
        return Math.max(dirStat.mtimeMs, cliStat.mtimeMs);
      }
      return dirStat.mtimeMs;
    } catch {
      return null;
    }
  }

  private loadState(): DaemonState | null {
    const path = join(this.stateDir, STATE_FILE);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return null;
    }
  }

  private saveState(): void {
    const path = join(this.stateDir, STATE_FILE);
    try {
      if (!existsSync(this.stateDir)) {
        mkdirSync(this.stateDir, { recursive: true });
      }
      writeFileSync(path, JSON.stringify(this.state, null, 2), "utf-8");
    } catch {
      // State persistence is best-effort
    }
  }

  private log(message: string): void {
    this.transport.emit({ type: "status", message: `[kota-daemon] ${message}` });
  }
}
