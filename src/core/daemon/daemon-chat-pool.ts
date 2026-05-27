/**
 * Daemon-owned chat session pool.
 *
 * Owns the lifecycle of `AgentSession` instances created on behalf of remote
 * clients, with idle-TTL eviction and a soft cap on concurrent sessions. The
 * pool is the durable runtime contract; HTTP protocol shape lives in the
 * sibling `daemon-chat-handlers.ts` module.
 */

import { randomUUID } from "node:crypto";
import type { AgentSession } from "#core/loop/loop.js";
import { ProxyTransport, type Transport } from "#core/loop/transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { GuardrailsConfig, GuardrailsSnapshot } from "#core/tools/guardrails.js";
import type { ProjectId } from "./project-registry.js";

/** Factory signature for building an AgentSession inside the daemon. */
export type DaemonChatMakeAgent = (
  transport: Transport,
  mode: AutonomyMode,
  resumeConversation: string | undefined,
  projectId: ProjectId,
) => AgentSession;

/** An agent session owned by the daemon control server. */
export type DaemonChatSession = {
  id: string;
  createdAt: string;
  projectId: ProjectId;
  conversationId: string;
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
  guardrailsSnapshot: GuardrailsSnapshot;
  projectId: ProjectId;
  conversationId: string;
  source: "daemon";
};

export type DaemonChatGuardrailsRefreshSummary = {
  refreshed: number;
  unchanged: number;
};

const DEFAULT_MAX_SESSIONS = 10;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type DaemonChatPoolOptions = {
  maxSessions?: number;
  ttlMs?: number;
};

export type DaemonChatCreateOptions = {
  projectId: ProjectId;
  sessionId?: string;
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

  /**
   * Create or wake a daemon-owned session.
   *
   * When `sessionId` is provided the caller is asking the pool to adopt that
   * id (wake after a binding lookup). The pool rejects the call if that id
   * is already live. When absent, a fresh id is generated. `projectId` is
   * required so the daemon agent factory can bind the session to the selected
   * project runtime instead of falling back to process cwd.
   */
  create(
    makeAgent: DaemonChatMakeAgent,
    mode: AutonomyMode,
    conversationId: string,
    options: DaemonChatCreateOptions,
  ): DaemonChatSession {
    const { projectId, sessionId } = options;
    if (sessionId && this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already live`);
    }
    if (this.sessions.size >= this.maxSessions) {
      const evicted = this.evictOldest();
      if (!evicted) throw new Error("Too many active sessions");
    }
    const id = sessionId ?? randomUUID().slice(0, 8);
    const proxy = new ProxyTransport();
    const agent = makeAgent(proxy, mode, conversationId, projectId);
    const now = new Date().toISOString();
    const session: DaemonChatSession = {
      id,
      createdAt: now,
      projectId,
      conversationId,
      agent,
      proxy,
      busy: false,
      lastActive: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): DaemonChatSession | undefined {
    return this.sessions.get(id);
  }

  cancelActiveTurn(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.agent.cancelActiveTurn();
    session.lastActive = Date.now();
    return true;
  }

  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.agent.close();
    this.sessions.delete(id);
    return true;
  }

  list(projectId?: ProjectId): DaemonChatListEntry[] {
    return [...this.sessions.values()]
      .filter((s) => projectId === undefined || s.projectId === projectId)
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        busy: s.busy,
        lastActive: s.lastActive,
        autonomyMode: s.agent.getAutonomyMode(),
        guardrailsSnapshot: s.agent.getGuardrailsSnapshot(),
        projectId: s.projectId,
        conversationId: s.conversationId,
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

  refreshGuardrails(config: GuardrailsConfig): DaemonChatGuardrailsRefreshSummary {
    let refreshed = 0;
    let unchanged = 0;
    for (const session of this.sessions.values()) {
      const result = session.agent.replaceGuardrailsConfig(config);
      if (result.changed) {
        refreshed++;
      } else {
        unchanged++;
      }
    }
    return { refreshed, unchanged };
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
