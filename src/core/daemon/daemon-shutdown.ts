import type { DaemonRuntimeContext } from "./daemon-init.js";
import { releaseInstanceLock } from "./daemon-instance-lock.js";
import type { DaemonStopReason } from "./daemon-state.js";
import { saveDaemonStateToDisk } from "./daemon-state-persistence.js";
import { stopDaemonWorkflowRuntimes } from "./daemon-workflows.js";

/** Shared teardown for normal stops and failed startup cleanup. */
export type DaemonShutdownOptions = {
  workflowsStopArgs: [number] | [number, number];
  saveState: boolean;
  logShutdown: boolean;
  stopReason: DaemonStopReason;
};

export async function runDaemonShutdown(
  ctx: DaemonRuntimeContext,
  options: DaemonShutdownOptions,
): Promise<void> {
  if (options.logShutdown) {
    ctx.log("Daemon shutting down...");
  }

  if (ctx.sessionSweepTimer !== null) {
    clearInterval(ctx.sessionSweepTimer);
    ctx.sessionSweepTimer = null;
  }
  if (ctx.healthCheckTimer !== null) {
    clearInterval(ctx.healthCheckTimer);
    ctx.healthCheckTimer = null;
  }
  ctx.eventLoopLatency.stop();

  for (const adapter of ctx.activeChannels) {
    await adapter.stop();
  }
  ctx.activeChannels = [];
  ctx.channelStatuses = [];

  await stopDaemonWorkflowRuntimes(ctx, ...options.workflowsStopArgs);
  await ctx.controlServer.stop();
  await ctx.config.unloadModules?.();

  releaseInstanceLock(ctx.stateRoot, {
    pid: ctx.state.pid,
    startedAt: ctx.state.startedAt,
    token: ctx.token,
  });

  ctx.unsubscribe?.();
  ctx.unsubscribe = null;
  ctx.uninstallEventJournal();

  for (const bundle of ctx.projectRuntimes.list()) {
    bundle.notificationGate?.dispose();
    bundle.notificationGate = null;
  }

  if (ctx.shutdownHandler) {
    process.removeListener("SIGINT", ctx.shutdownHandler);
    process.removeListener("SIGTERM", ctx.shutdownHandler);
    ctx.shutdownHandler = null;
  }

  if (options.saveState) {
    ctx.state.lastStoppedAt = new Date().toISOString();
    ctx.state.lastStopReason = options.stopReason;
    saveDaemonStateToDisk(ctx.stateDir, ctx.state);
  }

  ctx.running = false;
  ctx.stopping = false;

  if (options.logShutdown) {
    ctx.log("Daemon stopped.");
  }
}
