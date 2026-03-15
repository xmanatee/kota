/**
 * HTTP API server — makes KOTA accessible via HTTP with SSE streaming.
 *
 * Enables web UIs, bots, and automation to interact with KOTA
 * without going through the CLI. Uses the Transport layer (iter 363)
 * for real, exercising it beyond CliTransport for the first time.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ActionExecutor, type ActionResult, partitionDueItems } from "./action-executor.js";
import type { KotaConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { getHistory } from "./history.js";
import { AgentSession, type LoopOptions } from "./loop.js";
import { getScheduler, initScheduler, resetScheduler } from "./scheduler.js";
import {
  CORS_HEADERS,
  jsonResponse,
  type ManagedSession,
  readBody,
  SessionPool,
  SseTransport,
  setCors,
} from "./session-pool.js";
import { NullTransport, type Transport } from "./transport.js";
import { DATA_STREAM_HEADERS, DataStreamTransport, extractLastUserMessage } from "./vercel-ai-stream.js";
import { getWebUI } from "./web-ui.js";

// Re-export for backwards compatibility with tests
export { type ManagedSession, SessionPool, SseTransport } from "./session-pool.js";

export type ServerOptions = {
  port?: number;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
};

export function startServer(options: ServerOptions = {}): Server {
  const port = options.port ?? 3000;
  const config = options.config ?? loadConfig();
  const pool = new SessionPool();

  initScheduler(process.cwd());
  const scheduler = getScheduler();

  const notificationClients = new Set<SseTransport>();

  const actionExecutor = new ActionExecutor({
    sessionOptions: {
      model: options.model ?? config.model,
      verbose: options.verbose ?? config.verbose,
      config,
    },
  });

  function broadcastNotification(data: Record<string, unknown>): void {
    for (const client of notificationClients) {
      if (client.isClosed) {
        notificationClients.delete(client);
        continue;
      }
      client.send("notification", data);
    }
  }

  function broadcastActionResult(result: ActionResult): void {
    broadcastNotification({
      type: "action_result",
      id: result.item.id,
      description: result.item.description,
      action: result.item.action,
      result: result.result,
      error: result.error || null,
      durationMs: result.durationMs,
    });
  }

  const stopScheduler = scheduler.startTimer(30_000, (dueItems) => {
    const { actions, notifications } = partitionDueItems(dueItems);

    for (const item of notifications) {
      broadcastNotification({
        type: "reminder",
        id: item.id,
        description: item.description,
        scheduledFor: item.triggerAt,
        repeat: item.repeatLabel || null,
      });
    }

    for (const item of actions) {
      if (!actionExecutor.canExecute()) {
        broadcastNotification({
          type: "action_skipped",
          id: item.id,
          description: item.description,
          reason: "Too many concurrent actions",
        });
        continue;
      }

      broadcastNotification({
        type: "action_started",
        id: item.id,
        description: item.description,
        action: item.action,
      });

      actionExecutor.execute(item).then(broadcastActionResult).catch(() => {});
    }
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

  async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch (err) {
      jsonResponse(res, 400, { error: (err as Error).message });
      return;
    }

    const isVercelFormat = Array.isArray(body.messages);
    const message = isVercelFormat
      ? extractLastUserMessage(body.messages as Array<{ role: string; content: string }>)
      : (body.message as string | undefined);

    if (!message || typeof message !== "string") {
      jsonResponse(res, 400, { error: isVercelFormat ? "No valid user message found in messages array" : "message must be a non-empty string" });
      return;
    }

    let session: ManagedSession;
    const sessionId = body.session_id as string | undefined;
    if (sessionId) {
      const existing = pool.get(sessionId);
      if (!existing) {
        jsonResponse(res, 404, { error: "Session not found" });
        return;
      }
      session = existing;
    } else {
      try {
        session = pool.create(makeAgent);
      } catch (err) {
        jsonResponse(res, 503, { error: (err as Error).message });
        return;
      }
    }

    if (session.busy) {
      jsonResponse(res, 409, { error: "Session is busy processing another request" });
      return;
    }
    session.busy = true;

    if (isVercelFormat) {
      await handleVercelChat(res, session, message);
    } else {
      await handleKotaChat(res, session, message);
    }
  }

  async function handleKotaChat(res: ServerResponse, session: ManagedSession, message: string): Promise<void> {
    setCors(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sse = new SseTransport(res);
    session.proxy.target = sse;
    sse.send("session", { session_id: session.id });

    try {
      const result = await session.agent.send(message);
      sse.send("done", { session_id: session.id, result });
    } catch (err) {
      sse.send("error", { message: (err as Error).message });
    } finally {
      session.proxy.target = new NullTransport();
      session.busy = false;
      session.lastActive = Date.now();
      sse.end();
    }
  }

  async function handleVercelChat(res: ServerResponse, session: ManagedSession, message: string): Promise<void> {
    setCors(res);
    const headers = { ...DATA_STREAM_HEADERS, ...CORS_HEADERS };
    res.writeHead(200, headers);

    const stream = new DataStreamTransport(res);
    session.proxy.target = stream;

    try {
      await session.agent.send(message);
      stream.finish();
    } catch (err) {
      stream.emit({ type: "error", message: (err as Error).message });
      stream.finish();
    } finally {
      session.proxy.target = new NullTransport();
      session.busy = false;
      session.lastActive = Date.now();
    }
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    setCors(res);
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/api/health") {
      jsonResponse(res, 200, {
        status: "ok",
        sessions: pool.size,
        activeActions: actionExecutor.activeCount,
        pendingSchedules: scheduler.count(),
      });
      return;
    }

    if (req.method === "GET" && path === "/api/sessions") {
      jsonResponse(res, 200, { sessions: pool.list() });
      return;
    }

    if (req.method === "POST" && path === "/api/sessions") {
      try {
        const session = pool.create(makeAgent);
        jsonResponse(res, 201, { session_id: session.id });
      } catch (err) {
        jsonResponse(res, 503, { error: (err as Error).message });
      }
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      handleChat(req, res).catch((err) => {
        if (!res.headersSent) {
          jsonResponse(res, 500, { error: (err as Error).message });
        }
      });
      return;
    }

    if (req.method === "GET" && path === "/api/schedules") {
      jsonResponse(res, 200, { schedules: scheduler.pending() });
      return;
    }

    if (req.method === "GET" && path === "/api/notifications") {
      setCors(res);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const sse = new SseTransport(res);
      notificationClients.add(sse);
      const overdue = scheduler.getDue();
      for (const item of overdue) {
        scheduler.markFired(item.id);
        sse.send("notification", {
          type: "reminder",
          id: item.id,
          description: item.description,
          scheduledFor: item.triggerAt,
          repeat: item.repeatLabel || null,
        });
      }
      sse.send("connected", { message: "Listening for notifications" });
      res.on("close", () => notificationClients.delete(sse));
      return;
    }

    const deleteMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const deleted = pool.delete(deleteMatch[1]);
      if (deleted) {
        res.writeHead(204);
        res.end();
      } else {
        jsonResponse(res, 404, { error: "Session not found" });
      }
      return;
    }

    if (req.method === "GET" && path === "/api/history") {
      const history = getHistory();
      const search = url.searchParams.get("search") || undefined;
      const limit = url.searchParams.has("limit") ? Number.parseInt(url.searchParams.get("limit")!, 10) : 20;
      jsonResponse(res, 200, { conversations: history.list({ search, limit }) });
      return;
    }

    const historyMatch = path.match(/^\/api\/history\/([^/]+)$/);
    if (req.method === "GET" && historyMatch) {
      const history = getHistory();
      const data = history.load(historyMatch[1]);
      if (data) {
        jsonResponse(res, 200, data);
      } else {
        jsonResponse(res, 404, { error: "Conversation not found" });
      }
      return;
    }

    if (req.method === "DELETE" && historyMatch) {
      const history = getHistory();
      if (history.remove(historyMatch[1])) {
        res.writeHead(204);
        res.end();
      } else {
        jsonResponse(res, 404, { error: "Conversation not found" });
      }
      return;
    }

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      setCors(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getWebUI());
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  }

  const server = createServer(handleRequest);

  server.on("close", () => {
    clearInterval(cleanupTimer);
    stopScheduler();
    resetScheduler();
    for (const client of notificationClients) client.end();
    notificationClients.clear();
    pool.closeAll();
  });

  server.listen(port, () => {
    console.log(`KOTA server listening on http://localhost:${port}`);
    console.log(`Web UI: http://localhost:${port}/`);
    console.log("API endpoints:");
    console.log("  POST /api/chat           — Send message (SSE or Vercel AI SDK Data Stream)");
    console.log("  POST /api/sessions       — Create a new session");
    console.log("  GET  /api/sessions       — List active sessions");
    console.log("  DELETE /api/sessions/:id — Close a session");
    console.log("  GET  /api/schedules      — List pending scheduled items");
    console.log("  GET  /api/notifications  — SSE stream for due reminders");
    console.log("  GET  /api/history        — List conversation history");
    console.log("  GET  /api/history/:id    — Get conversation details");
    console.log("  DELETE /api/history/:id  — Delete a conversation");
    console.log("  GET  /api/health         — Health check");
  });

  return server;
}
