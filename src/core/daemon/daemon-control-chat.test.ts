import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowLiveStatus,
  type WorkflowMetricCounts,
} from "./daemon-control.js";
import {
  type DaemonChatConversationResolver,
  DaemonChatPool,
  deleteDaemonSession,
  handleCreateDaemonSession,
  handleDaemonChat,
  readChatBody,
} from "./daemon-control-chat.js";

const CONV_ID = "c-fixture-0000";

function makeBindingStore(): DaemonChatBindingStore {
  const dir = mkdtempSync(join(tmpdir(), "kota-chat-bindings-"));
  return new DaemonChatBindingStore(dir);
}

function makeResolver(conversations: Set<string> = new Set([CONV_ID])): DaemonChatConversationResolver {
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

function mockAgentSession(sendResult?: unknown, mode: "passive" | "supervised" | "autonomous" = "supervised") {
  let current = mode;
  return {
    send: vi.fn(async () => sendResult ?? { status: "ok" }),
    close: vi.fn(),
    getAutonomyMode: vi.fn(() => current),
    setAutonomyMode: vi.fn((next: "passive" | "supervised" | "autonomous") => { current = next; }),
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
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({ runCounts: [], costTotals: [], durationHistogram: [] })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
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
    const session = pool.create(() => agent as never, "supervised", CONV_ID);
    expect(session.id).toBeTruthy();
    expect(session.conversationId).toBe(CONV_ID);
    expect(pool.size).toBe(1);
    expect(pool.get(session.id)).toBe(session);
  });

  it("list returns source daemon", () => {
    const pool = makePool();
    pool.create(() => mockAgentSession() as never, "supervised", CONV_ID);
    const list = pool.list();
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe("daemon");
  });

  it("delete closes agent, removes session, and clears its binding", () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never, "supervised", CONV_ID);
    bindings.put(session.id, CONV_ID);
    expect(deleteDaemonSession(pool, session.id, bindings)).toBe(true);
    expect(pool.size).toBe(0);
    expect(agent.close).toHaveBeenCalled();
    expect(bindings.getBySession(session.id)).toBeUndefined();
  });

  it("delete returns false for unknown id", () => {
    const pool = makePool();
    expect(deleteDaemonSession(pool, "nope")).toBe(false);
  });

  it("evicts oldest idle session when at capacity", () => {
    const pool = makePool({ maxSessions: 2 });
    const a1 = mockAgentSession();
    const s1 = pool.create(() => a1 as never, "supervised", "conv-a");
    s1.lastActive = 1000;
    const s2 = pool.create(() => mockAgentSession() as never, "supervised", "conv-b");
    s2.lastActive = 2000;
    pool.create(() => mockAgentSession() as never, "supervised", "conv-c"); // evicts s1
    expect(pool.get(s1.id)).toBeUndefined();
    expect(a1.close).toHaveBeenCalled();
    expect(pool.size).toBe(2);
  });

  it("cleanup removes idle sessions past TTL", () => {
    const pool = makePool({ ttlMs: 1000 });
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never, "supervised", CONV_ID);
    session.lastActive = Date.now() - 2000;
    expect(pool.cleanup()).toBe(1);
    expect(pool.size).toBe(0);
    expect(agent.close).toHaveBeenCalled();
  });

  it("cleanup preserves busy sessions", () => {
    const pool = makePool({ ttlMs: 1000 });
    const session = pool.create(() => mockAgentSession() as never, "supervised", CONV_ID);
    session.lastActive = Date.now() - 2000;
    session.busy = true;
    expect(pool.cleanup()).toBe(0);
    expect(pool.size).toBe(1);
  });

  it("closeAll closes all and empties pool", () => {
    const pool = makePool();
    const a1 = mockAgentSession();
    const a2 = mockAgentSession();
    pool.create(() => a1 as never, "supervised", "conv-a");
    pool.create(() => a2 as never, "supervised", "conv-b");
    pool.closeAll();
    expect(pool.size).toBe(0);
    expect(a1.close).toHaveBeenCalled();
    expect(a2.close).toHaveBeenCalled();
  });

  it("create rejects a sessionId that is already live", () => {
    const pool = makePool();
    const s1 = pool.create(() => mockAgentSession() as never, "supervised", "conv-a", "reuse-id");
    expect(s1.id).toBe("reuse-id");
    expect(() => pool.create(() => mockAgentSession() as never, "supervised", "conv-b", "reuse-id")).toThrow();
  });

  it("create accepts a caller-supplied sessionId to wake a prior session", () => {
    const pool = makePool();
    const session = pool.create(() => mockAgentSession() as never, "supervised", "conv-a", "resumed-123");
    expect(session.id).toBe("resumed-123");
    expect(session.conversationId).toBe("conv-a");
  });
});

// --- handleCreateDaemonSession ---

describe("handleCreateDaemonSession", () => {
  it("creates a session and returns 201 with session_id and conversation_id", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const resolver = makeResolver();
    const res = mockResponse();
    const agent = mockAgentSession();
    const req = mockRequest("");
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => agent as never, "supervised", resolver);
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const body = JSON.parse(res._written[res._written.length - 1]) as { session_id: string; autonomy_mode: string; conversation_id: string };
    expect(body.session_id).toBeTruthy();
    expect(body.autonomy_mode).toBe("supervised");
    expect(body.conversation_id).toBeTruthy();
    expect(pool.size).toBe(1);
    expect(bindings.getBySession(body.session_id)?.conversationId).toBe(body.conversation_id);
  });

  it("honors autonomy_mode from the request body", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const agent = mockAgentSession();
    const req = mockRequest('{"autonomy_mode":"autonomous"}');
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => agent as never, "supervised", makeResolver());
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const body = JSON.parse(res._written[res._written.length - 1]) as { autonomy_mode: string };
    expect(body.autonomy_mode).toBe("autonomous");
  });

  it("requires autonomy_mode when no default is configured", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const req = mockRequest("");
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => mockAgentSession() as never, undefined, makeResolver());
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(pool.size).toBe(0);
  });

  it("accepts request autonomy_mode when no default is configured", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const agent = mockAgentSession();
    const req = mockRequest('{"autonomy_mode":"autonomous"}');
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => agent as never, undefined, makeResolver());
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const body = JSON.parse(res._written[res._written.length - 1]) as { autonomy_mode: string };
    expect(body.autonomy_mode).toBe("autonomous");
  });

  it("returns 400 on invalid autonomy_mode", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const req = mockRequest('{"autonomy_mode":"banana"}');
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => mockAgentSession() as never, "supervised", makeResolver());
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(pool.size).toBe(0);
  });

  it("returns 503 when pool is full and all busy", async () => {
    const pool = makePool({ maxSessions: 1 });
    const bindings = makeBindingStore();
    const resolver = makeResolver();
    const agent = mockAgentSession();
    const res1 = mockResponse();
    const req1 = mockRequest("");
    await handleCreateDaemonSession(pool, bindings, req1 as never, res1 as never, () => agent as never, "supervised", resolver);
    const s = pool.get(JSON.parse(res1._written[res1._written.length - 1] as string).session_id);
    if (s) s.busy = true;
    const res2 = mockResponse();
    const req2 = mockRequest("");
    await handleCreateDaemonSession(pool, bindings, req2 as never, res2 as never, () => mockAgentSession() as never, "supervised", resolver);
    expect(res2.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
  });

  it("resumes an existing conversation when conversation_id is provided", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const conversations = new Set(["existing-conv"]);
    const resolver = makeResolver(conversations);
    const seen: string[] = [];
    const res = mockResponse();
    const req = mockRequest('{"conversation_id":"existing-conv"}');
    await handleCreateDaemonSession(
      pool,
      bindings,
      req as never,
      res as never,
      (_transport, _mode, resumeConv) => {
        seen.push(resumeConv ?? "");
        return mockAgentSession() as never;
      },
      "supervised",
      resolver,
    );
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    expect(seen).toEqual(["existing-conv"]);
    const body = JSON.parse(res._written[res._written.length - 1]) as { conversation_id: string; session_id: string };
    expect(body.conversation_id).toBe("existing-conv");
    expect(bindings.getByConversation("existing-conv")?.sessionId).toBe(body.session_id);
  });

  it("wakes a prior session_id using the persisted binding", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    bindings.put("s-prior", "conv-prior");
    const conversations = new Set(["conv-prior"]);
    const resolver = makeResolver(conversations);
    const res = mockResponse();
    const req = mockRequest('{"session_id":"s-prior"}');
    await handleCreateDaemonSession(
      pool,
      bindings,
      req as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      resolver,
    );
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const body = JSON.parse(res._written[res._written.length - 1]) as { session_id: string; conversation_id: string };
    expect(body.session_id).toBe("s-prior");
    expect(body.conversation_id).toBe("conv-prior");
    expect(pool.get("s-prior")).toBeTruthy();
  });

  it("returns 404 when session_id has no binding", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const req = mockRequest('{"session_id":"unknown"}');
    await handleCreateDaemonSession(
      pool,
      bindings,
      req as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      makeResolver(),
    );
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it("returns 404 when conversation_id is not in history", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const req = mockRequest('{"conversation_id":"missing"}');
    await handleCreateDaemonSession(
      pool,
      bindings,
      req as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      makeResolver(new Set()),
    );
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it("returns 409 when session_id is already live", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const resolver = makeResolver();
    bindings.put("s-live", "conv-live");
    const conversations = new Set(["conv-live"]);
    const res0 = mockResponse();
    await handleCreateDaemonSession(
      pool,
      bindings,
      mockRequest('{"session_id":"s-live"}') as never,
      res0 as never,
      () => mockAgentSession() as never,
      "supervised",
      { conversationExists: (id) => conversations.has(id), createConversation: resolver.createConversation },
    );
    expect(res0.writeHead).toHaveBeenCalledWith(201, expect.any(Object));

    const res1 = mockResponse();
    await handleCreateDaemonSession(
      pool,
      bindings,
      mockRequest('{"session_id":"s-live"}') as never,
      res1 as never,
      () => mockAgentSession() as never,
      "supervised",
      { conversationExists: (id) => conversations.has(id), createConversation: resolver.createConversation },
    );
    expect(res1.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
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
    const session = pool.create(() => agent as never, "supervised", CONV_ID);
    const req = mockRequest('{}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, session.id);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it("returns 409 when session is busy", async () => {
    const pool = makePool();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never, "supervised", CONV_ID);
    session.busy = true;
    const req = mockRequest('{"message":"hi"}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, session.id);
    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
  });

  it("streams SSE response for valid session", async () => {
    const pool = makePool();
    const agent = mockAgentSession({ status: "done" });
    const session = pool.create(() => agent as never, "supervised", CONV_ID);
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
    const session = pool.create(() => agent as never, "supervised", CONV_ID);
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
  let bindingsDir: string;
  let bindings: DaemonChatBindingStore;

  beforeEach(async () => {
    bindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-bindings-"));
    bindings = new DaemonChatBindingStore(bindingsDir);
    const handle = makeHandle();
    server = new DaemonControlServer(handle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => {
        const agent = mockAgentSession({ result: "ok" }, mode);
        return agent as never;
      },
      defaultAutonomyMode: "supervised",
      chatBindings: bindings,
      conversationResolver: makeResolver(new Set()),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    rmSync(bindingsDir, { recursive: true, force: true });
  });

  it("POST /sessions creates a daemon session", async () => {
    const res = await fetchWithToken(port, "/sessions", { method: "POST" });
    expect(res.status).toBe(201);
    const body = await res.json() as { session_id: string };
    expect(body.session_id).toBeTruthy();
  });

  it("POST /sessions returns 400 without request mode when no default is configured", async () => {
    const handle = makeHandle();
    const serverWithoutDefault = new DaemonControlServer(handle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
      chatBindings: makeBindingStore(),
      conversationResolver: makeResolver(new Set()),
    });
    const portWithoutDefault = await serverWithoutDefault.start();
    try {
      const res = await fetchWithToken(portWithoutDefault, "/sessions", { method: "POST" });
      expect(res.status).toBe(400);
    } finally {
      await serverWithoutDefault.stop();
    }
  });

  it("POST /sessions accepts request mode when no default is configured", async () => {
    const handle = makeHandle();
    const serverWithoutDefault = new DaemonControlServer(handle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
      chatBindings: makeBindingStore(),
      conversationResolver: makeResolver(new Set()),
    });
    const portWithoutDefault = await serverWithoutDefault.start();
    try {
      const res = await fetchWithToken(portWithoutDefault, "/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autonomy_mode: "autonomous" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { autonomy_mode: string };
      expect(body.autonomy_mode).toBe("autonomous");
    } finally {
      await serverWithoutDefault.stop();
    }
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

  it("PATCH /sessions/:id updates the mode of a daemon-owned session", async () => {
    const createRes = await fetchWithToken(port, "/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy_mode: "supervised" }),
    });
    const { session_id } = await createRes.json() as { session_id: string };
    const patchRes = await fetchWithToken(port, `/sessions/${session_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy_mode: "autonomous" }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json() as { source: string; autonomy_mode: string };
    expect(body.source).toBe("daemon");
    expect(body.autonomy_mode).toBe("autonomous");

    const listRes = await fetchWithToken(port, "/sessions");
    const listBody = await listRes.json() as { sessions: Array<{ id: string; autonomyMode: string }> };
    const entry = listBody.sessions.find((s) => s.id === session_id);
    expect(entry?.autonomyMode).toBe("autonomous");
  });

  it("PATCH /sessions/:id returns 400 on invalid mode", async () => {
    const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
    const { session_id } = await createRes.json() as { session_id: string };
    const res = await fetchWithToken(port, `/sessions/${session_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy_mode: "banana" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /sessions/:id reports serve source when daemon only holds registration metadata", async () => {
    let currentMode: "passive" | "supervised" | "autonomous" = "supervised";
    const serveHandle = makeHandle({
      setSessionAutonomyMode: vi.fn((_id, mode) => {
        currentMode = mode;
        return { ok: true, serveOwned: true };
      }),
    });
    const serveServer = new DaemonControlServer(serveHandle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
      defaultAutonomyMode: "supervised",
      chatBindings: makeBindingStore(),
      conversationResolver: makeResolver(new Set()),
    });
    const servePort = await serveServer.start();
    try {
      const res = await globalThis.fetch(`http://127.0.0.1:${servePort}/sessions/serve-abc`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${TEST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ autonomy_mode: "passive" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { source: string; autonomy_mode: string; serveOwned: boolean };
      expect(body.source).toBe("serve");
      expect(body.serveOwned).toBe(true);
      expect(body.autonomy_mode).toBe("passive");
      expect(currentMode).toBe("passive");
    } finally {
      await serveServer.stop();
    }
  });

  it("PATCH /sessions/:id returns 404 when session is unknown", async () => {
    const res = await fetchWithToken(port, "/sessions/unknown-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy_mode: "passive" }),
    });
    expect(res.status).toBe(404);
  });
});

// --- Integration: server-level defaultAutonomyMode knob ---

describe("DaemonControlServer defaultAutonomyMode knob", () => {
  it("uses the configured default when POST /sessions omits autonomy_mode", async () => {
    const handle = makeHandle();
    const server = new DaemonControlServer(handle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
      defaultAutonomyMode: "passive",
      chatBindings: makeBindingStore(),
      conversationResolver: makeResolver(new Set()),
    });
    const port = await server.start();
    try {
      const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
      expect(createRes.status).toBe(201);
      const createBody = await createRes.json() as { session_id: string; autonomy_mode: string };
      expect(createBody.autonomy_mode).toBe("passive");

      const listRes = await fetchWithToken(port, "/sessions");
      const listBody = await listRes.json() as { sessions: Array<{ id: string; autonomyMode: string }> };
      const entry = listBody.sessions.find((s) => s.id === createBody.session_id);
      expect(entry?.autonomyMode).toBe("passive");
    } finally {
      await server.stop();
    }
  });
});

// --- Wake-after-restart: the task's defining use case ---

describe("DaemonControlServer wake after daemon restart", () => {
  it("accepts POST /sessions with prior session_id backed by the persisted binding", async () => {
    const bindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-restart-"));
    try {
      // First daemon boot: create a session, remember its id + conv.
      const conversations = new Set<string>();
      const resolver1 = makeResolver(conversations);
      const server1 = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
        defaultAutonomyMode: "supervised",
        chatBindings: new DaemonChatBindingStore(bindingsDir),
        conversationResolver: resolver1,
      });
      const port1 = await server1.start();
      const createRes = await fetchWithToken(port1, "/sessions", { method: "POST" });
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as { session_id: string; conversation_id: string };
      await server1.stop();

      // Second daemon boot: brand new server, new binding-store instance, same file.
      const resumedResumes: Array<string | undefined> = [];
      const server2 = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        makeAgent: (_transport, mode, resumeConv) => {
          resumedResumes.push(resumeConv);
          return mockAgentSession({ result: "ok" }, mode) as never;
        },
        defaultAutonomyMode: "supervised",
        chatBindings: new DaemonChatBindingStore(bindingsDir),
        conversationResolver: makeResolver(conversations),
      });
      const port2 = await server2.start();
      try {
        const wakeRes = await fetchWithToken(port2, "/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: created.session_id }),
        });
        expect(wakeRes.status).toBe(201);
        const woken = await wakeRes.json() as { session_id: string; conversation_id: string };
        expect(woken.session_id).toBe(created.session_id);
        expect(woken.conversation_id).toBe(created.conversation_id);
        expect(resumedResumes).toEqual([created.conversation_id]);
      } finally {
        await server2.stop();
      }
    } finally {
      rmSync(bindingsDir, { recursive: true, force: true });
    }
  });

  it("returns 404 when waking an unknown session_id", async () => {
    const bindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-404-"));
    try {
      const server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
        defaultAutonomyMode: "supervised",
        chatBindings: new DaemonChatBindingStore(bindingsDir),
        conversationResolver: makeResolver(new Set()),
      });
      const port = await server.start();
      try {
        const res = await fetchWithToken(port, "/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: "never-existed" }),
        });
        expect(res.status).toBe(404);
      } finally {
        await server.stop();
      }
    } finally {
      rmSync(bindingsDir, { recursive: true, force: true });
    }
  });

  it("DELETE /sessions/:id clears the binding so subsequent wake attempts 404", async () => {
    const bindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-del-"));
    try {
      const conversations = new Set<string>();
      const server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
        defaultAutonomyMode: "supervised",
        chatBindings: new DaemonChatBindingStore(bindingsDir),
        conversationResolver: makeResolver(conversations),
      });
      const port = await server.start();
      try {
        const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
        const created = await createRes.json() as { session_id: string };
        const delRes = await fetchWithToken(port, `/sessions/${created.session_id}`, { method: "DELETE" });
        expect(delRes.status).toBe(204);
        const wakeRes = await fetchWithToken(port, "/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: created.session_id }),
        });
        expect(wakeRes.status).toBe(404);
      } finally {
        await server.stop();
      }
    } finally {
      rmSync(bindingsDir, { recursive: true, force: true });
    }
  });
});
