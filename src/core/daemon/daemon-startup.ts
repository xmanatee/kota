import { join } from "node:path";
import {
  warnIgnoredUntrustedProjectConfig,
  warnInvalidConcurrencyConfig,
  warnUnknownConfigKeys,
} from "#core/config/config-warnings.js";
import { startChannel } from "./daemon-channel-start.js";
import type { DaemonRuntimeContext } from "./daemon-init.js";
import { acquireInstanceLock, writeControlFile } from "./daemon-instance-lock.js";
import { saveDaemonStateToDisk } from "./daemon-state-persistence.js";
import { subscribeDaemon } from "./daemon-subscriptions.js";
import {
  startDaemonWorkflowRuntimes,
  validateDaemonWorkflowRuntimes,
} from "./daemon-workflows.js";
import { getScheduler } from "./scheduler.js";
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
  onSignalStop: (signal: NodeJS.Signals, gracePeriodMs: number) => void;
};

/**
 * Run the daemon's startup phase in the order operator UIs and tests
 * depend on:
 * signal handlers → instance reservation → workflow validation →
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
    if (signal === undefined) return;
    hooks.onSignalStop(signal, signal === "SIGINT" ? 1 : gracePeriodMs);
  };
  process.on("SIGINT", ctx.shutdownHandler);
  process.on("SIGTERM", ctx.shutdownHandler);

  await acquireInstanceLock(
    ctx.projectDir,
    ctx.stateRoot,
    {
      pid: ctx.state.pid,
      startedAt: ctx.state.startedAt,
      token: ctx.token,
    },
    ctx.log,
  );
  validateDaemonWorkflowRuntimes(ctx);

  ctx.log("Daemon starting...");
  warnIgnoredUntrustedProjectConfig(ctx.projectDir, ctx.log);
  warnUnknownConfigKeys(ctx.projectDir, ctx.log, ctx.config.moduleConfigKeys);
  warnInvalidConcurrencyConfig(ctx.projectDir, ctx.log);

  const controlPort = await ctx.controlServer.start();
  writeControlFile(ctx.stateRoot, {
    port: controlPort,
    pid: process.pid,
    startedAt: ctx.state.startedAt,
    token: ctx.token,
  });
  ctx.log(`Control API on http://127.0.0.1:${controlPort}`);
  ctx.eventLoopLatency.start();

  const idleTtlMs = ctx.config.sessionIdleTtlMs ?? 5 * 60_000;
  const sweepMs = ctx.config.sessionSweepIntervalMs ?? 60_000;
  ctx.sessionSweepTimer = setInterval(() => {
    const expiredSessions = sweepExpiredSessions(ctx.sessions, Date.now(), idleTtlMs);
    for (const session of expiredSessions) {
      ctx.projectRuntimes
        .get(session.projectId)
        .pbus.emit("session.unregistered", { id: session.id });
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
  ctx.unsubscribe = subscribeDaemon({
    bus: ctx.bus,
    approvalQueues: () => ctx.projectRuntimes
      .list()
      .map((runtime) => runtime.approvalQueue),
    pollIntervalMs: pollMs,
    approvalTtlMs: ctx.config.config?.approvalTtlMs,
    moduleCrashAlertOpts: ctx.config.config?.moduleMonitoring,
    onWorkflowCompleted: () => hooks.maybeRestart(),
    onRestartRequested: (reason) => hooks.requestRestart(reason),
    onLog: ctx.log,
  });

  const quietHours = ctx.config.config?.notifications?.quietHours;
  if (quietHours && ctx.projectRuntimes.getDefault().notificationGate) {
    ctx.log(`Notification gate active: quiet hours ${quietHours.start}–${quietHours.end}`);
  }

  await startDaemonWorkflowRuntimes(ctx);

  const operator = process.env.KOTA_OPERATOR;
  const channelCtx = {
    getDefaultProjectRuntime: () =>
      ctx.scopeLifecycle.getChannelRuntime(ctx.projectRuntimes.getDefaultProjectId()),
    getProjectRuntime: (projectId: string) =>
      ctx.scopeLifecycle.getChannelRuntime(projectId),
    log: ctx.log,
    getWorkflowStatus: () => {
      const runtime = ctx.scopeLifecycle.getChannelRuntime(
        ctx.projectRuntimes.getDefaultProjectId(),
      );
      return {
        runtimeState: runtime.workflowRuntime.getState(),
        dispatchPaused: runtime.workflowRuntime.isDispatchPaused(),
        runsDir: join(runtime.project.projectDir, ".kota", "runs"),
      };
    },
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
