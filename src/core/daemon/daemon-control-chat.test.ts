import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowLiveStatus,
  type WorkflowMetricCounts,
} from "./daemon-control.js";
import {
  DaemonChatPool,
  deleteDaemonSession,
  handleCreateDaemonSession,
  handleDaemonChat,
  readChatBody,
} from "./daemon-control-chat.js";

// --- Helpers ---

function mockResponse(): EventEmitter & {
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

function mockRequest(body?: string): EventEmitter {
  const req = new EventEmitter();
  if (body !== undefined) {
    queueMicrotask(() => {
      (req as NodeJS.EventEmitter).emit("data", Buffer.from(body));
      (req as NodeJS.EventEmitter).emit("end");
    });
  }
  return req;
}

function mockAgentSession(sendResult?: unknown) {
  return {
    send: vi.fn(async () => sendResult ?? { status: "ok" }),
    close: vi.fn(),
  };
}

function makePool(opts?: { maxSessions?: number; ttlMs?: number }) {
  return new DaemonChatPool(opts);
}

function makeHandle(overrides: Partial<DaemonControlHandle> = {}): DaemonControlHandle {
  const defaultWorkflowStatus: WorkflowLiveStatus = {
    activeRuns: [],
    pendingRuns: [],
    queueLength: 0,
    completedRuns: 0,
    workflows: {},
    paused: false,
    agentConcurrency: 1,
    codeConcurrency: 4,
  };
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 9999,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({ scheduler: "ok" as const, modules: "ok" as const })),
    getWorkflowLiveStatus: vi.fn(() => ({ ...defaultWorkflowStatus })),
    pauseWorkflowDispatch: vi.fn(() => ({ already: false })),
    resumeWorkflowDispatch: vi.fn(() => ({ already: false })),
    abortActiveRuns: vi.fn(() => ({ aborted: 0 })),
    abortActiveRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 0 })),
    getWorkflowDefinitions: vi.fn(() => []),
    enableWorkflow: vi.fn(() => ({ ok: true })),
    disableWorkflow: vi.fn(() => ({ ok: true })),
    enqueuePendingRun: vi.fn(() => ({ ok: true })),
    cancelQueuedRun: vi.fn(() => ({ ok: false, notFound: true })),
    subscribeToEvents: vi.fn(() => () => {}),
    listHistory: vi.fn(() => []),
    getHistory: vi.fn(() => null),
    deleteHistory: vi.fn(() => false),
    listApprovals: vi.fn(() => []),
    approveApproval: vi.fn(() => null),
    rejectApproval: vi.fn(() => null),
    approveAllApprovals: vi.fn(() => []),
    rejectAllApprovals: vi.fn(() => []),
    listOwnerQuestions: vi.fn(() => []),
    answerOwnerQuestion: vi.fn(() => null),
    dismissOwnerQuestion: vi.fn(() => null),
    getTaskStatus: vi.fn(() => ({ counts: { inbox: 0, ready: 0, backlog: 0, doing: 0, blocked: 0 }, tasks: { doing: [], ready: [], backlog: [], blocked: [] } })),
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({ runCounts: [], costTotals: [], durationHistogram: [] })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    triggerWebhookRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [] as string[] })),
    registerPushToken: vi.fn(),
    ...overrides,
  };
}

// --- DaemonChatPool ---

describe("DaemonChatPool", () => {
  it("creates a session with unique id", () => {
    const pool = makePool();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never);
    expect(session.id).toBeTruthy();
    expect(pool.size).toBe(1);
    expect(pool.get(session.id)).toBe(session);
  });

  it("list returns source daemon", () => {
    const pool = makePool();
    pool.create(() => mockAgentSession() as never);
    const list = pool.list();
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe("daemon");
  });

  it("delete closes agent and removes session", () => {
    const pool = makePool();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never);
    expect(deleteDaemonSession(pool, session.id)).toBe(true);
    expect(pool.size).toBe(0);
    expect(agent.close).toHaveBeenCalled();
  });

  it("delete returns false for unknown id", () => {
    const pool = makePool();
    expect(deleteDaemonSession(pool, "nope")).toBe(false);
  });

  it("evicts oldest idle session when at capacity", () => {
    const pool = makePool({ maxSessions: 2 });
    const a1 = mockAgentSession();
    const s1 = pool.create(() => a1 as never);
    s1.lastActive = 1000;
    const s2 = pool.create(() => mockAgentSession() as never);
    s2.lastActive = 2000;
    pool.create(() => mockAgentSession() as never); // evicts s1
    expect(pool.get(s1.id)).toBeUndefined();
    expect(a1.close).toHaveBeenCalled();
    expect(pool.size).toBe(2);
  });

  it("cleanup removes idle sessions past TTL", () => {
    const pool = makePool({ ttlMs: 1000 });
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never);
    session.lastActive = Date.now() - 2000;
    expect(pool.cleanup()).toBe(1);
    expect(pool.size).toBe(0);
    expect(agent.close).toHaveBeenCalled();
  });

  it("cleanup preserves busy sessions", () => {
    const pool = makePool({ ttlMs: 1000 });
    const session = pool.create(() => mockAgentSession() as never);
    session.lastActive = Date.now() - 2000;
    session.busy = true;
    expect(pool.cleanup()).toBe(0);
    expect(pool.size).toBe(1);
  });

  it("closeAll closes all and empties pool", () => {
    const pool = makePool();
    const a1 = mockAgentSession();
    const a2 = mockAgentSession();
    pool.create(() => a1 as never);
    pool.create(() => a2 as never);
    pool.closeAll();
    expect(pool.size).toBe(0);
    expect(a1.close).toHaveBeenCalled();
    expect(a2.close).toHaveBeenCalled();
  });
});

// --- handleCreateDaemonSession ---

describe("handleCreateDaemonSession", () => {
  it("creates a session and returns 201 with session_id", () => {
    const pool = makePool();
    const res = mockResponse();
    const agent = mockAgentSession();
    handleCreateDaemonSession(pool, res as never, () => agent as never);
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const body = JSON.parse(res._written[res._written.length - 1]) as { session_id: string };
    expect(body.session_id).toBeTruthy();
    expect(pool.size).toBe(1);
  });

  it("returns 503 when pool is full and all busy", () => {
    const pool = makePool({ maxSessions: 1 });
    const agent = mockAgentSession();
    const res1 = mockResponse();
    handleCreateDaemonSession(pool, res1 as never, () => agent as never);
    const s = pool.get(JSON.parse(res1._written[res1._written.length - 1] as string).session_id);
    if (s) s.busy = true;
    const res2 = mockResponse();
    handleCreateDaemonSession(pool, res2 as never, () => mockAgentSession() as never);
    expect(res2.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
  });
});

// --- readChatBody ---

describe("readChatBody", () => {
  it("parses valid JSON body", async () => {
    const req = mockRequest('{"message":"hello"}');
    const body = await readChatBody(req as never);
    expect(body).toEqual({ message: "hello" });
  });

  it("returns empty object for empty body", async () => {
    const req = mockRequest("");
    const body = await readChatBody(req as never);
    expect(body).toEqual({});
  });

  it("rejects on invalid JSON", async () => {
    const req = mockRequest("{not json}");
    await expect(readChatBody(req as never)).rejects.toThrow("Invalid JSON");
  });
});

// --- handleDaemonChat ---

describe("handleDaemonChat", () => {
  it("returns 404 when session not found", async () => {
    const pool = makePool();
    const req = mockRequest('{"message":"hi"}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, "nope");
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it("returns 400 when message is missing", async () => {
    const pool = makePool();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never);
    const req = mockRequest('{}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, session.id);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it("returns 409 when session is busy", async () => {
    const pool = makePool();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never);
    session.busy = true;
    const req = mockRequest('{"message":"hi"}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, session.id);
    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
  });

  it("streams SSE response for valid session", async () => {
    const pool = makePool();
    const agent = mockAgentSession({ status: "done" });
    const session = pool.create(() => agent as never);
    const req = mockRequest('{"message":"hello"}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, session.id);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/event-stream" }));
    const written = res._written.join("");
    expect(written).toContain("event: session");
    expect(written).toContain("event: done");
    expect(written).toContain(session.id);
    expect(agent.send).toHaveBeenCalledWith("hello");
    expect(session.busy).toBe(false);
    expect(res.end).toHaveBeenCalled();
  });

  it("resets busy and streams error on agent failure", async () => {
    const pool = makePool();
    const agent = {
      send: vi.fn(async () => { throw new Error("agent failed"); }),
      close: vi.fn(),
    };
    const session = pool.create(() => agent as never);
    const req = mockRequest('{"message":"hi"}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, session.id);
    expect(session.busy).toBe(false);
    const written = res._written.join("");
    expect(written).toContain("event: error");
  });
});

// --- Integration: DaemonControlServer with chat pool ---

const TEST_TOKEN = "test-chat-token-xyz";

async function fetchWithToken(port: number, path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${TEST_TOKEN}`);
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers });
}

describe("DaemonControlServer chat endpoints", () => {
  let server: DaemonControlServer;
  let port: number;

  beforeEach(async () => {
    const handle = makeHandle();
    server = new DaemonControlServer(handle, TEST_TOKEN, {
      makeAgent: (_transport) => {
        const agent = mockAgentSession({ result: "ok" });
        return agent as never;
      },
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("POST /sessions creates a daemon session", async () => {
    const res = await fetchWithToken(port, "/sessions", { method: "POST" });
    expect(res.status).toBe(201);
    const body = await res.json() as { session_id: string };
    expect(body.session_id).toBeTruthy();
  });

  it("GET /sessions includes daemon sessions with source daemon", async () => {
    await fetchWithToken(port, "/sessions", { method: "POST" });
    const res = await fetchWithToken(port, "/sessions");
    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ source: string }> };
    expect(body.sessions.some((s) => s.source === "daemon")).toBe(true);
  });

  it("DELETE /sessions/:id closes daemon session", async () => {
    const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
    const { session_id } = await createRes.json() as { session_id: string };
    const deleteRes = await fetchWithToken(port, `/sessions/${session_id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);
  });

  it("DELETE /sessions/:id returns 204 for known serve sessions via unregister", async () => {
    // Serve sessions: unregister always returns 204 (the handle unregister does)
    const res = await fetchWithToken(port, "/sessions/serve-session-id", { method: "DELETE" });
    // unregisterSession just removes from map and emits — returns 204
    expect(res.status).toBe(204);
  });

  it("POST /sessions/:id/chat returns 404 for unknown session", async () => {
    const res = await fetchWithToken(port, "/sessions/unknown/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(404);
  });
});
