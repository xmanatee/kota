import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "#core/loop/transport.js";
import {
  CORS_HEADERS,
  jsonResponse,
  type ManagedSession,
  readBody,
  SessionPool,
  SseTransport,
  setCors,
} from "./session-pool.js";

// --- Mocks ---

function mockResponse(): EventEmitter & {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  writeHead: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  _written: string[];
} {
  const res = new EventEmitter() as ReturnType<typeof mockResponse>;
  res._written = [];
  res.write = vi.fn((data: string) => {
    res._written.push(data);
    return true;
  });
  res.end = vi.fn((data?: string) => {
    if (data) res._written.push(data);
  });
  res.writeHead = vi.fn();
  res.setHeader = vi.fn();
  return res;
}

function mockRequest(body?: string): EventEmitter & { destroy: ReturnType<typeof vi.fn> } {
  const req = new EventEmitter() as ReturnType<typeof mockRequest>;
  req.destroy = vi.fn();
  if (body !== undefined) {
    queueMicrotask(() => {
      req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  }
  return req;
}

function mockAgentSession(): {
  close: ReturnType<typeof vi.fn>;
  getAutonomyMode: () => "autonomous";
  setAutonomyMode: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    getAutonomyMode: () => "autonomous" as const,
    setAutonomyMode: vi.fn(),
  };
}

function makePool(opts?: { maxSessions?: number; ttlMs?: number }) {
  return new SessionPool(opts);
}

function poolFactory(pool: SessionPool): ManagedSession {
  return pool.create((_transport) => {
    const session = mockAgentSession();
    return session as never;
  });
}

// --- SseTransport ---

describe("SseTransport", () => {
  it("formats events as SSE", () => {
    const res = mockResponse();
    const transport = new SseTransport(res as never);
    const event: AgentEvent = { type: "text", content: "hello" };

    transport.emit(event);

    expect(res.write).toHaveBeenCalledWith(
      `event: text\ndata: ${JSON.stringify(event)}\n\n`,
    );
  });

  it("sends custom named events via send()", () => {
    const res = mockResponse();
    const transport = new SseTransport(res as never);

    transport.send("session", { id: "abc" });

    expect(res.write).toHaveBeenCalledWith(
      `event: session\ndata: ${JSON.stringify({ id: "abc" })}\n\n`,
    );
  });

  it("stops emitting after connection closes", () => {
    const res = mockResponse();
    const transport = new SseTransport(res as never);

    res.emit("close");
    transport.emit({ type: "text", content: "dropped" });

    expect(res.write).not.toHaveBeenCalled();
    expect(transport.isClosed).toBe(true);
  });

  it("stops sending after connection closes", () => {
    const res = mockResponse();
    const transport = new SseTransport(res as never);

    res.emit("close");
    transport.send("done", {});

    expect(res.write).not.toHaveBeenCalled();
  });

  it("end() closes the response and prevents further writes", () => {
    const res = mockResponse();
    const transport = new SseTransport(res as never);

    transport.end();

    expect(res.end).toHaveBeenCalled();
    expect(transport.isClosed).toBe(true);

    // Subsequent calls should be no-ops
    transport.emit({ type: "text", content: "nope" });
    transport.send("done", {});
    transport.end();

    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("handles multiple events in sequence", () => {
    const res = mockResponse();
    const transport = new SseTransport(res as never);

    transport.emit({ type: "text", content: "a" });
    transport.emit({ type: "status", message: "b" });
    transport.send("done", { ok: true });

    expect(res.write).toHaveBeenCalledTimes(3);
  });
});

// --- SessionPool ---

describe("SessionPool", () => {
  it("creates sessions with unique IDs", () => {
    const pool = makePool();
    const s1 = poolFactory(pool);
    const s2 = poolFactory(pool);

    expect(s1.id).toBeTruthy();
    expect(s2.id).toBeTruthy();
    expect(s1.id).not.toBe(s2.id);
    expect(pool.size).toBe(2);
  });

  it("retrieves sessions by ID", () => {
    const pool = makePool();
    const created = poolFactory(pool);

    expect(pool.get(created.id)).toBe(created);
    expect(pool.get("nonexistent")).toBeUndefined();
  });

  it("deletes a session and calls close()", () => {
    const pool = makePool();
    const session = poolFactory(pool);
    const { agent } = session;

    expect(pool.delete(session.id)).toBe(true);
    expect(pool.size).toBe(0);
    expect(pool.get(session.id)).toBeUndefined();
    expect(agent.close).toHaveBeenCalled();
  });

  it("returns false when deleting a nonexistent session", () => {
    const pool = makePool();
    expect(pool.delete("nope")).toBe(false);
  });

  it("lists sessions with id, busy, lastActive", () => {
    const pool = makePool();
    const s1 = poolFactory(pool);
    const s2 = poolFactory(pool);
    s2.busy = true;

    const list = pool.list();
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.id === s1.id)?.busy).toBe(false);
    expect(list.find((s) => s.id === s2.id)?.busy).toBe(true);
  });

  it("evicts oldest idle session when at capacity", () => {
    const pool = makePool({ maxSessions: 2 });
    const s1 = poolFactory(pool);
    s1.lastActive = 1000; // oldest
    const s2 = poolFactory(pool);
    s2.lastActive = 2000;

    // Creating a third should evict s1
    const s3 = poolFactory(pool);

    expect(pool.size).toBe(2);
    expect(pool.get(s1.id)).toBeUndefined();
    expect(pool.get(s2.id)).toBe(s2);
    expect(pool.get(s3.id)).toBe(s3);
    expect(s1.agent.close).toHaveBeenCalled();
  });

  it("throws when all sessions are busy and at capacity", () => {
    const pool = makePool({ maxSessions: 1 });
    const s1 = poolFactory(pool);
    s1.busy = true;

    expect(() => poolFactory(pool)).toThrow("Too many active sessions");
    expect(pool.size).toBe(1);
  });

  it("evicts idle session even if some are busy", () => {
    const pool = makePool({ maxSessions: 2 });
    const s1 = poolFactory(pool);
    s1.busy = true;
    s1.lastActive = 1000;
    const s2 = poolFactory(pool);
    s2.lastActive = 2000;

    // s1 is busy, s2 is idle — should evict s2
    const s3 = poolFactory(pool);

    expect(pool.size).toBe(2);
    expect(pool.get(s1.id)).toBe(s1); // busy, kept
    expect(pool.get(s2.id)).toBeUndefined(); // idle, evicted
    expect(pool.get(s3.id)).toBe(s3);
  });

  describe("cleanup()", () => {
    it("removes sessions that exceed TTL", () => {
      const pool = makePool({ ttlMs: 1000 });
      const s1 = poolFactory(pool);
      s1.lastActive = Date.now() - 2000; // expired

      const count = pool.cleanup();

      expect(count).toBe(1);
      expect(pool.size).toBe(0);
      expect(s1.agent.close).toHaveBeenCalled();
    });

    it("preserves busy sessions even if TTL expired", () => {
      const pool = makePool({ ttlMs: 1000 });
      const s1 = poolFactory(pool);
      s1.lastActive = Date.now() - 2000;
      s1.busy = true;

      const count = pool.cleanup();

      expect(count).toBe(0);
      expect(pool.size).toBe(1);
    });

    it("preserves sessions within TTL", () => {
      const pool = makePool({ ttlMs: 60000 });
      const _s1 = poolFactory(pool);

      const count = pool.cleanup();

      expect(count).toBe(0);
      expect(pool.size).toBe(1);
    });

    it("handles mixed expired and active sessions", () => {
      const pool = makePool({ ttlMs: 1000 });
      const expired = poolFactory(pool);
      expired.lastActive = Date.now() - 5000;
      const active = poolFactory(pool);
      active.lastActive = Date.now();

      const count = pool.cleanup();

      expect(count).toBe(1);
      expect(pool.size).toBe(1);
      expect(pool.get(active.id)).toBe(active);
      expect(pool.get(expired.id)).toBeUndefined();
    });

    it("returns 0 when pool is empty", () => {
      const pool = makePool();
      expect(pool.cleanup()).toBe(0);
    });
  });

  describe("closeAll()", () => {
    it("closes all sessions and empties the pool", () => {
      const pool = makePool();
      const s1 = poolFactory(pool);
      const s2 = poolFactory(pool);

      pool.closeAll();

      expect(pool.size).toBe(0);
      expect(s1.agent.close).toHaveBeenCalled();
      expect(s2.agent.close).toHaveBeenCalled();
    });

    it("is safe on an empty pool", () => {
      const pool = makePool();
      expect(() => pool.closeAll()).not.toThrow();
    });
  });

  it("uses default options when none provided", () => {
    const pool = new SessionPool();
    // Should be able to create 10 sessions without eviction
    const sessions: ManagedSession[] = [];
    for (let i = 0; i < 10; i++) {
      sessions.push(poolFactory(pool));
    }
    expect(pool.size).toBe(10);
  });
});

// --- Helper functions ---

describe("setCors()", () => {
  it("sets all CORS headers on response", () => {
    const res = mockResponse();
    setCors(res as never);

    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      expect(res.setHeader).toHaveBeenCalledWith(key, value);
    }
  });
});

describe("jsonResponse()", () => {
  it("sends JSON with correct status and content-type", () => {
    const res = mockResponse();
    jsonResponse(res as never, 200, { ok: true });

    expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
  });

  it("sets CORS headers", () => {
    const res = mockResponse();
    jsonResponse(res as never, 404, { error: "not found" });

    expect(res.setHeader).toHaveBeenCalled();
  });
});

describe("readBody()", () => {
  it("parses valid JSON body", async () => {
    const req = mockRequest('{"message":"hello"}');
    const body = await readBody(req as never);
    expect(body).toEqual({ message: "hello" });
  });

  it("returns empty object for empty body", async () => {
    const req = mockRequest("");
    const body = await readBody(req as never);
    expect(body).toEqual({});
  });

  it("returns empty object when no data events", async () => {
    const req = new EventEmitter();
    queueMicrotask(() => req.emit("end"));
    const body = await readBody(req as never);
    expect(body).toEqual({});
  });

  it("rejects on invalid JSON", async () => {
    const req = mockRequest("{not json}");
    await expect(readBody(req as never)).rejects.toThrow("Invalid JSON");
  });

  it("rejects on oversized body", async () => {
    const req = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
    req.destroy = vi.fn();

    const promise = readBody(req as never);

    // Send a chunk larger than 1MB
    const bigChunk = Buffer.alloc(1024 * 1024 + 1);
    req.emit("data", bigChunk);

    await expect(promise).rejects.toThrow("Request body too large");
    expect(req.destroy).toHaveBeenCalled();
  });

  it("rejects on request error", async () => {
    const req = new EventEmitter();
    const promise = readBody(req as never);

    queueMicrotask(() => req.emit("error", new Error("connection reset")));

    await expect(promise).rejects.toThrow("connection reset");
  });

  it("accumulates multiple data chunks", async () => {
    const req = new EventEmitter();
    const promise = readBody(req as never);

    queueMicrotask(() => {
      req.emit("data", Buffer.from('{"ke'));
      req.emit("data", Buffer.from('y":"val"}'));
      req.emit("end");
    });

    const body = await promise;
    expect(body).toEqual({ key: "val" });
  });

  it("rejects when cumulative chunks exceed limit", async () => {
    const req = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
    req.destroy = vi.fn();

    const promise = readBody(req as never);
    const halfMB = Buffer.alloc(512 * 1024);

    queueMicrotask(() => {
      req.emit("data", halfMB);
      req.emit("data", halfMB);
      req.emit("data", halfMB); // 1.5MB total — exceeds 1MB limit
    });

    await expect(promise).rejects.toThrow("Request body too large");
  });
});
