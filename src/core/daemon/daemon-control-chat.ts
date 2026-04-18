/**
 * Daemon-owned interactive chat sessions.
 *
 * Provides POST /sessions, POST /sessions/:id/chat, and augments the session
 * list returned by GET /sessions with daemon-owned entries (source: "daemon").
 *
 * Deliberately avoids importing from src/core/server/ to prevent circular deps
 * (server/daemon-client.ts → scheduler/daemon-control.ts).
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentSession } from "#core/loop/loop.js";
import { NullTransport, ProxyTransport, type Transport } from "#core/loop/transport.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
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

export type DaemonChatListEntry = {
  id: string;
  createdAt: string;
  busy: boolean;
  lastActive: number;
  autonomyMode: AutonomyMode;
  source: "daemon";
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

  create(makeAgent: (transport: Transport, mode: AutonomyMode) => AgentSession, mode: AutonomyMode): DaemonChatSession {
    if (this.sessions.size >= this.maxSessions) {
      const evicted = this.evictOldest();
      if (!evicted) throw new Error("Too many active sessions");
    }
    const id = randomUUID().slice(0, 8);
    const proxy = new ProxyTransport();
    const agent = makeAgent(proxy, mode);
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

  list(): DaemonChatListEntry[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      busy: s.busy,
      lastActive: s.lastActive,
      autonomyMode: s.agent.getAutonomyMode(),
      source: "daemon" as const,
    }));
  }

  /**
   * Change the autonomy mode of a daemon-owned session. Returns false when no
   * session with that id is owned by the pool, in which case callers should
   * fall through to the broader session registry (serve-registered rows).
   */
  setAutonomyMode(id: string, mode: AutonomyMode): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.agent.setAutonomyMode(mode);
    return true;
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
export async function handleCreateDaemonSession(
  pool: DaemonChatPool,
  req: IncomingMessage,
  res: ServerResponse,
  makeAgent: (transport: Transport, mode: AutonomyMode) => AgentSession,
  defaultAutonomyMode: AutonomyMode | undefined,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readChatBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const raw = body.autonomy_mode;
  let mode = defaultAutonomyMode;
  if (raw !== undefined) {
    if (!isAutonomyMode(raw)) {
      jsonResponse(res, 400, { error: "autonomy_mode must be one of: passive, supervised, autonomous" });
      return;
    }
    mode = raw;
  }
  if (mode === undefined) {
    jsonResponse(res, 400, { error: "autonomy_mode is required because no default autonomy mode is configured" });
    return;
  }

  try {
    const session = pool.create(makeAgent, mode);
    jsonResponse(res, 201, { session_id: session.id, autonomy_mode: mode });
  } catch (err) {
    jsonResponse(res, 503, { error: (err as Error).message });
  }
}

/**
 * PATCH /sessions/:id — change the autonomy mode of a running session.
 *
 * Daemon-owned sessions are mutated in place; serve-registered sessions only
 * have advisory metadata in the daemon, so we report serveOwned so the caller
 * knows to drive the authoritative update against the owning serve process.
 */
export async function handlePatchDaemonSession(
  pool: DaemonChatPool | null,
  setOnHandle: (id: string, mode: AutonomyMode) => { ok: boolean; notFound?: boolean; serveOwned?: boolean },
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readChatBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const raw = body.autonomy_mode;
  if (raw === undefined) {
    jsonResponse(res, 400, { error: "autonomy_mode is required" });
    return;
  }
  if (!isAutonomyMode(raw)) {
    jsonResponse(res, 400, { error: "autonomy_mode must be one of: passive, supervised, autonomous" });
    return;
  }
  const mode: AutonomyMode = raw;

  if (pool && pool.setAutonomyMode(sessionId, mode)) {
    const handleResult = setOnHandle(sessionId, mode);
    jsonResponse(res, 200, {
      session_id: sessionId,
      autonomy_mode: mode,
      source: "daemon",
      ...(handleResult.ok ? {} : { registryUpdated: false }),
    });
    return;
  }

  const handleResult = setOnHandle(sessionId, mode);
  if (handleResult.notFound) {
    jsonResponse(res, 404, { error: "Session not found" });
    return;
  }
  jsonResponse(res, 200, {
    session_id: sessionId,
    autonomy_mode: mode,
    source: "serve",
    serveOwned: handleResult.serveOwned === true,
  });
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
    emit(event: import("#core/loop/transport.js").AgentEvent) {
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
