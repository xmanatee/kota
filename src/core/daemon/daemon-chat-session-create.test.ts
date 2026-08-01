import { describe, expect, it, vi } from "vitest";
import { handleCreateDaemonSession } from "./daemon-chat-session-create.js";
import {
  makeBindingStore,
  makePool,
  makeResolver,
  mockAgentSession,
  mockRequest,
  mockResponse,
  PROJECT_ID,
} from "./daemon-chat-test-support.integration.js";

const admitHostedScope = () => ({ ok: true as const });

describe("handleCreateDaemonSession", () => {
  it("creates a session and returns its session and conversation identities", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const resolver = makeResolver();
    const res = mockResponse();
    await handleCreateDaemonSession(
      pool,
      bindings,
      mockRequest("") as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      resolver,
      admitHostedScope,
    );
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
    const body = JSON.parse(res._written.at(-1) ?? "") as {
      session_id: string;
      autonomy_mode: string;
      conversation_id: string;
    };
    expect(body.autonomy_mode).toBe("supervised");
    expect(bindings.getBySession(body.session_id)?.conversationId).toBe(body.conversation_id);
  });

  it("rejects non-empty client-supplied mcp_servers before creating a session", async () => {
    const pool = makePool();
    const res = mockResponse();
    const makeAgent = vi.fn(() => mockAgentSession() as never);
    await handleCreateDaemonSession(
      pool,
      makeBindingStore(),
      mockRequest(JSON.stringify({
        mcp_servers: {
          fs: {
            type: "stdio",
            command: "/usr/bin/env",
            args: ["node"],
            env: { API_KEY: "secret-token" },
          },
        },
      })) as never,
      res as never,
      makeAgent,
      "supervised",
      PROJECT_ID,
      makeResolver(),
      admitHostedScope,
    );
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(makeAgent).not.toHaveBeenCalled();
    expect(res._written.join("")).toContain("client-supplied mcp_servers are not supported");
    expect(res._written.join("")).not.toContain("secret-token");
  });

  it("rejects non-object mcp_servers", async () => {
    const pool = makePool();
    const res = mockResponse();
    await handleCreateDaemonSession(
      pool,
      makeBindingStore(),
      mockRequest(JSON.stringify({ mcp_servers: [] })) as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      makeResolver(),
      admitHostedScope,
    );
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(res._written.join("")).toContain("mcp_servers must be an object");
  });

  it("honors a request autonomy mode", async () => {
    const res = mockResponse();
    await handleCreateDaemonSession(
      makePool(),
      makeBindingStore(),
      mockRequest('{"autonomy_mode":"autonomous"}') as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      makeResolver(),
      admitHostedScope,
    );
    expect(JSON.parse(res._written.at(-1) ?? "").autonomy_mode).toBe("autonomous");
  });

  it("requires a mode when no default is configured", async () => {
    const pool = makePool();
    const res = mockResponse();
    await handleCreateDaemonSession(
      pool,
      makeBindingStore(),
      mockRequest("") as never,
      res as never,
      () => mockAgentSession() as never,
      undefined,
      PROJECT_ID,
      makeResolver(),
      admitHostedScope,
    );
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(pool.size).toBe(0);
  });

  it("accepts a request mode when no default is configured", async () => {
    const res = mockResponse();
    await handleCreateDaemonSession(
      makePool(),
      makeBindingStore(),
      mockRequest('{"autonomy_mode":"autonomous"}') as never,
      res as never,
      () => mockAgentSession() as never,
      undefined,
      PROJECT_ID,
      makeResolver(),
      admitHostedScope,
    );
    expect(res.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
  });

  it("rejects an invalid autonomy mode", async () => {
    const pool = makePool();
    const res = mockResponse();
    await handleCreateDaemonSession(
      pool,
      makeBindingStore(),
      mockRequest('{"autonomy_mode":"banana"}') as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      makeResolver(),
      admitHostedScope,
    );
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(pool.size).toBe(0);
  });

  it("returns 503 when the pool is full and all sessions are busy", async () => {
    const pool = makePool({ maxSessions: 1 });
    const bindings = makeBindingStore();
    const resolver = makeResolver();
    const first = mockResponse();
    await handleCreateDaemonSession(
      pool,
      bindings,
      mockRequest("") as never,
      first as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      resolver,
      admitHostedScope,
    );
    const live = pool.get(JSON.parse(first._written.at(-1) ?? "").session_id);
    if (live) live.busy = true;
    const second = mockResponse();
    await handleCreateDaemonSession(
      pool,
      bindings,
      mockRequest("") as never,
      second as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      resolver,
      admitHostedScope,
    );
    expect(second.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
  });

  it("resumes an existing conversation", async () => {
    const bindings = makeBindingStore();
    const seen: string[] = [];
    const res = mockResponse();
    await handleCreateDaemonSession(
      makePool(),
      bindings,
      mockRequest('{"conversation_id":"existing-conv"}') as never,
      res as never,
      (_transport, _mode, resumeConversation) => {
        seen.push(resumeConversation ?? "");
        return mockAgentSession() as never;
      },
      "supervised",
      PROJECT_ID,
      makeResolver(new Set(["existing-conv"])),
      admitHostedScope,
    );
    const body = JSON.parse(res._written.at(-1) ?? "") as {
      conversation_id: string;
      session_id: string;
    };
    expect(seen).toEqual(["existing-conv"]);
    expect(bindings.getByConversation("existing-conv")?.sessionId).toBe(body.session_id);
  });

  it("wakes a prior session from its persisted binding", async () => {
    const bindings = makeBindingStore();
    bindings.put("s-prior", "conv-prior", PROJECT_ID);
    const res = mockResponse();
    await handleCreateDaemonSession(
      makePool(),
      bindings,
      mockRequest('{"session_id":"s-prior"}') as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      makeResolver(new Set(["conv-prior"])),
      admitHostedScope,
    );
    const body = JSON.parse(res._written.at(-1) ?? "");
    expect(body).toMatchObject({ session_id: "s-prior", conversation_id: "conv-prior" });
  });

  it("returns 404 when a session has no binding", async () => {
    const res = mockResponse();
    await handleCreateDaemonSession(
      makePool(),
      makeBindingStore(),
      mockRequest('{"session_id":"unknown"}') as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      makeResolver(),
      admitHostedScope,
    );
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it("returns 404 when a conversation is absent from history", async () => {
    const res = mockResponse();
    await handleCreateDaemonSession(
      makePool(),
      makeBindingStore(),
      mockRequest('{"conversation_id":"missing"}') as never,
      res as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      makeResolver(new Set()),
      admitHostedScope,
    );
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it("returns 409 when a requested session is already live", async () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    bindings.put("s-live", "conv-live", PROJECT_ID);
    const resolver = makeResolver(new Set(["conv-live"]));
    const first = mockResponse();
    await handleCreateDaemonSession(
      pool,
      bindings,
      mockRequest('{"session_id":"s-live"}') as never,
      first as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      resolver,
      admitHostedScope,
    );
    const second = mockResponse();
    await handleCreateDaemonSession(
      pool,
      bindings,
      mockRequest('{"session_id":"s-live"}') as never,
      second as never,
      () => mockAgentSession() as never,
      "supervised",
      PROJECT_ID,
      resolver,
      admitHostedScope,
    );
    expect(second.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
  });

});
