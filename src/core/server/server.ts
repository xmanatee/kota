/**
 * HTTP API server — makes KOTA accessible via HTTP with SSE streaming.
 *
 * Enables web UIs, bots, and automation to interact with KOTA
 * without going through the CLI. Uses the Transport layer (iter 363)
 * for real, exercising it beyond CliTransport for the first time.
 */

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { KotaConfig } from "#core/config/config.js";
import { loadConfig } from "#core/config/config.js";
import { getScheduler, initScheduler, resetScheduler } from "#core/daemon/scheduler.js";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import { initModuleLogStore } from "#core/modules/module-log.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { DaemonLink } from "./daemon-link.js";
import type { DaemonTransport } from "./daemon-transport.js";
import type { DaemonClientHandlers } from "./kota-client.js";
import { NOTIFICATION_HUB_PROVIDER_TYPE } from "./notification-hub-provider.js";
import { buildRequestHandler } from "./server-routes.js";
import { SessionPool } from "./session-pool.js";

const LOOPBACK_HOST = "127.0.0.1";

export type ServerOptions = {
  port?: number;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  noAuth?: boolean;
  /**
   * Module-contributed daemon handler factory threaded through to
   * `DaemonLink` so its `DaemonControlClient` can satisfy the
   * `assembleDaemonClientHandlers` coverage check. The factory captures
   * the live module loader's `daemonClient(link)` factories.
   */
  assembleDaemonHandlers?: (
    transport: DaemonTransport,
  ) => Partial<DaemonClientHandlers>;
  /**
   * Lazy resolver for the fallback autonomy mode applied to sessions when the
   * request body does not specify one. The resolver is invoked at
   * session-creation time, not at server boot, so an unconfigured posture only
   * blocks the request that actually needs it — monitoring and status routes
   * still come up. The resolver must throw if no posture can be determined;
   * silent global defaults are not allowed.
   */
  resolveDefaultAutonomyMode: () => AutonomyMode;
  /**
   * Override the generated auth token. Useful in tests to use a known value.
   * Has no effect when noAuth is true.
   */
  authToken?: string;
  /** Routes registered by modules (e.g., vercel-adapter). */
  moduleRoutes?: RouteRegistration[];
};

export function startServer(options: ServerOptions): Server {
  const port = options.port ?? 3000;
  const config = options.config ?? loadConfig();
  const pool = new SessionPool();

  const noAuth = options.noAuth ?? config.serve?.noAuth ?? false;
  const authToken = noAuth ? undefined : (options.authToken ?? randomBytes(32).toString("hex"));

  const daemonLink = new DaemonLink({
    stateDir: join(process.cwd(), ".kota"),
    onReconnect: async (client) => {
      for (const info of pool.list()) {
        await client.registerSession(info.id, info.createdAt, info.autonomyMode);
      }
    },
    ...(options.assembleDaemonHandlers && {
      assembleDaemonHandlers: options.assembleDaemonHandlers,
    }),
  });
  const daemonRunning = daemonLink.current() !== null;

  const bus = initEventBus();
  // When the daemon is running, it owns the scheduler. Use an in-memory-only
  // scheduler here so the server does not start a second disk-backed instance.
  if (daemonRunning) {
    initScheduler(process.cwd(), null);
  } else {
    initScheduler(process.cwd());
  }
  initModuleLogStore(process.cwd());
  const scheduler = getScheduler();

  let stopBusConnection = (): void => {};
  let stopScheduler = (): void => {};
  if (!daemonRunning) {
    const hub = getProviderRegistry()?.get(NOTIFICATION_HUB_PROVIDER_TYPE);
    if (hub) {
      stopBusConnection = scheduler.connectBus(bus, (dueItems) => {
        hub.handleDueItems(dueItems);
      });
      stopScheduler = scheduler.startTimer(30_000, (dueItems) => {
        hub.handleDueItems(dueItems);
      });
    }
  }

  const cleanupTimer = setInterval(() => pool.cleanup(), 5 * 60 * 1000);
  cleanupTimer.unref();

  function makeAgent(transport: Transport, autonomyMode: AutonomyMode): AgentSession {
    const loopOpts: LoopOptions = {
      autonomyMode,
      model: options.model ?? config.model,
      verbose: options.verbose ?? config.verbose,
      transport,
      config,
    };
    return new AgentSession(loopOpts);
  }

  const handleRequest = buildRequestHandler({
    port,
    pool,
    scheduler,
    bus,
    moduleRoutes: options.moduleRoutes ?? [],
    makeAgent,
    resolveDefaultAutonomyMode: options.resolveDefaultAutonomyMode,
    getDaemonClient: () => daemonLink.current(),
    authToken,
  });

  const server = createServer(handleRequest);

  server.on("close", () => {
    clearInterval(cleanupTimer);
    stopBusConnection();
    stopScheduler();
    resetScheduler();
    resetEventBus();
    daemonLink.close();
    pool.closeAll();
  });

  server.listen(port, LOOPBACK_HOST, () => {
    const address = server.address() as AddressInfo | null;
    const actualPort = address?.port ?? port;
    console.log(`KOTA server listening on http://${LOOPBACK_HOST}:${actualPort}`);
    if (authToken) {
      console.log(`Auth token: ${authToken}`);
      console.log(`Web UI:     http://${LOOPBACK_HOST}:${actualPort}/?token=${authToken}`);
    } else {
      console.log(`Web UI:     http://${LOOPBACK_HOST}:${actualPort}/`);
      console.log("Warning: auth disabled (--no-auth). Do not expose this server on a shared network.");
    }
    console.log("API endpoints:");
    console.log("  POST /api/chat           — Send message (SSE streaming)");
    console.log("  POST /api/sessions       — Create a new session");
    console.log("  GET  /api/sessions       — List active sessions");
    console.log("  DELETE /api/sessions/:id — Close a session");
    console.log("  GET  /api/daemon/status  — Daemon health and server status");
    console.log("  GET  /api/health         — Health check");
  });

  return server;
}
