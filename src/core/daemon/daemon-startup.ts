import { join } from "node:path";
import { warnInvalidConcurrencyConfig, warnUnknownConfigKeys } from "#core/config/config-warnings.js";
import { startChannel } from "./daemon-channel-start.js";
import type { DaemonRuntimeContext } from "./daemon-init.js";
import { acquireInstanceLock, writeControlFile } from "./daemon-instance-lock.js";
import { saveDaemonStateToDisk } from "./daemon-state-persistence.js";
import { subscribeDaemon } from "./daemon-subscriptions.js";
import { NotificationGate } from "./notification-gate.js";
import { getScheduler, type ScheduledItem } from "./scheduler.js";
import { sweepExpiredSessions } from "./session-sweep.js";

const DEFAULT_POLL_INTERVAL = 30_000;
const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 60_000;

/**
 * Hooks the orchestrator (`daemon.ts`) supplies to the startup phase. The
 * daemon owns the restart bookkeeping and the matching teardown call, so
 * those callbacks live on the class rather than being inlined here.
 */
export type DaemonStartupHooks = {
  requestRestart: (reason: string) => void;
  maybeRestart: () => void;
  onSignalStop: (gracePeriodMs: number) => void;
};

/**
 * Run the daemon's startup phase in the order operator UIs and tests
 * depend on:
 * signal handlers → single-instance check → workflow validation →
 * config-warnings → control server → control-file write →
 * sweep + health-check timers → daemon subscriptions →
 * notification gate → workflows.start → channel start loop →
 * keep-alive loop. Each step mutates `ctx` in place.
 */
export async function runDaemonStartup(
  ctx: DaemonRuntimeContext,
  hooks: DaemonStartupHooks,
): Promise<void> {
  const gracePeriodMs =
    ctx.config.shutdownGracePeriodMs ??
    ctx.config.config?.daemon?.shutdownGracePeriodMs ??
    DEFAULT_SHUTDOWN_GRACE_PERIOD_MS;
  ctx.shutdownHandler = (signal?: NodeJS.Signals) => {
    hooks.onSignalStop(signal === "SIGINT" ? 1 : gracePeriodMs);
  };
  process.on("SIGINT", ctx.shutdownHandler);
  process.on("SIGTERM", ctx.shutdownHandler);

  await acquireInstanceLock(ctx.stateDir, ctx.log);
  ctx.workflows.validateDefinitions();

  ctx.log("Daemon starting...");
  warnUnknownConfigKeys(ctx.projectDir, ctx.log, ctx.config.moduleConfigKeys);
  warnInvalidConcurrencyConfig(ctx.projectDir, ctx.log);

  const controlPort = await ctx.controlServer.start();
  writeControlFile(ctx.stateDir, {
    port: controlPort,
    pid: process.pid,
    startedAt: ctx.state.startedAt,
    token: ctx.token,
  });
  ctx.log(`Control API on http://127.0.0.1:${controlPort}`);

  const idleTtlMs = ctx.config.sessionIdleTtlMs ?? 5 * 60_000;
  const sweepMs = ctx.config.sessionSweepIntervalMs ?? 60_000;
  ctx.sessionSweepTimer = setInterval(() => {
    const expired = sweepExpiredSessions(ctx.sessions, Date.now(), idleTtlMs);
    for (const id of expired) {
      ctx.bus.emit("session.unregistered", { id });
    }
  }, sweepMs);

  if (ctx.config.probeModuleHealthChecks) {
    const probe = ctx.config.probeModuleHealthChecks;
    const runProbe = () => {
      void probe()
        .then((r) => {
          ctx.moduleHealthChecks = r;
        })
        .catch((err: unknown) => {
          ctx.log(`Module health probe failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    };
    runProbe();
    ctx.healthCheckTimer = setInterval(runProbe, 30_000);
  }

  const pollMs = ctx.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const runsDir = join(ctx.stateDir, "runs");

  ctx.unsubscribe = subscribeDaemon({
    bus: ctx.bus,
    projectDir: ctx.projectDir,
    pollIntervalMs: pollMs,
    approvalTtlMs: ctx.config.config?.approvalTtlMs,
    alertCooldownMs: ctx.config.config?.notifications?.alertCooldownMs,
    moduleCrashAlertOpts: ctx.config.config?.moduleMonitoring,
    getWorkflowNotify: (name) => ctx.workflows.getDefinitions().find((d) => d.name === name)?.notify,
    onDueItems: (items) => handleDueItems(ctx, items),
    onWorkflowCompleted: (payload) => {
      ctx.state.completedRuns += 1;
      ctx.state.lastCompletedWorkflow = payload.workflow;
      ctx.state.lastCompletedAt = new Date().toISOString();
      ctx.state.lastCompletedStatus = payload.status;
      saveDaemonStateToDisk(ctx.stateDir, ctx.state);
      hooks.maybeRestart();
    },
    onRestartRequested: (reason) => hooks.requestRestart(reason),
    onLog: ctx.log,
  });

  const quietHours = ctx.config.config?.notifications?.quietHours;
  if (quietHours) {
    ctx.notificationGate = new NotificationGate(ctx.bus, quietHours);
    ctx.log(`Notification gate active: quiet hours ${quietHours.start}–${quietHours.end}`);
  }

  ctx.workflows.start();

  const operator = process.env.KOTA_OPERATOR;
  const channelCtx = {
    projectDir: ctx.projectDir,
    log: ctx.log,
    getWorkflowStatus: () => ({
      runtimeState: ctx.workflows.getState(),
      dispatchPaused: ctx.workflows.isDispatchPaused(),
      runsDir,
    }),
    operator,
    identity: operator ? { operator } : undefined,
  };
  ctx.channelStatuses = [];
  for (const def of ctx.config.channels ?? []) {
    await startChannel(def, channelCtx, ctx.channelStatuses, ctx.activeChannels, ctx.log);
  }

  saveDaemonStateToDisk(ctx.stateDir, ctx.state);
  ctx.log(
    `Daemon ready (pid ${process.pid}): ${ctx.workflows.getDefinitionCount()} workflows, ` +
      `${getScheduler().count()} scheduled items, poll ${pollMs / 1000}s`,
  );

  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {
      if (!ctx.running) {
        clearInterval(keepAlive);
        resolve();
      } else {
        hooks.maybeRestart();
      }
    }, 1_000);
  });
}

function handleDueItems(ctx: DaemonRuntimeContext, items: ScheduledItem[]): void {
  if (!ctx.running || ctx.stopping) return;
  for (const item of items) {
    ctx.log(`Reminder: ${item.description}`);
  }
}
