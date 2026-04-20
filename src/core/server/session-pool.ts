/**
 * Session pool and SSE transport — shared HTTP infrastructure.
 *
 * Extracted from server.ts for module boundary clarity.
 * SessionPool manages AgentSession lifecycles for HTTP/SSE clients.
 * SseTransport bridges AgentEvents to Server-Sent Events.
 */

import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { ChannelSession } from "#core/channels/channel.js";
import type { AgentSession } from "#core/loop/loop.js";
import { type AgentEvent, ProxyTransport, type Transport } from "#core/loop/transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";

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

/** HTTP server session — extends ChannelSession with pool-management fields. */
export type ManagedSession = ChannelSession & {
  id: string;
  busy: boolean;
  /** ISO-8601 timestamp captured when the session was created. */
  createdAt: string;
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
    const now = Date.now();
    const session: ManagedSession = {
      id,
      agent,
      proxy,
      busy: false,
      lastActive: now,
      createdAt: new Date(now).toISOString(),
    };
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

  list(): Array<{ id: string; busy: boolean; lastActive: number; createdAt: string; autonomyMode: AutonomyMode }> {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      busy: s.busy,
      lastActive: s.lastActive,
      createdAt: s.createdAt,
      autonomyMode: s.agent.getAutonomyMode(),
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

/** Standard CORS headers for HTTP endpoints. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function setCors(res: ServerResponse): void {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
}

export function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function readBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
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
