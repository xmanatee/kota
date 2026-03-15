/**
 * HTTP API server — makes KOTA accessible via HTTP with SSE streaming.
 *
 * Enables web UIs, bots, and automation to interact with KOTA
 * without going through the CLI. Uses the Transport layer (iter 363)
 * for real, exercising it beyond CliTransport for the first time.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { AgentSession, type LoopOptions } from "./loop.js";
import { loadConfig, type KotaConfig } from "./config.js";
import { NullTransport, type Transport, type AgentEvent } from "./transport.js";
import { initScheduler, getScheduler, type ScheduledItem } from "./scheduler.js";

// --- SSE Transport ---

/** Transport that writes AgentEvents as Server-Sent Events to an HTTP response. */
export class SseTransport implements Transport {
  private closed = false;

  constructor(private res: ServerResponse) {
    res.on("close", () => { this.closed = true; });
  }

  emit(event: AgentEvent): void {
    if (this.closed) return;
    this.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  /** Send a custom named event (session, done). */
  send(eventName: string, data: Record<string, unknown>): void {
    if (this.closed) return;
    this.res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

// --- Proxy Transport ---

/** Mutable transport proxy — lets one AgentSession stream to different sinks per request. */
export class ProxyTransport implements Transport {
  constructor(public target: Transport = new NullTransport()) {}

  emit(event: AgentEvent): void {
    this.target.emit(event);
  }
}

// --- Session Pool ---

export type ManagedSession = {
  id: string;
  agent: AgentSession;
  proxy: ProxyTransport;
  busy: boolean;
  lastActive: number;
};

const DEFAULT_MAX_SESSIONS = 10;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type SessionPoolOptions = {
  maxSessions?: number;
  ttlMs?: number;
};

export class SessionPool {
  private sessions = new Map<string, ManagedSession>();
  private maxSessions: number;
  private ttlMs: number;

  constructor(opts: SessionPoolOptions = {}) {
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Create a new session. Evicts oldest idle session if at capacity. */
  create(agentFactory: (transport: Transport) => AgentSession): ManagedSession {
    if (this.sessions.size >= this.maxSessions) {
      const evicted = this.evictOldest();
      if (!evicted) throw new Error("Too many active sessions");
    }

    const id = randomUUID().slice(0, 8);
    const proxy = new ProxyTransport();
    const agent = agentFactory(proxy);
    const session: ManagedSession = { id, agent, proxy, busy: false, lastActive: Date.now() };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.agent.close();
    this.sessions.delete(id);
    return true;
  }

  list(): Array<{ id: string; busy: boolean; lastActive: number }> {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      busy: s.busy,
      lastActive: s.lastActive,
    }));
  }

  /** Remove sessions idle longer than TTL. Returns count evicted. */
  cleanup(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (!session.busy && now - session.lastActive > this.ttlMs) {
        session.agent.close();
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.agent.close();
    }
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }

  private evictOldest(): boolean {
    let oldest: ManagedSession | null = null;
    for (const s of this.sessions.values()) {
      if (!s.busy && (!oldest || s.lastActive < oldest.lastActive)) {
        oldest = s;
      }
    }
    if (!oldest) return false;
    oldest.agent.close();
    this.sessions.delete(oldest.id);
    return true;
  }
}

// --- HTTP helpers ---

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function setCors(res: ServerResponse): void {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 1024 * 1024; // 1MB
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// --- Server ---

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

  // Initialize scheduler for the current project
  initScheduler(process.cwd());
  const scheduler = getScheduler();

  // Track SSE clients listening for notifications
  const notificationClients = new Set<SseTransport>();

  const stopScheduler = scheduler.startTimer(30_000, (dueItems) => {
    for (const client of notificationClients) {
      if (client.isClosed) {
        notificationClients.delete(client);
        continue;
      }
      for (const item of dueItems) {
        client.send("notification", {
          type: "reminder",
          id: item.id,
          description: item.description,
          scheduledFor: item.triggerAt,
          repeat: item.repeatLabel || null,
        });
      }
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
      json(res, 400, { error: (err as Error).message });
      return;
    }

    const message = body.message as string | undefined;
    if (!message) {
      json(res, 400, { error: "message is required" });
      return;
    }

    let session: ManagedSession;
    const sessionId = body.session_id as string | undefined;
    if (sessionId) {
      const existing = pool.get(sessionId);
      if (!existing) {
        json(res, 404, { error: "Session not found" });
        return;
      }
      session = existing;
    } else {
      try {
        session = pool.create(makeAgent);
      } catch (err) {
        json(res, 503, { error: (err as Error).message });
        return;
      }
    }

    if (session.busy) {
      json(res, 409, { error: "Session is busy processing another request" });
      return;
    }
    session.busy = true;

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
      json(res, 200, { status: "ok", sessions: pool.size });
      return;
    }

    if (req.method === "GET" && path === "/api/sessions") {
      json(res, 200, { sessions: pool.list() });
      return;
    }

    if (req.method === "POST" && path === "/api/sessions") {
      try {
        const session = pool.create(makeAgent);
        json(res, 201, { session_id: session.id });
      } catch (err) {
        json(res, 503, { error: (err as Error).message });
      }
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      handleChat(req, res).catch((err) => {
        if (!res.headersSent) {
          json(res, 500, { error: (err as Error).message });
        }
      });
      return;
    }

    // Scheduler endpoints
    if (req.method === "GET" && path === "/api/schedules") {
      json(res, 200, { schedules: scheduler.pending() });
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
      // Send any currently overdue items immediately
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
        json(res, 404, { error: "Session not found" });
      }
      return;
    }

    json(res, 404, { error: "Not found" });
  }

  const server = createServer(handleRequest);

  server.on("close", () => {
    clearInterval(cleanupTimer);
    stopScheduler();
    for (const client of notificationClients) client.end();
    notificationClients.clear();
    pool.closeAll();
  });

  server.listen(port, () => {
    console.log(`KOTA server listening on http://localhost:${port}`);
    console.log("Endpoints:");
    console.log("  POST /api/chat           — Send message, get SSE stream");
    console.log("  POST /api/sessions       — Create a new session");
    console.log("  GET  /api/sessions       — List active sessions");
    console.log("  DELETE /api/sessions/:id — Close a session");
    console.log("  GET  /api/schedules      — List pending scheduled items");
    console.log("  GET  /api/notifications  — SSE stream for due reminders");
    console.log("  GET  /api/health         — Health check");
  });

  return server;
}
