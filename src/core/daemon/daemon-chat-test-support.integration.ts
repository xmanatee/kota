import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Mock, vi } from "vitest";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import { DaemonChatPool } from "./daemon-chat-pool.js";
import type { DaemonChatConversationResolver } from "./daemon-chat-session-create.js";

export const CONV_ID = "c-fixture-0000";
export const SCOPE_ID = "test-scope-id";

export function makeBindingStore(): DaemonChatBindingStore {
  const dir = mkdtempSync(join(tmpdir(), "kota-chat-bindings-"));
  return new DaemonChatBindingStore(dir);
}

export function makeResolver(
  conversations: Set<string> = new Set([CONV_ID]),
): DaemonChatConversationResolver {
  let counter = 0;
  return {
    conversationExists: (id: string) => conversations.has(id),
    createConversation: () => {
      const id = `conv-${++counter}`;
      conversations.add(id);
      return id;
    },
  };
}

export function mockResponse(): EventEmitter & {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  writeHead: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  writableEnded: boolean;
  headersSent: boolean;
  _written: string[];
} {
  const res = new EventEmitter() as ReturnType<typeof mockResponse>;
  res._written = [];
  res.writableEnded = false;
  res.headersSent = false;
  res.write = vi.fn((data: string) => {
    res._written.push(data);
    return true;
  });
  res.end = vi.fn((data?: string) => {
    if (data) res._written.push(data);
    res.writableEnded = true;
  });
  res.writeHead = vi.fn(() => {
    res.headersSent = true;
  });
  res.setHeader = vi.fn();
  return res;
}

export function mockRequest(body?: string): EventEmitter {
  const req = new EventEmitter();
  if (body !== undefined) {
    queueMicrotask(() => {
      req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  }
  return req;
}

export function mockAgentSession(
  sendResult?: unknown,
  mode: "passive" | "supervised" | "autonomous" = "supervised",
): {
  send: Mock<(message?: string) => Promise<unknown>>;
  cancelActiveTurn: Mock;
  close: Mock;
  getAutonomyMode: Mock<() => "passive" | "supervised" | "autonomous">;
  setAutonomyMode: Mock<(next: "passive" | "supervised" | "autonomous") => void>;
} {
  let current = mode;
  return {
    send: vi.fn(async () => sendResult ?? { status: "ok" }),
    cancelActiveTurn: vi.fn(),
    close: vi.fn(),
    getAutonomyMode: vi.fn(() => current),
    setAutonomyMode: vi.fn((next: "passive" | "supervised" | "autonomous") => {
      current = next;
    }),
  };
}

export function makePool(opts?: { maxSessions?: number; ttlMs?: number }) {
  return new DaemonChatPool(opts);
}
