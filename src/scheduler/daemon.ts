import { join } from "node:path";
import type { KotaConfig } from "../config.js";
import { type EventBus, initEventBus } from "../event-bus.js";
import { initModuleLogStore } from "../extension-log.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "../json-file.js";
import { CliTransport, type Transport } from "../transport.js";
import { subscribeApprovalNotification } from "../workflow/approval-notification.js";
import { subscribeAttentionDigest } from "../workflow/attention-digest.js";
import { subscribeWorkflowFailureAlert } from "../workflow/failure-alert.js";
import { WorkflowRuntime } from "../workflow/runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "../workflow/types.js";
import { assertDaemonState, type DaemonState } from "./daemon-state.js";
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
  private stopSchedulerTimer: (() => void) | null = null;
  private stopBus: (() => void) | null = null;
  private stopWorkflowListener: (() => void) | null = null;
  private stopRestartListener: (() => void) | null = null;
  private stopFailureAlert: (() => void) | null = null;
  private stopApprovalNotification: (() => void) | null = null;
  private stopAttentionDigest: (() => void) | null = null;
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

    const scheduler = getScheduler();
    this.stopBus = scheduler.connectBus(this.bus, (items) => {
      this.handleDueItems(items);
    });

    const pollMs = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    this.stopSchedulerTimer = scheduler.startTimer(pollMs, (items) => {
      this.handleDueItems(items);
    });

    this.stopWorkflowListener = this.bus.on("workflow.completed", (payload) => {
      this.state.completedRuns += 1;
      this.state.lastCompletedWorkflow = payload.workflow;
      this.state.lastCompletedAt = new Date().toISOString();
      this.state.lastCompletedStatus = payload.status;
      this.saveState();
      this.maybeRestart();
    });

    this.stopRestartListener = this.bus.on(
      "runtime.restart_requested",
      (payload) => {
        this.requestRestart(payload.reason ?? "workflow requested restart");
      },
    );

    this.stopFailureAlert = subscribeWorkflowFailureAlert(
      this.bus,
      this.projectDir,
      (message) => this.log(message),
    );

    this.stopApprovalNotification = subscribeApprovalNotification(
      this.bus,
      (message) => this.log(message),
    );

    const runsDir = join(this.stateDir, "runs");
    this.stopAttentionDigest = subscribeAttentionDigest(
      this.bus,
      this.projectDir,
      runsDir,
      (message) => this.log(message),
    );

    this.workflows.start();

    this.shutdownHandler = () => {
      void this.stop(SIGNAL_STOP_TIMEOUT_MS);
    };
    process.on("SIGINT", this.shutdownHandler);
    process.on("SIGTERM", this.shutdownHandler);

    this.log(`Daemon running (pid ${process.pid})`);
    this.log(`  Scheduler poll: ${pollMs}ms`);
    this.log(`  Workflows: ${this.workflows.getDefinitionCount()}`);
    this.log(`  Pending schedules: ${scheduler.count()}`);

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

    if (this.stopSchedulerTimer) {
      this.stopSchedulerTimer();
      this.stopSchedulerTimer = null;
    }
    if (this.stopBus) {
      this.stopBus();
      this.stopBus = null;
    }
    if (this.stopWorkflowListener) {
      this.stopWorkflowListener();
      this.stopWorkflowListener = null;
    }
    if (this.stopRestartListener) {
      this.stopRestartListener();
      this.stopRestartListener = null;
    }
    if (this.stopFailureAlert) {
      this.stopFailureAlert();
      this.stopFailureAlert = null;
    }
    if (this.stopApprovalNotification) {
      this.stopApprovalNotification();
      this.stopApprovalNotification = null;
    }
    if (this.stopAttentionDigest) {
      this.stopAttentionDigest();
      this.stopAttentionDigest = null;
    }

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
