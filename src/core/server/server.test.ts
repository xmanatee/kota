import type { ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "#core/loop/loop.js";
import { BufferTransport, ProxyTransport, type Transport } from "#core/loop/transport.js";
import { SessionPool, SseTransport } from "./session-pool.js";

// --- Mock helpers ---

function mockResponse(): { res: ServerResponse; chunks: string[]; ended: boolean; closeHandlers: Array<() => void> } {
  const chunks: string[] = [];
  const closeHandlers: Array<() => void> = [];
  const res = {
    write: (data: string) => { chunks.push(data); return true; },
    end: vi.fn(() => { /* noop */ }),
    on: (_event: string, handler: () => void) => {
      if (_event === "close") closeHandlers.push(handler);
      return res;
    },
  } as unknown as ServerResponse;
  return { res, chunks, ended: false, closeHandlers };
}

function mockAgent(): AgentSession {
  return {
    send: vi.fn(async () => "test response"),
    close: vi.fn(),
    getCostSummary: () => "$0.00",
  } as unknown as AgentSession;
}

// --- SseTransport ---

describe("SseTransport", () => {
  it("formats events as SSE", () => {
    const { res, chunks } = mockResponse();
    const transport = new SseTransport(res);

    transport.emit({ type: "text", content: "hello" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('event: text\ndata: {"type":"text","content":"hello"}\n\n');
  });

  it("formats different event types", () => {
    const { res, chunks } = mockResponse();
    const transport = new SseTransport(res);

    transport.emit({ type: "status", message: "[kota] Turn 1" });
    expect(chunks[0]).toContain("event: status");
    expect(chunks[0]).toContain('"message":"[kota] Turn 1"');

    transport.emit({ type: "cost", summary: "$0.01", budgetPercent: 42 });
    expect(chunks[1]).toContain("event: cost");
    expect(chunks[1]).toContain('"budgetPercent":42');

    transport.emit({ type: "error", message: "something failed" });
    expect(chunks[2]).toContain("event: error");
  });

  it("sends custom named events", () => {
    const { res, chunks } = mockResponse();
    const transport = new SseTransport(res);

    transport.send("session", { session_id: "abc" });
    expect(chunks[0]).toBe('event: session\ndata: {"session_id":"abc"}\n\n');

    transport.send("done", { session_id: "abc", result: "final" });
    expect(chunks[1]).toContain("event: done");
  });

  it("stops writing after close", () => {
    const { res, chunks, closeHandlers } = mockResponse();
    const transport = new SseTransport(res);

    transport.emit({ type: "text", content: "before" });
    expect(chunks).toHaveLength(1);

    // Simulate client disconnect
    closeHandlers.forEach((h) => h());

    transport.emit({ type: "text", content: "after" });
    expect(chunks).toHaveLength(1); // no new writes
  });

  it("end() closes the response", () => {
    const { res } = mockResponse();
    const transport = new SseTransport(res);
    expect(transport.isClosed).toBe(false);

    transport.end();
    expect(res.end).toHaveBeenCalled();
    expect(transport.isClosed).toBe(true);
  });

  it("end() is idempotent", () => {
    const { res } = mockResponse();
    const transport = new SseTransport(res);

    transport.end();
    transport.end();
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

// --- ProxyTransport ---

describe("ProxyTransport", () => {
  it("delegates to target", () => {
    const buffer = new BufferTransport();
    const proxy = new ProxyTransport(buffer);

    proxy.emit({ type: "text", content: "hello" });
    expect(buffer.getText()).toBe("hello");
  });

  it("defaults to NullTransport", () => {
    const proxy = new ProxyTransport();
    // Should not throw
    proxy.emit({ type: "text", content: "discarded" });
  });

  it("target can be swapped", () => {
    const buf1 = new BufferTransport();
    const buf2 = new BufferTransport();
    const proxy = new ProxyTransport(buf1);

    proxy.emit({ type: "text", content: "first" });
    proxy.target = buf2;
    proxy.emit({ type: "text", content: "second" });

    expect(buf1.getText()).toBe("first");
    expect(buf2.getText()).toBe("second");
  });
});

// --- SessionPool ---

describe("SessionPool", () => {
  let pool: SessionPool;

  beforeEach(() => {
    pool = new SessionPool({ maxSessions: 3, ttlMs: 1000 });
  });

  it("creates sessions", () => {
    const session = pool.create(() => mockAgent());
    expect(session.id).toHaveLength(8);
    expect(session.busy).toBe(false);
    expect(pool.size).toBe(1);
  });

  it("retrieves sessions by id", () => {
    const session = pool.create(() => mockAgent());
    expect(pool.get(session.id)).toBe(session);
    expect(pool.get("nonexistent")).toBeUndefined();
  });

  it("deletes sessions and calls close()", () => {
    const agent = mockAgent();
    const session = pool.create(() => agent);

    expect(pool.delete(session.id)).toBe(true);
    expect(agent.close).toHaveBeenCalled();
    expect(pool.size).toBe(0);
    expect(pool.delete(session.id)).toBe(false);
  });

  it("lists sessions", () => {
    pool.create(() => mockAgent());
    pool.create(() => mockAgent());

    const list = pool.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toHaveProperty("id");
    expect(list[0]).toHaveProperty("busy");
    expect(list[0]).toHaveProperty("lastActive");
  });

  it("evicts oldest idle session at capacity", () => {
    const agents = Array.from({ length: 3 }, () => mockAgent());
    const sessions = agents.map((a) => pool.create(() => a));

    // Pool is at capacity (3). Creating a 4th should evict the oldest.
    const fourth = pool.create(() => mockAgent());
    expect(pool.size).toBe(3);
    expect(pool.get(sessions[0].id)).toBeUndefined(); // first was evicted
    expect(agents[0].close).toHaveBeenCalled();
    expect(pool.get(fourth.id)).toBeDefined();
  });

  it("does not evict busy sessions", () => {
    const agents = Array.from({ length: 3 }, () => mockAgent());
    const sessions = agents.map((a) => pool.create(() => a));

    // Mark all as busy
    sessions.forEach((s) => { s.busy = true; });

    expect(() => pool.create(() => mockAgent())).toThrow("Too many active sessions");
    expect(pool.size).toBe(3);
  });

  it("cleanup removes expired idle sessions", () => {
    const agent = mockAgent();
    const session = pool.create(() => agent);

    // Backdate the session
    session.lastActive = Date.now() - 2000;

    const evicted = pool.cleanup();
    expect(evicted).toBe(1);
    expect(pool.size).toBe(0);
    expect(agent.close).toHaveBeenCalled();
  });

  it("cleanup skips busy sessions", () => {
    const session = pool.create(() => mockAgent());
    session.lastActive = Date.now() - 2000;
    session.busy = true;

    const evicted = pool.cleanup();
    expect(evicted).toBe(0);
    expect(pool.size).toBe(1);
  });

  it("closeAll closes everything", () => {
    const agents = Array.from({ length: 3 }, () => mockAgent());
    agents.forEach((a) => pool.create(() => a));

    pool.closeAll();
    expect(pool.size).toBe(0);
    agents.forEach((a) => expect(a.close).toHaveBeenCalled());
  });

  it("passes proxy transport to agent factory", () => {
    let receivedTransport: Transport | null = null;
    pool.create((t) => {
      receivedTransport = t;
      return mockAgent();
    });

    expect(receivedTransport).toBeInstanceOf(ProxyTransport);
  });
});
