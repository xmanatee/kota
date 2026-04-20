/**
 * Persisted session_id → conversationId binding for daemon-owned chat
 * sessions. The mapping survives a daemon restart so clients that hold
 * a session_id can wake onto the same persisted conversation without
 * an opaque 404.
 *
 * File layout under <stateDir>/daemon-chat-bindings.json:
 *
 *   { "bindings": [
 *       { "sessionId": "...", "conversationId": "...",
 *         "createdAt": "...", "lastActiveAt": "..." }
 *     ]
 *   }
 *
 * The file is rewritten atomically on every mutation. A JSON array is
 * fine for the expected bound (pool size is single-digit per daemon).
 */

import { join } from "node:path";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";

export type DaemonChatBinding = {
  sessionId: string;
  conversationId: string;
  createdAt: string;
  lastActiveAt: string;
};

type BindingFile = {
  bindings: DaemonChatBinding[];
};

const BINDING_FILE = "daemon-chat-bindings.json";

export class DaemonChatBindingStore {
  private readonly path: string;
  private bindings: Map<string, DaemonChatBinding>;
  private byConversation: Map<string, DaemonChatBinding>;

  constructor(stateDir: string) {
    this.path = join(stateDir, BINDING_FILE);
    this.bindings = new Map();
    this.byConversation = new Map();
    this.load();
  }

  private load(): void {
    const raw = readOptionalJsonFile<BindingFile>(this.path);
    if (!raw || !Array.isArray(raw.bindings)) return;
    for (const b of raw.bindings) {
      if (!b || typeof b.sessionId !== "string" || typeof b.conversationId !== "string") continue;
      const normalized: DaemonChatBinding = {
        sessionId: b.sessionId,
        conversationId: b.conversationId,
        createdAt: b.createdAt ?? new Date().toISOString(),
        lastActiveAt: b.lastActiveAt ?? b.createdAt ?? new Date().toISOString(),
      };
      this.bindings.set(normalized.sessionId, normalized);
      this.byConversation.set(normalized.conversationId, normalized);
    }
  }

  private persist(): void {
    const file: BindingFile = { bindings: [...this.bindings.values()] };
    writeJsonFileAtomic(this.path, file);
  }

  getBySession(sessionId: string): DaemonChatBinding | undefined {
    return this.bindings.get(sessionId);
  }

  getByConversation(conversationId: string): DaemonChatBinding | undefined {
    return this.byConversation.get(conversationId);
  }

  put(sessionId: string, conversationId: string): DaemonChatBinding {
    const existing = this.bindings.get(sessionId);
    const now = new Date().toISOString();
    if (existing) {
      if (existing.conversationId !== conversationId) {
        throw new Error(
          `Binding mismatch for session ${sessionId}: already bound to ${existing.conversationId}, cannot rebind to ${conversationId}`,
        );
      }
      existing.lastActiveAt = now;
      this.persist();
      return existing;
    }
    const binding: DaemonChatBinding = {
      sessionId,
      conversationId,
      createdAt: now,
      lastActiveAt: now,
    };
    this.bindings.set(sessionId, binding);
    this.byConversation.set(conversationId, binding);
    this.persist();
    return binding;
  }

  touch(sessionId: string): void {
    const existing = this.bindings.get(sessionId);
    if (!existing) return;
    existing.lastActiveAt = new Date().toISOString();
    this.persist();
  }

  delete(sessionId: string): boolean {
    const existing = this.bindings.get(sessionId);
    if (!existing) return false;
    this.bindings.delete(sessionId);
    this.byConversation.delete(existing.conversationId);
    this.persist();
    return true;
  }

  list(): DaemonChatBinding[] {
    return [...this.bindings.values()];
  }

  size(): number {
    return this.bindings.size;
  }
}
