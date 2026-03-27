/**
 * HTTP API server — makes KOTA accessible via HTTP with SSE streaming.
 *
 * Enables web UIs, bots, and automation to interact with KOTA
 * without going through the CLI. Uses the Transport layer (iter 363)
 * for real, exercising it beyond CliTransport for the first time.
 */

import { createServer, type Server } from "node:http";
import type { KotaConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { initEventBus, resetEventBus } from "../event-bus.js";
import { initExtensionLogStore } from "../extension-log.js";
import type { RouteRegistration } from "../extension-types.js";
import { AgentSession, type LoopOptions } from "../loop.js";
import { getScheduler, initScheduler, resetScheduler } from "../scheduler/scheduler.js";
import type { Transport } from "../transport.js";
import { NotificationHub } from "./server-notifications.js";
import { buildRequestHandler } from "./server-routes.js";
import { SessionPool } from "./session-pool.js";

export type ServerOptions = {
  port?: number;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  /** Routes registered by modules (e.g., vercel-adapter). */
  moduleRoutes?: RouteRegistration[];
};

export function startServer(options: ServerOptions = {}): Server {
  const port = options.port ?? 3000;
  const config = options.config ?? loadConfig();
  const pool = new SessionPool();

  const bus = initEventBus();
  initScheduler(process.cwd());
  initExtensionLogStore(process.cwd());
  const scheduler = getScheduler();

  const hub = new NotificationHub();

  const stopBusConnection = scheduler.connectBus(bus, (dueItems) => {
    hub.handleDueItems(dueItems);
  });

  const stopScheduler = scheduler.startTimer(30_000, (dueItems) => {
    hub.handleDueItems(dueItems);
  });

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
    console.log(`Web UI: http://localhost:${port}/`);
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
