import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import {
  type DaemonChatConversationResolver,
  handleCreateDaemonSession,
  handleDaemonChat,
  handleDaemonChatEvents,
  readChatBody,
} from "./daemon-chat-handlers.js";
import { DaemonChatPool } from "./daemon-chat-pool.js";

const CONV_ID = "c-fixture-0000";
const PROJECT_ID = "test-project-id";

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
    cancelActiveTurn: vi.fn(),
    close: vi.fn(),
    getAutonomyMode: vi.fn(() => current),
    setAutonomyMode: vi.fn((next: "passive" | "supervised" | "autonomous") => { current = next; }),
  };
}

function makePool(opts?: { maxSessions?: number; ttlMs?: number }) {
  return new DaemonChatPool(opts);
}

// --- handleCreateDaemonSession ---

describe("handleCreateDaemonSession", () => {
  it("creates a session and returns 201 with session_id and conversation_id", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const resolver = makeResolver();
    const res = mockResponse();
    const agent = mockAgentSession();
    const req = mockRequest("");
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => agent as never, "supervised", PROJECT_ID, resolver);
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const body = JSON.parse(res._written[res._written.length - 1]) as { session_id: string; autonomy_mode: string; conversation_id: string };
    expect(body.session_id).toBeTruthy();
    expect(body.autonomy_mode).toBe("supervised");
    expect(body.conversation_id).toBeTruthy();
    expect(pool.size).toBe(1);
    expect(bindings.getBySession(body.session_id)?.conversationId).toBe(body.conversation_id);
  });

  it("passes normalized mcp_servers into the daemon session without exposing secret values", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const resolver = makeResolver();
    const res = mockResponse();
    const seen: unknown[] = [];
    const req = mockRequest(JSON.stringify({
      mcp_servers: {
        fs: {
          type: "stdio",
          command: "/usr/bin/env",
          args: ["node"],
          env: { API_KEY: "secret-token" },
        },
      },
    }));
    await handleCreateDaemonSession(
      pool,
      bindings,
      req as never,
      res as never,
      (_transport, _mode, _resume, _projectId, mcpServers) => {
        seen.push(mcpServers);
        return mockAgentSession() as never;
      },
      "supervised",
      PROJECT_ID,
      resolver,
    );
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    expect(seen).toEqual([
      {
        fs: {
          type: "stdio",
          command: "/usr/bin/env",
          args: ["node"],
          env: { API_KEY: "secret-token" },
        },
      },
    ]);
    const body = JSON.parse(res._written[res._written.length - 1]) as { session_id: string };
    expect(pool.get(body.session_id)?.mcpServers).toEqual(seen[0]);
    expect(res._written.join("")).not.toContain("secret-token");
  });

  it("rejects malformed mcp_servers before creating a daemon session", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const req = mockRequest(JSON.stringify({
      mcp_servers: {
        fs: {
          type: "stdio",
          command: "/usr/bin/env",
          env: { API_KEY: 42 },
        },
      },
    }));
    await handleCreateDaemonSession(
      pool,
      bindings,
      req as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      makeResolver(),
    );
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(pool.size).toBe(0);
    expect(res._written.join("")).not.toContain("secret-token");
  });

  it("honors autonomy_mode from the request body", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const agent = mockAgentSession();
    const req = mockRequest('{"autonomy_mode":"autonomous"}');
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => agent as never, "supervised", PROJECT_ID, makeResolver());
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const body = JSON.parse(res._written[res._written.length - 1]) as { autonomy_mode: string };
    expect(body.autonomy_mode).toBe("autonomous");
  });

  it("requires autonomy_mode when no default is configured", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const req = mockRequest("");
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => mockAgentSession() as never, undefined, PROJECT_ID, makeResolver());
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(pool.size).toBe(0);
  });

  it("accepts request autonomy_mode when no default is configured", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const agent = mockAgentSession();
    const req = mockRequest('{"autonomy_mode":"autonomous"}');
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => agent as never, undefined, PROJECT_ID, makeResolver());
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const body = JSON.parse(res._written[res._written.length - 1]) as { autonomy_mode: string };
    expect(body.autonomy_mode).toBe("autonomous");
  });

  it("returns 400 on invalid autonomy_mode", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const res = mockResponse();
    const req = mockRequest('{"autonomy_mode":"banana"}');
    await handleCreateDaemonSession(pool, bindings, req as never, res as never, () => mockAgentSession() as never, "supervised", PROJECT_ID, makeResolver());
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
    await handleCreateDaemonSession(pool, bindings, req1 as never, res1 as never, () => agent as never, "supervised", PROJECT_ID, resolver);
    const s = pool.get(JSON.parse(res1._written[res1._written.length - 1] as string).session_id);
    if (s) s.busy = true;
    const res2 = mockResponse();
    const req2 = mockRequest("");
    await handleCreateDaemonSession(pool, bindings, req2 as never, res2 as never, () => mockAgentSession() as never, "supervised", PROJECT_ID, resolver);
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
      PROJECT_ID,
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
    bindings.put("s-prior", "conv-prior", PROJECT_ID);
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
      PROJECT_ID,
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
      PROJECT_ID,
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
      PROJECT_ID,
      makeResolver(new Set()),
    );
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it("returns 409 when session_id is already live", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const resolver = makeResolver();
    bindings.put("s-live", "conv-live", PROJECT_ID);
    const conversations = new Set(["conv-live"]);
    const res0 = mockResponse();
    await handleCreateDaemonSession(
      pool,
      bindings,
      mockRequest('{"session_id":"s-live"}') as never,
      res0 as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
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
      PROJECT_ID,
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
    const session = pool.create(() => agent as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    const req = mockRequest('{}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, session.id);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it("returns 409 when session is busy", async () => {
    const pool = makePool();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    session.busy = true;
    const req = mockRequest('{"message":"hi"}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, session.id);
    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
  });

  it("streams SSE response for valid session", async () => {
    const pool = makePool();
    const agent = mockAgentSession({ status: "done" });
    const session = pool.create(() => agent as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
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
    const session = pool.create(() => agent as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    const req = mockRequest('{"message":"hi"}');
    const res = mockResponse();
    await handleDaemonChat(pool, req as never, res as never, session.id);
    expect(session.busy).toBe(false);
    const written = res._written.join("");
    expect(written).toContain("event: error");
  });

  it("streams active turn events to session event subscribers", async () => {
    const pool = makePool();
    let releaseSend!: () => void;
    const sendCanContinue = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const session = pool.create((transport) => ({
      send: vi.fn(async () => {
        await sendCanContinue;
        transport.emit({ type: "text", content: "hello subscriber" });
        return "subscriber final";
      }),
      cancelActiveTurn: vi.fn(),
      close: vi.fn(),
      getAutonomyMode: vi.fn(() => "supervised"),
      setAutonomyMode: vi.fn(),
      getGuardrailsSnapshot: vi.fn(() => ({ id: "gr_test", generation: 1, tools: {} })),
      replaceGuardrailsConfig: vi.fn(() => ({ changed: false })),
    }) as never, "supervised", CONV_ID, { projectId: PROJECT_ID });

    const chatPromise = handleDaemonChat(
      pool,
      mockRequest('{"message":"hello"}') as never,
      mockResponse() as never,
      session.id,
    );
    await waitFor(() => session.busy);

    const subscriberRes = mockResponse();
    handleDaemonChatEvents(pool, mockRequest() as never, subscriberRes as never, session.id);
    releaseSend();
    await chatPromise;

    const written = subscriberRes._written.join("");
    expect(written).toContain("event: session");
    expect(written).toContain("event: text");
    expect(written).toContain("hello subscriber");
    expect(written).toContain("event: done");
    expect(written).toContain("subscriber final");
    expect(subscriberRes.end).toHaveBeenCalled();
  });

  it("rejects session event subscriptions when the task is idle", () => {
    const pool = makePool();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    const res = mockResponse();

    handleDaemonChatEvents(pool, mockRequest() as never, res as never, session.id);

    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
    expect(res._written.join("")).toContain("Session is not active");
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("predicate did not become true");
}
