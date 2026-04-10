/**
 * Daemon-owned interactive chat sessions.
 *
 * Provides POST /sessions, POST /sessions/:id/chat, and augments the session
 * list returned by GET /sessions with daemon-owned entries (source: "daemon").
 *
 * Deliberately avoids importing from src/server/ to prevent circular deps
 * (server/daemon-client.ts → scheduler/daemon-control.ts).
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentSession } from "../loop.js";
import { NullTransport, ProxyTransport, type Transport } from "../transport.js";
import { jsonResponse } from "./daemon-control-utils.js";

/** An agent session owned by the daemon control server. */
type DaemonChatSession = {
  id: string;
  createdAt: string;
  agent: AgentSession;
  proxy: ProxyTransport;
  busy: boolean;
  lastActive: number;
};

const DEFAULT_MAX_SESSIONS = 10;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type DaemonChatPoolOptions = {
  maxSessions?: number;
  ttlMs?: number;
};

/** Manages daemon-owned AgentSession instances with idle TTL eviction. */
export class DaemonChatPool {
  private sessions = new Map<string, DaemonChatSession>();
  private readonly maxSessions: number;
  private readonly ttlMs: number;

  constructor(opts: DaemonChatPoolOptions = {}) {
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  create(makeAgent: (transport: Transport) => AgentSession): DaemonChatSession {
    if (this.sessions.size >= this.maxSessions) {
      const evicted = this.evictOldest();
      if (!evicted) throw new Error("Too many active sessions");
    }
    const id = randomUUID().slice(0, 8);
    const proxy = new ProxyTransport();
    const agent = makeAgent(proxy);
    const now = new Date().toISOString();
    const session: DaemonChatSession = { id, createdAt: now, agent, proxy, busy: false, lastActive: Date.now() };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): DaemonChatSession | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.agent.close();
    this.sessions.delete(id);
    return true;
  }

  list(): Array<{ id: string; createdAt: string; busy: boolean; lastActive: number; source: "daemon" }> {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      busy: s.busy,
      lastActive: s.lastActive,
      source: "daemon" as const,
    }));
  }

  /** Evict sessions idle longer than TTL. Returns count removed. */
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
    let oldest: DaemonChatSession | null = null;
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

/** Read the HTTP request body as a parsed JSON object (max 1MB). */
export function readChatBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 1024 * 1024;
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
        resolve(text ? (JSON.parse(text) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Write a single SSE frame to the response. */
function writeSse(res: ServerResponse, eventName: string, data: unknown): void {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** POST /sessions — create a new daemon-owned session. */
export function handleCreateDaemonSession(
  pool: DaemonChatPool,
  res: ServerResponse,
  makeAgent: (transport: Transport) => AgentSession,
): void {
  try {
    const session = pool.create(makeAgent);
    jsonResponse(res, 201, { session_id: session.id });
  } catch (err) {
    jsonResponse(res, 503, { error: (err as Error).message });
  }
}

/** POST /sessions/:id/chat — stream an agent response via SSE. */
export async function handleDaemonChat(
  pool: DaemonChatPool,
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
): Promise<void> {
  const session = pool.get(sessionId);
  if (!session) {
    jsonResponse(res, 404, { error: "Session not found" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readChatBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const message = body.message as string | undefined;
  if (!message || typeof message !== "string") {
    jsonResponse(res, 400, { error: "message must be a non-empty string" });
    return;
  }

  if (session.busy) {
    jsonResponse(res, 409, { error: "Session is busy processing another request" });
    return;
  }
  session.busy = true;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sseTransport = {
    emit(event: import("../transport.js").AgentEvent) {
      if (res.writableEnded) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
  };

  session.proxy.target = sseTransport;
  writeSse(res, "session", { session_id: session.id });

  try {
    const result = await session.agent.send(message);
    writeSse(res, "done", { session_id: session.id, result });
  } catch (err) {
    writeSse(res, "error", { message: (err as Error).message });
  } finally {
    session.proxy.target = new NullTransport();
    session.busy = false;
    session.lastActive = Date.now();
    if (!res.writableEnded) res.end();
  }
}

/** DELETE /sessions/:id — close a daemon-owned session. Returns true if found. */
export function deleteDaemonSession(pool: DaemonChatPool, id: string): boolean {
  return pool.delete(id);
}
