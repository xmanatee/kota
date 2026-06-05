import type { DaemonRuntimeContext } from "./daemon-init.js";
import { releaseInstanceLock } from "./daemon-instance-lock.js";
import { saveDaemonStateToDisk } from "./daemon-state-persistence.js";
import { stopDaemonWorkflowRuntimes } from "./daemon-workflows.js";

/**
 * Single unified teardown for the daemon. Both `stop()` and the failed-start
 * cleanup path call this with parameters describing how aggressive
 * `workflows.stop` should be and whether final state should be saved and
 * announced. Keeping one body closes the drift between the two paths by
 * construction.
 *
 * `workflowsStopArgs`: passed straight to `WorkflowRuntime.stop`.
 * - normal stop: `[gracePeriodMs]`
 * - failed-start cleanup: `[1, 1_000]` (drain instantly, then abort fast)
 *
 * `saveState`: persist daemon-state.json before announcing the stop. Failed
 * start skips this — it never owned the on-disk pid/started-at slot.
 *
 * `logShutdown`: emit the "Daemon shutting down..." / "Daemon stopped." log
 * lines that operators key off of. Failed start runs silently because the
 * "Daemon starting..." line never fired.
 */
export type DaemonShutdownOptions = {
  workflowsStopArgs: [number] | [number, number];
  saveState: boolean;
  logShutdown: boolean;
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

  for (const adapter of ctx.activeChannels) {
    await adapter.stop();
  }
  ctx.activeChannels = [];
  ctx.channelStatuses = [];

  await stopDaemonWorkflowRuntimes(ctx, ...options.workflowsStopArgs);
  await ctx.controlServer.stop();

  releaseInstanceLock(ctx.stateDir);

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
    saveDaemonStateToDisk(ctx.stateDir, ctx.state);
  }

  ctx.running = false;
  ctx.stopping = false;

  if (options.logShutdown) {
    ctx.log("Daemon stopped.");
  }
}
