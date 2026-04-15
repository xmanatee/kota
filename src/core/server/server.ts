/**
 * HTTP API server — makes KOTA accessible via HTTP with SSE streaming.
 *
 * Enables web UIs, bots, and automation to interact with KOTA
 * without going through the CLI. Uses the Transport layer (iter 363)
 * for real, exercising it beyond CliTransport for the first time.
 */

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { KotaConfig } from "#core/config/config.js";
import { loadConfig } from "#core/config/config.js";
import { getScheduler, initScheduler, resetScheduler } from "#core/daemon/scheduler.js";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import { initModuleLogStore } from "#core/modules/module-log.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { DaemonControlClient } from "./daemon-client.js";
import { NotificationHub } from "./server-notifications.js";
import { buildRequestHandler } from "./server-routes.js";
import { SessionPool } from "./session-pool.js";

export type ServerOptions = {
  port?: number;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  noAuth?: boolean;
  /**
   * Override the generated auth token. Useful in tests to use a known value.
   * Has no effect when noAuth is true.
   */
  authToken?: string;
  /** Routes registered by modules (e.g., vercel-adapter). */
  moduleRoutes?: RouteRegistration[];
  /** Directory containing the built web UI static assets (index.html + assets/). */
  webUiDir?: string;
};

export function startServer(options: ServerOptions = {}): Server {
  const port = options.port ?? 3000;
  const config = options.config ?? loadConfig();
  const pool = new SessionPool();

  const noAuth = options.noAuth ?? config.serve?.noAuth ?? false;
  const authToken = noAuth ? undefined : (options.authToken ?? randomBytes(32).toString("hex"));

  const daemonClient = DaemonControlClient.fromStateDir();
  const daemonRunning = daemonClient !== null;

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

  const hub = new NotificationHub();

  let stopBusConnection = (): void => {};
  let stopScheduler = (): void => {};
  if (!daemonRunning) {
    stopBusConnection = scheduler.connectBus(bus, (dueItems) => {
      hub.handleDueItems(dueItems);
    });
    stopScheduler = scheduler.startTimer(30_000, (dueItems) => {
      hub.handleDueItems(dueItems);
    });
  }

  const cleanupTimer = setInterval(() => pool.cleanup(), 5 * 60 * 1000);
  cleanupTimer.unref();

  function makeAgent(transport: Transport): AgentSession {
    const loopOpts: LoopOptions = {
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
    hub,
    bus,
    moduleRoutes: options.moduleRoutes ?? [],
    makeAgent,
    daemonClient,
    webUiDir: options.webUiDir,
    authToken,
  });

  const server = createServer(handleRequest);

  server.on("close", () => {
    clearInterval(cleanupTimer);
    stopBusConnection();
    stopScheduler();
    resetScheduler();
    resetEventBus();
    pool.closeAll();
  });

  server.listen(port, () => {
    console.log(`KOTA server listening on http://localhost:${port}`);
    if (authToken) {
      console.log(`Auth token: ${authToken}`);
      console.log(`Web UI:     http://localhost:${port}/?token=${authToken}`);
    } else {
      console.log(`Web UI:     http://localhost:${port}/`);
      console.log("Warning: auth disabled (--no-auth). Do not expose this server on a shared network.");
    }
    console.log("API endpoints:");
    console.log("  POST /api/chat           — Send message (SSE streaming)");
    console.log("  POST /api/chat/vercel    — Vercel AI SDK Data Stream Protocol");
    console.log("  POST /api/sessions       — Create a new session");
    console.log("  GET  /api/sessions       — List active sessions");
    console.log("  DELETE /api/sessions/:id — Close a session");
    console.log("  GET  /api/schedules      — List pending scheduled items");
    console.log("  GET  /api/notifications  — SSE stream for due reminders");
    console.log("  GET  /api/history        — List conversation history");
    console.log("  GET  /api/history/:id    — Get conversation details");
    console.log("  DELETE /api/history/:id  — Delete a conversation");
    console.log("  POST /api/events/:name   — Fire a custom event (webhook trigger)");
    console.log("  GET  /api/daemon/status  — Daemon health and server status");
    console.log("  GET  /api/health         — Health check");
  });

  return server;
}
