import { describe, expect, it, vi } from "vitest";
import type { ToolApprovalResolver } from "#core/tools/tool-runner.js";
import {
  handleDaemonChat,
  handleDaemonChatEvents,
  handleResolveDaemonChatApproval,
  readChatBody,
} from "./daemon-chat-handlers.js";
import {
  CONV_ID,
  makePool,
  mockAgentSession,
  mockRequest,
  mockResponse,
  SCOPE_ID,
} from "./daemon-chat-test-support.integration.js";

describe("readChatBody", () => {
  it("parses valid JSON", async () => {
    await expect(readChatBody(mockRequest('{"message":"hello"}') as never))
      .resolves.toEqual({ message: "hello" });
  });

  it("returns an empty object for an empty body", async () => {
    await expect(readChatBody(mockRequest("") as never)).resolves.toEqual({});
  });

  it("rejects invalid JSON", async () => {
    await expect(readChatBody(mockRequest("{not json}") as never)).rejects.toThrow("Invalid JSON");
  });
});

describe("handleDaemonChat", () => {
  it("returns 404 when the session is absent", async () => {
    const res = mockResponse();
    await handleDaemonChat(
      makePool(),
      mockRequest('{"message":"hi"}') as never,
      res as never,
      "nope",
    );
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  });

  it("returns 400 when the message is missing", async () => {
    const pool = makePool();
    const session = pool.create(
      () => mockAgentSession() as never,
      "supervised",
      CONV_ID,
      { scopeId: SCOPE_ID },
    );
    const res = mockResponse();
    await handleDaemonChat(pool, mockRequest("{}") as never, res as never, session.id);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
  });

  it("returns 409 when the session is busy", async () => {
    const pool = makePool();
    const session = pool.create(
      () => mockAgentSession() as never,
      "supervised",
      CONV_ID,
      { scopeId: SCOPE_ID },
    );
    session.busy = true;
    const res = mockResponse();
    await handleDaemonChat(
      pool,
      mockRequest('{"message":"hi"}') as never,
      res as never,
      session.id,
    );
    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
  });

  it("streams a completed session response", async () => {
    const pool = makePool();
    const agent = mockAgentSession({ status: "done" });
    const session = pool.create(() => agent as never, "supervised", CONV_ID, {
      scopeId: SCOPE_ID,
    });
    const res = mockResponse();
    await handleDaemonChat(
      pool,
      mockRequest('{"message":"hello"}') as never,
      res as never,
      session.id,
    );
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
    expect(res._written.join("")).toContain("event: done");
    expect(agent.send).toHaveBeenCalledWith("hello");
    expect(session.busy).toBe(false);
  });

  it("resets busy state and streams agent failures", async () => {
    const pool = makePool();
    const agent = {
      send: vi.fn(async () => { throw new Error("agent failed"); }),
      close: vi.fn(),
    };
    const session = pool.create(() => agent as never, "supervised", CONV_ID, {
      scopeId: SCOPE_ID,
    });
    const res = mockResponse();
    await handleDaemonChat(
      pool,
      mockRequest('{"message":"hi"}') as never,
      res as never,
      session.id,
    );
    expect(session.busy).toBe(false);
    expect(res._written.join("")).toContain("event: error");
  });

  it("streams active turn events to subscribers", async () => {
    const pool = makePool();
    let releaseSend!: () => void;
    const sendCanContinue = new Promise<void>((resolve) => { releaseSend = resolve; });
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
    }) as never, "supervised", CONV_ID, { scopeId: SCOPE_ID });

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
    expect(written).toContain("hello subscriber");
    expect(written).toContain("subscriber final");
    expect(subscriberRes.end).toHaveBeenCalled();
  });

  it("renders safe input and context and requires the exact review receipt", async () => {
    const pool = makePool();
    const agent = {
      clientApprovalResolver: undefined as ToolApprovalResolver | undefined,
      send: vi.fn(async () => {
        if (!agent.clientApprovalResolver) throw new Error("client approval resolver missing");
        const decision = await agent.clientApprovalResolver({
          id: "approval-1",
          toolUseId: "tool-1",
          toolName: "shell",
          input: {
            command: "curl -H 'Authorization: token command-secret' /srv/deploy --target production",
            API_KEY: "field-secret",
            nested: { safe: "/srv/project" },
          },
          risk: "dangerous",
          reason: "writes external state",
          sessionId: "session-1",
          timeoutMs: 120_000,
          context: "User: deploy /srv/project with token=context-secret",
        });
        return decision.outcome;
      }),
      cancelActiveTurn: vi.fn(),
      close: vi.fn(),
      getAutonomyMode: vi.fn(() => "supervised"),
      setAutonomyMode: vi.fn(),
      getGuardrailsSnapshot: vi.fn(() => ({ id: "gr_test", generation: 1, tools: {} })),
      replaceGuardrailsConfig: vi.fn(() => ({ changed: false })),
      setClientApprovalResolver: vi.fn((resolver: ToolApprovalResolver | undefined) => {
        agent.clientApprovalResolver = resolver;
      }),
    };
    const session = pool.create(() => agent as never, "supervised", CONV_ID, {
      scopeId: SCOPE_ID,
    });
    const res = mockResponse();
    const chatPromise = handleDaemonChat(
      pool,
      mockRequest('{"message":"deploy","client_approval":true}') as never,
      res as never,
      session.id,
    );
    await waitFor(() => res._written.join("").includes("event: approval_request"));

    const dataLine = res._written.join("").split("\n")
      .find((line) => line.startsWith("data:") && line.includes('"approval_id"'));
    const review = JSON.parse(dataLine?.slice("data:".length).trim() ?? "") as {
      input: { command: string; API_KEY: string; nested: { safe: string } };
      context: string;
      review_digest: string;
    };
    expect(review.input).toEqual({
      command: "curl -H 'Authorization: [redacted]' /srv/deploy --target production",
      API_KEY: "[redacted]",
      nested: { safe: "/srv/project" },
    });
    expect(review.context).toBe("User: deploy /srv/project with token=[redacted]");
    expect(review.review_digest).toMatch(/^[a-f0-9]{64}$/);

    const missingReceipt = mockResponse();
    await handleResolveDaemonChatApproval(
      pool,
      mockRequest('{"outcome":"allow"}') as never,
      missingReceipt as never,
      session.id,
      "approval-1",
    );
    expect(missingReceipt.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(session.pendingClientApprovals.has("approval-1")).toBe(true);

    const staleReceipt = mockResponse();
    await handleResolveDaemonChatApproval(
      pool,
      mockRequest(JSON.stringify({ outcome: "allow", review_digest: "0".repeat(64) })) as never,
      staleReceipt as never,
      session.id,
      "approval-1",
    );
    expect(staleReceipt.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
    expect(session.pendingClientApprovals.has("approval-1")).toBe(true);

    const exactReceipt = mockResponse();
    await handleResolveDaemonChatApproval(
      pool,
      mockRequest(JSON.stringify({ outcome: "allow", review_digest: review.review_digest })) as never,
      exactReceipt as never,
      session.id,
      "approval-1",
    );
    expect(exactReceipt.writeHead).toHaveBeenCalledWith(204);
    await chatPromise;
  });

  it("rejects event subscriptions while idle", () => {
    const pool = makePool();
    const session = pool.create(
      () => mockAgentSession() as never,
      "supervised",
      CONV_ID,
      { scopeId: SCOPE_ID },
    );
    const res = mockResponse();
    handleDaemonChatEvents(pool, mockRequest() as never, res as never, session.id);
    expect(res.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("predicate did not become true");
}
