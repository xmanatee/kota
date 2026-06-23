import { resolve } from "node:path";
import { tryEmit } from "#core/events/event-bus.js";
import type { KempInit, StdioForeignModuleConfig } from "./foreign-module.js";
import {
  buildForeignToolDefs,
  createRawForeignModule,
  HEALTH_CHECK_TIMEOUT_MS,
} from "./foreign-module-session.js";
import { StdioTransport } from "./foreign-module-stdio.js";
import type { KotaModule, ModuleHealth } from "./module-types.js";
import { printTerminalDiagnostic } from "./terminal-renderer.js";

export const DEFAULT_MAX_RESTARTS = 3;

const DEFAULT_PING_TIMEOUT_MS = 5_000;
const DEFAULT_PING_INTERVAL_MS = 30_000;
const DEFAULT_BACKOFF_BASE_MS = 2_000;

export async function startResilientStdioModule(
  config: StdioForeignModuleConfig,
  projectCwd: string,
  moduleConfig?: KempInit["config"],
): Promise<KotaModule> {
  const maxRestarts = config.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const pingTimeoutMs = config.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const pingIntervalMs = config.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const backoffBase = config.restartBackoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const resolvedCwd = resolve(projectCwd);

  const raw = await createRawForeignModule(
    new StdioTransport(config, resolvedCwd),
    config.command,
    resolvedCwd,
    moduleConfig,
  );
  let session = raw.session;
  let restarts = 0;
  let restarting = false;
  let stopped = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let healthStatus: ModuleHealth["status"] = "ok";
  let totalRestarts = 0;
  let lastRestartAt: string | undefined;

  function clearPingTimer() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  async function doRestart(reason: string): Promise<void> {
    if (restarting || stopped) return;
    restarting = true;
    healthStatus = "restarting";
    clearPingTimer();
    try {
      await session.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(
        `[foreign:${config.command}] Failed to close stale session before restart: ${msg}`,
        "warn",
      );
    }

    while (restarts < maxRestarts) {
      restarts++;
      totalRestarts++;
      lastRestartAt = new Date().toISOString();
      tryEmit("module.restarted", { name: raw.name, reason, totalRestarts });
      const backoffMs = backoffBase * 2 ** (restarts - 1);
      printTerminalDiagnostic(
        `[foreign:${config.command}] Restart ${restarts}/${maxRestarts} in ${backoffMs}ms (${reason}).`,
        "warn",
      );
      await new Promise<void>((resolveRestart) => setTimeout(resolveRestart, backoffMs));
      if (stopped) {
        restarting = false;
        return;
      }

      try {
        const fresh = await createRawForeignModule(
          new StdioTransport(config, resolvedCwd),
          config.command,
          resolvedCwd,
          moduleConfig,
        );
        session = fresh.session;
        restarts = 0;
        healthStatus = "ok";
        printTerminalDiagnostic(`[foreign:${config.command}] Restarted successfully.`, "info");
        watchDeath();
        startPing();
        restarting = false;
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printTerminalDiagnostic(
          `[foreign:${config.command}] Restart attempt ${restarts} failed: ${msg}`,
          "warn",
        );
      }
    }

    printTerminalDiagnostic(
      `[foreign:${config.command}] All ${maxRestarts} restart(s) exhausted. Module failed.`,
      "error",
    );
    healthStatus = "dead";
    tryEmit("module.failed", { name: raw.name, reason });
    restarting = false;
  }

  function watchDeath() {
    const watched = session;
    watched.died.then(() => {
      if (!stopped && session === watched) {
        printTerminalDiagnostic(
          `[foreign:${config.command}] Subprocess exited unexpectedly.`,
          "warn",
        );
        doRestart("subprocess exited unexpectedly");
      }
    });
  }

  function startPing() {
    if (pingIntervalMs <= 0 || pingTimeoutMs <= 0) return;
    pingTimer = setInterval(async () => {
      const current = session;
      try {
        await current.ping(pingTimeoutMs);
      } catch {
        printTerminalDiagnostic(`[foreign:${config.command}] Ping timed out.`, "warn");
        doRestart("ping timeout");
      }
    }, pingIntervalMs);
  }

  watchDeath();
  startPing();

  return {
    name: raw.name,
    version: raw.version,
    description: raw.description,
    tools: buildForeignToolDefs(raw.toolDefs, () => session),
    getHealth: (): ModuleHealth => ({
      status: healthStatus,
      restartCount: totalRestarts,
      lastRestartAt,
    }),
    healthCheck: () => session.healthCheck(HEALTH_CHECK_TIMEOUT_MS),
    onUnload: async () => {
      stopped = true;
      clearPingTimer();
      await session.close();
    },
  };
}
