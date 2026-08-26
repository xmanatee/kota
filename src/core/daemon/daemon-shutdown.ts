import { WORKFLOW_STOP_ABORT_WAIT_MS } from "#core/workflow/runtime-lifecycle.js";
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

  // Fence the shared daemon generation before any scope starts detaching.
  // Existing attempts may finish through the bounded runtime stop, but no
  // timer or completion callback may admit replacement work.
  ctx.runCoordinator.beginDisposal();

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
  await ctx.runCoordinator.dispose(
    options.workflowsStopArgs[1] ?? WORKFLOW_STOP_ABORT_WAIT_MS,
  );
  await ctx.controlServer.stop();
  await ctx.config.unloadModules?.();

  ctx.unsubscribe?.();
  ctx.unsubscribe = null;
  ctx.uninstallEventJournal();

  for (const bundle of ctx.scopeRuntimes.list()) {
    bundle.notificationGate?.dispose();
    bundle.notificationGate = null;
  }

  if (ctx.shutdownHandler) {
    process.removeListener("SIGINT", ctx.shutdownHandler);
    process.removeListener("SIGTERM", ctx.shutdownHandler);
    ctx.shutdownHandler = null;
  }

  // Coordinator disposal proves that no process-owned attempt, publication,
  // retry, or refill can touch this daemon generation again.
  ctx.runState.close();
  releaseInstanceLock(ctx.stateRoot, {
    pid: ctx.state.pid,
    startedAt: ctx.state.startedAt,
    token: ctx.token,
  });

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
