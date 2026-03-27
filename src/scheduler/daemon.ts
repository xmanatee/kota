import { join } from "node:path";
import type { KotaConfig } from "../config.js";
import { type EventBus, initEventBus } from "../event-bus.js";
import { initModuleLogStore } from "../extension-log.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "../json-file.js";
import { CliTransport, type Transport } from "../transport.js";
import { WorkflowRuntime } from "../workflow/runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "../workflow/types.js";
import { assertDaemonState, type DaemonState } from "./daemon-state.js";
import { subscribeDaemon } from "./daemon-subscriptions.js";
import { getScheduler, initScheduler } from "./scheduler.js";
import { initTaskStore } from "./task-store.js";

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
};

export const RESTART_EXIT_CODE = 75;

const STATE_FILE = "daemon-state.json";
const DEFAULT_POLL_INTERVAL = 30_000;
const SIGNAL_STOP_TIMEOUT_MS = 5_000;

export class Daemon {
  private readonly bus: EventBus;
  private readonly transport: Transport;
  private readonly config: DaemonConfig;
  private readonly stateDir: string;
  private readonly workflows: WorkflowRuntime;
  private readonly projectDir: string;

  private state: DaemonState;
  private unsubscribe: (() => void) | null = null;
  private restartRequested = false;
  private restartReason: string | null = null;
  private running = false;
  private stopping = false;
  private shutdownHandler: (() => void) | null = null;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.transport = new CliTransport(config.verbose);
    this.projectDir = config.projectDir ?? process.cwd();
    this.stateDir = config.stateDir ?? join(this.projectDir, ".kota");

    this.bus = initEventBus();
    initTaskStore(this.projectDir);
    initScheduler(this.projectDir);
    initModuleLogStore(this.projectDir);

    this.workflows = new WorkflowRuntime({
      bus: this.bus,
      projectDir: this.projectDir,
      model: config.model ?? config.config?.model,
      verbose: config.verbose,
      config: config.config,
      idleIntervalMs: config.idleIntervalMs,
      onLog: (message) => this.log(message),
      workflows: config.workflows,
    });

    this.state = this.loadState() ?? {
      startedAt: new Date().toISOString(),
      completedRuns: 0,
      pid: process.pid,
    };
    this.state.pid = process.pid;
    this.state.startedAt = new Date().toISOString();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.restartRequested = false;
    this.restartReason = null;

    this.log("Daemon starting...");
    this.saveState();

    const pollMs = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    const runsDir = join(this.stateDir, "runs");

    this.unsubscribe = subscribeDaemon({
      bus: this.bus,
      projectDir: this.projectDir,
      runsDir,
      pollIntervalMs: pollMs,
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
      getTelegramState: () => ({
        runtimeState: this.workflows.getState(),
        dispatchPaused: this.workflows.isDispatchPaused(),
        runsDir,
      }),
    });

    this.workflows.start();

    this.shutdownHandler = () => {
      void this.stop(SIGNAL_STOP_TIMEOUT_MS);
    };
    process.on("SIGINT", this.shutdownHandler);
    process.on("SIGTERM", this.shutdownHandler);

    this.log(`Daemon running (pid ${process.pid})`);
    this.log(`  Scheduler poll: ${pollMs}ms`);
    this.log(`  Workflows: ${this.workflows.getDefinitionCount()}`);
    this.log(`  Pending schedules: ${getScheduler().count()}`);

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
  }

  async stop(timeoutMs = 30_000): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.log("Daemon shutting down...");

    await this.workflows.stop(timeoutMs);

    this.unsubscribe?.();
    this.unsubscribe = null;

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

  private handleDueItems(items: import("./scheduler.js").ScheduledItem[]): void {
    if (!this.running || this.stopping) return;
    for (const item of items) {
      this.log(`Reminder: ${item.description}`);
    }
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

  private log(message: string): void {
    this.transport.emit({ type: "status", message: `[kota-daemon] ${message}` });
  }
}
