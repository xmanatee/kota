import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getApprovalQueue } from "../approval-queue.js";
import type { ChannelAdapter, ChannelDef } from "../channel.js";
import { type KotaConfig, loadConfig } from "../config.js";
import { type EventBus, initEventBus } from "../event-bus.js";
import { discoverExtensions } from "../extension-discovery.js";
import { initExtensionLogStore } from "../extension-log.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "../json-file.js";
import type { LogFormat } from "../log-format.js";
import { getHistory } from "../memory/history.js";
import { getRegisteredWorkflowDefinitions } from "../workflow/registry.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import { WorkflowRuntime } from "../workflow/runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "../workflow/types.js";
import { DaemonControlServer, type DaemonTaskStatusResponse, type InteractiveSession, type WorkflowCostEntry, type WorkflowDefinitionSummary, type WorkflowDurationHistogramEntry, type WorkflowMetricCounts, type WorkflowRunCountEntry, type WorkflowRunDetail, type WorkflowRunSummary } from "./daemon-control.js";
import { DaemonLogger } from "./daemon-logger.js";
import { assertDaemonState, type DaemonState } from "./daemon-state.js";
import { subscribeDaemon } from "./daemon-subscriptions.js";
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
  private activeChannels: ChannelAdapter[] = [];
  private sessions = new Map<string, InteractiveSession>();
  private sessionSweepTimer: ReturnType<typeof setInterval> | null = null;
  private restartRequested = false;
  private restartReason: string | null = null;
  private running = false;
  private stopping = false;
  private shutdownHandler: (() => void) | null = null;
  /** Sliding-window timestamps (ms) for webhook rate limiting, keyed by workflow name. */
  private webhookTimestamps = new Map<string, number[]>();
  private metricCountsCache: WorkflowMetricCounts | null = null;
  private metricCountsCacheAt = 0;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.logger = new DaemonLogger(config.logFormat);
    this.projectDir = config.projectDir ?? process.cwd();
    this.stateDir = config.stateDir ?? join(this.projectDir, ".kota");

    this.bus = initEventBus();
    this.runStore = new WorkflowRunStore(this.projectDir);
    initTaskStore(this.projectDir);
    initScheduler(this.projectDir);
    initExtensionLogStore(this.projectDir);

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
    this.token = randomBytes(32).toString("hex");

    this.controlServer = new DaemonControlServer({
      getHealthStatus: () => ({
        scheduler: "ok" as const,
        extensions: "ok" as const,
      }),
      getDaemonLiveState: () => ({ ...this.state, running: this.isRunning() }),
      getWorkflowLiveStatus: () => {
        const wfState = this.workflows.getState();
        const windowStatus = this.workflows.getDispatchWindowStatus();
        return {
          activeRuns: wfState.activeRuns ?? [],
          pendingRuns: wfState.pendingRuns,
          queueLength: wfState.queueLength,
          completedRuns: wfState.completedRuns,
          totalCostUsd: wfState.totalCostUsd,
          agentBackoff: wfState.agentBackoff,
          definitionsLoadedAt: wfState.definitionsLoadedAt,
          workflows: wfState.workflows,
          paused: this.workflows.isDispatchPaused(),
          ...(windowStatus.blocked && {
            dispatchWindowBlocked: true,
            dispatchWindowOpensAt: windowStatus.opensAt,
          }),
        };
      },
      pauseWorkflowDispatch: () => {
        const already = this.workflows.isDispatchPaused();
        if (!already) this.workflows.setDispatchPaused(true);
        return { already };
      },
      resumeWorkflowDispatch: () => {
        const already = !this.workflows.isDispatchPaused();
        if (!already) this.workflows.setDispatchPaused(false);
        return { already };
      },
      abortActiveRuns: () => this.workflows.abortActiveRuns(),
      abortActiveRun: (runId: string) => this.workflows.abortActiveRun(runId),
      reloadWorkflowDefinitions: () => this.workflows.reloadWorkflowDefinitions(),
      reloadConfig: async () => {
        const userExtensions = await discoverExtensions(this.projectDir, this.config.verbose ?? false);
        const newKotaConfig = loadConfig(this.projectDir);
        const contributed: RegisteredWorkflowDefinitionInput[] = userExtensions.flatMap((ext) =>
          (ext.workflows ?? []).map((w) => ({
            ...w,
            definitionPath: `extensions/${ext.name}`,
          } as RegisteredWorkflowDefinitionInput)),
        );
        const allWorkflows = getRegisteredWorkflowDefinitions(contributed);
        this.workflows.setWorkflowInputs(allWorkflows);
        const { count } = this.workflows.reloadWorkflowDefinitions();
        this.log(`Config reloaded: ${count} workflow definition(s) active`);
        if (userExtensions.length > 0) {
          this.log(`  User extensions: ${userExtensions.map((e) => e.name).join(", ")}`);
        }
        void newKotaConfig;
        return { workflows: count };
      },
      getWorkflowDefinitions: (): WorkflowDefinitionSummary[] =>
        this.workflows.getDefinitions().map((def) => {
          const sourceEnabled = this.workflows.getDefinitionSourceEnabled(def.name);
          const hasOverride = sourceEnabled !== undefined && sourceEnabled !== def.enabled;
          return {
            name: def.name,
            enabled: sourceEnabled !== undefined ? sourceEnabled : def.enabled,
            ...(hasOverride ? { runtimeEnabled: def.enabled } : {}),
            stepCount: def.steps.length,
            triggers: def.triggers.map((t): WorkflowDefinitionSummary["triggers"][number] => {
              if (t.webhook) return { type: "webhook" };
              if (t.watch) return { type: "watch", patterns: t.watch, debounceMs: t.debounceMs ?? 500 };
              if (t.schedule) return { type: "cron", schedule: t.schedule };
              if (t.intervalMs != null) return { type: "interval", intervalMs: t.intervalMs };
              return { type: "event", event: t.event };
            }),
            ...(def.inputSchema !== undefined ? { inputSchema: def.inputSchema } : {}),
            ...(def.outputSchema !== undefined ? { outputSchema: def.outputSchema } : {}),
          };
        }),
      enableWorkflow: (name: string) => this.workflows.enableWorkflow(name),
      disableWorkflow: (name: string) => this.workflows.disableWorkflow(name),
      enqueuePendingRun: (name: string, tags?: string[], extraPayload?: Record<string, unknown>) => this.workflows.enqueuePendingRun(name, tags, extraPayload),
      cancelQueuedRun: (runId: string) => this.workflows.cancelQueuedRun(runId),
      subscribeToEvents: (handler) => {
        const stops = [
          this.bus.on("workflow.started", (p) => {
            handler({ type: "workflow.started", payload: p as unknown as Record<string, unknown> });
            handler({ type: "queue.changed", payload: { source: "workflow.started", workflow: p.workflow } });
          }),
          this.bus.on("workflow.completed", (p) => {
            handler({ type: "workflow.completed", payload: p as unknown as Record<string, unknown> });
            handler({ type: "queue.changed", payload: { source: "workflow.completed", workflow: p.workflow, status: p.status } });
          }),
          this.bus.on("workflow.step.completed", (p) =>
            handler({ type: "workflow.step.completed", payload: p as unknown as Record<string, unknown> }),
          ),
          this.bus.on("approval.changed", (p) =>
            handler({ type: "approval.changed", payload: p as unknown as Record<string, unknown> }),
          ),
          this.bus.on("task.changed", (p) =>
            handler({ type: "task.changed", payload: p as unknown as Record<string, unknown> }),
          ),
          this.bus.on("session.registered", (p) =>
            handler({ type: "session.registered", payload: p as unknown as Record<string, unknown> }),
          ),
          this.bus.on("session.unregistered", (p) =>
            handler({ type: "session.unregistered", payload: p as unknown as Record<string, unknown> }),
          ),
        ];
        return () => stops.forEach((s) => s());
      },
      listHistory: (search?: string, limit = 20) => getHistory().list({ search, limit }),
      getHistory: (id: string) => getHistory().load(id) ?? null,
      deleteHistory: (id: string) => getHistory().remove(id),
      listApprovals: () => getApprovalQueue().list("pending"),
      approveApproval: (id: string, note?: string) => getApprovalQueue().approve(id, note),
      rejectApproval: (id: string, reason?: string) => getApprovalQueue().reject(id, reason),
      listWorkflowRuns: (workflow?: string, limit?: number, tag?: string, causedByRunId?: string): WorkflowRunSummary[] =>
        this.runStore.listRuns({ workflow, limit, tag, causedByRunId }).map((m) => ({
          id: m.id,
          workflow: m.workflow,
          status: m.status,
          triggerEvent: m.trigger.event,
          startedAt: m.startedAt,
          ...(m.durationMs != null && { durationMs: m.durationMs }),
          ...(m.totalCostUsd != null && { totalCostUsd: m.totalCostUsd }),
          ...(m.triggeredByRunId != null && { triggeredByRunId: m.triggeredByRunId }),
          ...(m.causedBy != null && { causedBy: m.causedBy }),
          ...(m.retryOf != null && { retryOf: m.retryOf }),
          ...(m.tags && m.tags.length > 0 && { tags: m.tags }),
        })),
      getWorkflowRun: (id: string): WorkflowRunDetail | null => {
        const m = this.runStore.getRun(id);
        if (!m) return null;
        return {
          id: m.id,
          workflow: m.workflow,
          status: m.status,
          triggerEvent: m.trigger.event,
          startedAt: m.startedAt,
          ...(m.completedAt != null && { completedAt: m.completedAt }),
          ...(m.durationMs != null && { durationMs: m.durationMs }),
          ...(m.totalCostUsd != null && { totalCostUsd: m.totalCostUsd }),
          ...(m.triggeredByRunId != null && { triggeredByRunId: m.triggeredByRunId }),
          ...(m.causedBy != null && { causedBy: m.causedBy }),
          ...(m.retryOf != null && { retryOf: m.retryOf }),
          ...(m.tags && m.tags.length > 0 && { tags: m.tags }),
          ...(m.trigger.payload && Object.keys(m.trigger.payload).length > 0 && { triggerPayload: m.trigger.payload }),
          ...(m.warnings && m.warnings.length > 0 && { warnings: m.warnings }),
          steps: m.steps.map((s) => {
            const agentCost = s.type === "agent" && typeof (s.output as { totalCostUsd?: unknown } | null | undefined)?.totalCostUsd === "number"
              ? (s.output as { totalCostUsd: number }).totalCostUsd
              : undefined;
            return {
              id: s.id,
              type: s.type,
              status: s.status,
              durationMs: s.durationMs,
              ...(s.error != null && { error: s.error }),
              ...(agentCost != null && { costUsd: agentCost }),
              ...(s.toolCalls != null && { toolCalls: s.toolCalls }),
            };
          }),
        };
      },
      getTaskStatus: () => this.readTaskStatus(),
      getWorkflowMetricCounts: (): WorkflowMetricCounts => {
        const now = Date.now();
        if (this.metricCountsCache && now - this.metricCountsCacheAt < 30_000) {
          return this.metricCountsCache;
        }
        const DURATION_BUCKETS_S = [30, 120, 300, 900, 1800, 3600] as const;
        const runs = this.runStore.listRuns({ limit: 100_000 });
        const countMap = new Map<string, number>();
        const costMap = new Map<string, number>();
        // key: "workflow\x00status" -> { buckets: Map<number|"+Inf", count>, sum, count }
        const durationMap = new Map<string, { buckets: Map<number | "+Inf", number>; sum: number; count: number }>();
        for (const run of runs) {
          if (!run.workflow || !run.status || run.status === "running") continue;
          const countKey = `${run.workflow}\x00${run.status}`;
          countMap.set(countKey, (countMap.get(countKey) ?? 0) + 1);
          if (typeof run.totalCostUsd === "number") {
            costMap.set(run.workflow, (costMap.get(run.workflow) ?? 0) + run.totalCostUsd);
          }
          if (typeof run.durationMs === "number") {
            const durationS = run.durationMs / 1000;
            let entry = durationMap.get(countKey);
            if (!entry) {
              const buckets = new Map<number | "+Inf", number>();
              for (const b of DURATION_BUCKETS_S) buckets.set(b, 0);
              buckets.set("+Inf", 0);
              entry = { buckets, sum: 0, count: 0 };
              durationMap.set(countKey, entry);
            }
            for (const b of DURATION_BUCKETS_S) {
              if (durationS <= b) entry.buckets.set(b, (entry.buckets.get(b) ?? 0) + 1);
            }
            entry.buckets.set("+Inf", (entry.buckets.get("+Inf") ?? 0) + 1);
            entry.sum += durationS;
            entry.count += 1;
          }
        }
        const runCounts: WorkflowRunCountEntry[] = [];
        for (const [key, count] of countMap) {
          const sep = key.indexOf("\x00");
          runCounts.push({ workflow: key.slice(0, sep), status: key.slice(sep + 1), count });
        }
        const costTotals: WorkflowCostEntry[] = [];
        for (const [workflow, costUsd] of costMap) {
          costTotals.push({ workflow, costUsd });
        }
        const durationHistogram: WorkflowDurationHistogramEntry[] = [];
        for (const [key, entry] of durationMap) {
          const sep = key.indexOf("\x00");
          durationHistogram.push({
            workflow: key.slice(0, sep),
            status: key.slice(sep + 1),
            buckets: [...entry.buckets.entries()].map(([le, count]) => ({ le, count })),
            sum: entry.sum,
            count: entry.count,
          });
        }
        const result: WorkflowMetricCounts = { runCounts, costTotals, durationHistogram };
        this.metricCountsCache = result;
        this.metricCountsCacheAt = now;
        return result;
      },
      registerSession: (id: string, createdAt: string) => {
        this.sessions.set(id, { id, createdAt, lastActive: Date.now() });
        this.bus.emit("session.registered", { id, createdAt });
      },
      unregisterSession: (id: string) => {
        this.sessions.delete(id);
        this.bus.emit("session.unregistered", { id });
      },
      listSessions: () => [...this.sessions.values()],
      triggerWebhookRun: (name: string, signature: string, rawBody: Buffer, payload: { body: unknown; headers: Record<string, string>; timestamp: string }, webhookTimestamp?: string) => {
        const expectedSecret = this.config.config?.webhooks?.[name]?.secret;
        if (!expectedSecret) return { ok: false, unauthorized: true };
        const hexSig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
        const expected = createHmac("sha256", expectedSecret).update(rawBody).digest("hex");
        let sigMatch = false;
        try {
          sigMatch = timingSafeEqual(Buffer.from(hexSig, "hex"), Buffer.from(expected, "hex"));
        } catch {
          sigMatch = false;
        }
        if (!sigMatch) return { ok: false, unauthorized: true };
        if (webhookTimestamp !== undefined) {
          const ts = parseInt(webhookTimestamp, 10);
          if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
            return { ok: false, unauthorized: true };
          }
        }
        // Check rate limit before enqueuing.
        const definition = this.workflows.getDefinitions().find((d) => d.name === name);
        const rateLimit = definition?.webhookRateLimit;
        if (rateLimit) {
          const now = Date.now();
          const windowMs = 60_000;
          const windowStart = now - windowMs;
          const timestamps = (this.webhookTimestamps.get(name) ?? []).filter((t) => t > windowStart);
          if (timestamps.length >= rateLimit.maxPerMinute) {
            const oldest = timestamps[0];
            const retryAfterMs = oldest + windowMs - now;
            return { ok: false, rateLimited: true, retryAfterMs };
          }
          timestamps.push(now);
          this.webhookTimestamps.set(name, timestamps);
        }
        const result = this.workflows.enqueueWebhookRun(name, payload);
        if (result.error?.startsWith("Unknown workflow") || result.error?.includes("no webhook trigger")) {
          return { ok: false, notFound: true };
        }
        return result;
      },
    }, this.token, {
      eventBufferSize: config.config?.daemon?.eventBufferSize,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.restartRequested = false;
    this.restartReason = null;

    this.log("Daemon starting...");
    this.saveState();

    // Register signal handlers before any awaits so callers can observe them immediately.
    const gracePeriodMs = this.config.shutdownGracePeriodMs ?? this.config.config?.daemon?.shutdownGracePeriodMs ?? DEFAULT_SHUTDOWN_GRACE_PERIOD_MS;
    this.shutdownHandler = () => {
      void this.stop(gracePeriodMs);
    };
    process.on("SIGINT", this.shutdownHandler);
    process.on("SIGTERM", this.shutdownHandler);

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

    const pollMs = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    const runsDir = join(this.stateDir, "runs");

    this.unsubscribe = subscribeDaemon({
      bus: this.bus,
      projectDir: this.projectDir,
      pollIntervalMs: pollMs,
      approvalTtlMs: this.config.config?.approvalTtlMs,
      alertCooldownMs: this.config.config?.notifications?.alertCooldownMs,
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

    this.workflows.start();

    const channelCtx = {
      projectDir: this.projectDir,
      log: (message: string) => this.log(message),
      getWorkflowStatus: () => ({
        runtimeState: this.workflows.getState(),
        dispatchPaused: this.workflows.isDispatchPaused(),
        runsDir,
      }),
    };
    for (const def of this.config.channels ?? []) {
      const adapter = def.create(channelCtx);
      if (adapter) {
        this.activeChannels.push(adapter);
        await adapter.start();
        this.log(`Channel started: ${def.name}`);
      }
    }

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

  async stop(gracePeriodMs = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.log("Daemon shutting down...");

    if (this.sessionSweepTimer !== null) {
      clearInterval(this.sessionSweepTimer);
      this.sessionSweepTimer = null;
    }

    for (const adapter of this.activeChannels) {
      await adapter.stop();
    }
    this.activeChannels = [];

    await this.workflows.stop(gracePeriodMs);
    await this.controlServer.stop();

    const controlPath = join(this.stateDir, CONTROL_FILE);
    if (existsSync(controlPath)) {
      try {
        rmSync(controlPath);
      } catch {
        // ignore cleanup errors
      }
    }

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

  private readTaskStatus(): DaemonTaskStatusResponse {
    const tasksDir = join(this.projectDir, "tasks");
    const countedStates = ["inbox", "ready", "backlog", "doing", "blocked"] as const;
    const detailStates = ["doing", "ready", "backlog", "blocked"] as const;

    const listFiles = (state: string): string[] => {
      const dir = join(tasksDir, state);
      try {
        return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
      } catch {
        return [];
      }
    };

    const parseFm = (content: string): Record<string, string> => {
      const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) return {};
      const fields: Record<string, string> = {};
      for (const line of m[1].split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
      return fields;
    };

    const extractBody = (content: string): string => {
      const bm = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
      return bm ? bm[1].trim() : "";
    };

    const readState = (state: string): DaemonTaskStatusResponse["tasks"]["doing"] =>
      listFiles(state).flatMap((file) => {
        try {
          const content = readFileSync(join(tasksDir, state, file), "utf-8");
          const fm = parseFm(content);
          if (!fm.id || !fm.title) return [];
          return [{ id: fm.id, title: fm.title, priority: fm.priority ?? "", area: fm.area ?? "", summary: fm.summary ?? "", body: extractBody(content) }];
        } catch {
          return [];
        }
      });

    const counts = Object.fromEntries(countedStates.map((s) => [s, listFiles(s).length])) as DaemonTaskStatusResponse["counts"];
    const tasks = Object.fromEntries(detailStates.map((s) => [s, readState(s)])) as DaemonTaskStatusResponse["tasks"];
    return { counts, tasks };
  }

  private log(message: string): void {
    this.logger.line(message);
  }
}
