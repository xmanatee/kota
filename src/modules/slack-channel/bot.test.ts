import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackBot } from "./bot.js";

// Mock external dependencies at module level
vi.mock("./client.js", () => {
  const SlackTransport = vi.fn(function (this: Record<string, unknown>) {
    this.emit = vi.fn();
    this.flush = vi.fn().mockResolvedValue(undefined);
    this.getBuffer = vi.fn().mockReturnValue("");
  });
  return {
    callSlackApi: vi.fn().mockResolvedValue({}),
    openSocketModeUrl: vi.fn().mockResolvedValue("wss://fake.slack.com/ws"),
    SlackTransport,
    RECONNECT_DELAY_MS: 0,
  };
});

vi.mock("#core/daemon/approval-queue.js", () => ({
  getApprovalQueue: vi.fn(() => ({
    approve: vi.fn((id: string) => ({ id, tool: "shell", status: "approved" })),
    reject: vi.fn((id: string) => ({ id, tool: "shell", status: "rejected" })),
  })),
}));

vi.mock("#core/loop/loop.js", () => {
  const AgentSession = vi.fn(function (this: Record<string, unknown>) {
    this.send = vi.fn().mockResolvedValue("");
    this.close = vi.fn();
  });
  return { AgentSession };
});

vi.mock("#core/loop/transport.js", () => {
  const NullTransport = vi.fn(function (this: Record<string, unknown>) {
    this.emit = vi.fn();
  });
  const ProxyTransport = vi.fn(function (this: Record<string, unknown>) {
    this.target = null;
    this.emit = vi.fn();
  });
  return { NullTransport, ProxyTransport };
});

import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { AgentSession } from "#core/loop/loop.js";
import { callSlackApi, openSocketModeUrl } from "./client.js";

const mockedCallSlackApi = vi.mocked(callSlackApi);
const mockedOpenSocketModeUrl = vi.mocked(openSocketModeUrl);
const mockedGetApprovalQueue = vi.mocked(getApprovalQueue);

function makeBot(overrides?: Partial<ConstructorParameters<typeof SlackBot>[0]>) {
  return new SlackBot({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    notifyChannel: "C-NOTIFY",
    ...overrides,
  });
}

// --- WebSocket mock ---

type WsListener = (event: { data?: string; code?: number }) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  private listeners: Record<string, WsListener[]> = {};
  readyState = 1; // OPEN

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // Fire open asynchronously
    queueMicrotask(() => this.fire("open", {}));
  }

  addEventListener(event: string, handler: WsListener) {
    (this.listeners[event] ??= []).push(handler);
  }

  send = vi.fn();
  close = vi.fn().mockImplementation(() => {
    this.fire("close", { code: 1000 });
  });

  fire(event: string, data: Record<string, unknown>) {
    for (const handler of this.listeners[event] ?? []) {
      handler(data as never);
    }
  }

  simulateMessage(payload: unknown) {
    this.fire("message", { data: JSON.stringify(payload) });
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

describe("SlackBot", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.stubGlobal("WebSocket", MockWebSocket);
    mockedCallSlackApi.mockReset();
    mockedCallSlackApi.mockResolvedValue({} as never);
    mockedOpenSocketModeUrl.mockReset();
    mockedOpenSocketModeUrl.mockResolvedValue("wss://fake.slack.com/ws");
    vi.mocked(AgentSession).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("constructs with options", () => {
    const bot = makeBot();
    expect(bot).toBeDefined();
  });

  it("stop is safe to call before start", () => {
    const bot = makeBot();
    expect(() => bot.stop()).not.toThrow();
  });

  // --- postApproval ---

  describe("postApproval", () => {
    it("posts Block Kit approval message to notify channel", async () => {
      const bot = makeBot();
      await bot.postApproval("abc123", "shell", "high", "Runs commands");
      expect(mockedCallSlackApi).toHaveBeenCalledWith(
        "xoxb-test",
        "chat.postMessage",
        expect.objectContaining({
          channel: "C-NOTIFY",
          text: "Approval required: shell",
          blocks: expect.arrayContaining([
            expect.objectContaining({ type: "section" }),
            expect.objectContaining({
              type: "actions",
              elements: expect.arrayContaining([
                expect.objectContaining({ action_id: "approve:abc123", value: "approve:abc123" }),
                expect.objectContaining({ action_id: "reject:abc123", value: "reject:abc123" }),
              ]),
            }),
          ]),
        }),
      );
    });

    it("does nothing when notifyChannel is not configured", async () => {
      const bot = makeBot({ notifyChannel: undefined });
      await bot.postApproval("abc", "shell", "high", "reason");
      expect(mockedCallSlackApi).not.toHaveBeenCalled();
    });
  });

  // --- Socket Mode payload routing ---

  describe("handleSocketPayload (via start)", () => {
    it("acknowledges envelopes by sending envelope_id back", async () => {
      const bot = makeBot();
      const startPromise = bot.start();

      // Wait for WebSocket to be created and opened
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-123",
        payload: { event: { type: "message", text: "hi", user: "U1", channel: "D1" } },
      });

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ envelope_id: "env-123" }));

      bot.stop();
      await startPromise.catch(() => {}); // may reject on close
    });

    it("ignores hello frames", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({ type: "hello", num_connections: 1 });

      // No envelope ack sent
      expect(ws.send).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("closes WebSocket on disconnect frame", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({ type: "disconnect", reason: "server_restart" });

      expect(ws.close).toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("routes events_api message to handleMessage (creates session)", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-1",
        payload: { event: { type: "message", text: "hello bot", user: "U1", channel: "D1" } },
      });

      // Give async handleMessage time to run
      await vi.waitFor(() => expect(AgentSession).toHaveBeenCalled());

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("filters bot messages (ignores messages with bot_id)", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-1",
        payload: {
          event: { type: "message", text: "bot reply", user: "U1", channel: "D1", bot_id: "B1" },
        },
      });

      // AgentSession should NOT be created for bot messages
      await new Promise((r) => setTimeout(r, 50));
      expect(AgentSession).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("filters message subtypes (e.g. message_changed)", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-1",
        payload: {
          event: { type: "message", text: "edited", user: "U1", channel: "D1", subtype: "message_changed" },
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(AgentSession).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("routes interactive block_actions to handleBlockAction", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-2",
        payload: {
          type: "block_actions",
          actions: [{ action_id: "approve:abc123", value: "approve:abc123" }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await vi.waitFor(() => expect(mockedGetApprovalQueue).toHaveBeenCalled());

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("parses interactive payload when it arrives as a JSON string", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const interactivePayload = {
        type: "block_actions",
        actions: [{ action_id: "reject:xyz", value: "reject:xyz" }],
        user: { id: "U1", name: "Test" },
        channel: { id: "C1" },
        message: { ts: "1234.5678" },
      };

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-3",
        payload: JSON.stringify(interactivePayload),
      });

      await vi.waitFor(() => expect(mockedGetApprovalQueue).toHaveBeenCalled());

      bot.stop();
      await startPromise.catch(() => {});
    });
  });

  // --- handleMessage: busy user ---

  describe("message handling", () => {
    it("sends busy message when user already has an in-flight request", async () => {
      // Make agent.send block to simulate a long-running request
      const sendBlocker = new Promise<string>(() => {}); // never resolves
      vi.mocked(AgentSession).mockImplementation(
        function (this: Record<string, unknown>) {
          this.send = vi.fn().mockReturnValue(sendBlocker);
          this.close = vi.fn();
        } as never,
      );

      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      // First message — starts processing (blocks)
      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-1",
        payload: { event: { type: "message", text: "msg1", user: "U1", channel: "D1" } },
      });

      // Let the first message start processing
      await new Promise((r) => setTimeout(r, 50));

      // Second message from same user — should get busy response
      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-2",
        payload: { event: { type: "message", text: "msg2", user: "U1", channel: "D1" } },
      });

      await vi.waitFor(() =>
        expect(mockedCallSlackApi).toHaveBeenCalledWith(
          "xoxb-test",
          "chat.postMessage",
          expect.objectContaining({ text: expect.stringContaining("Still working") }),
        ),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });
  });

  // --- handleBlockAction ---

  describe("handleBlockAction", () => {
    it("calls queue.approve and updates message on approve action", async () => {
      const mockApprove = vi.fn().mockReturnValue({ id: "abc", tool: "shell", status: "approved" });
      mockedGetApprovalQueue.mockReturnValue({ approve: mockApprove, reject: vi.fn() } as never);

      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-1",
        payload: {
          type: "block_actions",
          actions: [{ action_id: "approve:abc", value: "approve:abc" }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await vi.waitFor(() => expect(mockApprove).toHaveBeenCalledWith("abc"));

      // Verify message update
      await vi.waitFor(() =>
        expect(mockedCallSlackApi).toHaveBeenCalledWith(
          "xoxb-test",
          "chat.update",
          expect.objectContaining({
            channel: "C1",
            ts: "1234.5678",
            text: expect.stringContaining("Approved"),
          }),
        ),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("calls queue.reject and updates message on reject action", async () => {
      const mockReject = vi.fn().mockReturnValue({ id: "def", tool: "write", status: "rejected" });
      mockedGetApprovalQueue.mockReturnValue({ approve: vi.fn(), reject: mockReject } as never);

      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-1",
        payload: {
          type: "block_actions",
          actions: [{ action_id: "reject:def", value: "reject:def" }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await vi.waitFor(() => expect(mockReject).toHaveBeenCalledWith("def"));

      await vi.waitFor(() =>
        expect(mockedCallSlackApi).toHaveBeenCalledWith(
          "xoxb-test",
          "chat.update",
          expect.objectContaining({
            text: expect.stringContaining("Rejected"),
          }),
        ),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("shows 'not found' text when approval ID is already resolved", async () => {
      const mockApprove = vi.fn().mockReturnValue(null); // already resolved
      mockedGetApprovalQueue.mockReturnValue({ approve: mockApprove, reject: vi.fn() } as never);

      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-1",
        payload: {
          type: "block_actions",
          actions: [{ action_id: "approve:gone", value: "approve:gone" }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await vi.waitFor(() =>
        expect(mockedCallSlackApi).toHaveBeenCalledWith(
          "xoxb-test",
          "chat.update",
          expect.objectContaining({
            text: expect.stringContaining("not found or already resolved"),
          }),
        ),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("skips actions without a recognized verb", async () => {
      mockedGetApprovalQueue.mockReturnValue({
        approve: vi.fn(),
        reject: vi.fn(),
      } as never);

      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-1",
        payload: {
          type: "block_actions",
          actions: [{ action_id: "unknown:abc", value: "unknown:abc" }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      // chat.update should NOT be called for unknown verbs
      expect(mockedCallSlackApi).not.toHaveBeenCalledWith(
        expect.any(String),
        "chat.update",
        expect.anything(),
      );

      bot.stop();
      await startPromise.catch(() => {});
    });
  });

  // --- Session management ---

  describe("session management", () => {
    it("reuses session for the same user across messages", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      // First message
      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-1",
        payload: { event: { type: "message", text: "msg1", user: "U1", channel: "D1" } },
      });
      await vi.waitFor(() => expect(AgentSession).toHaveBeenCalledTimes(1));

      // Wait for first message to finish processing
      await new Promise((r) => setTimeout(r, 50));

      // Second message from same user
      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-2",
        payload: { event: { type: "message", text: "msg2", user: "U1", channel: "D1" } },
      });
      await new Promise((r) => setTimeout(r, 50));

      // Should reuse session — only 1 AgentSession created
      expect(AgentSession).toHaveBeenCalledTimes(1);

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("creates separate sessions for different users", async () => {
      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-1",
        payload: { event: { type: "message", text: "hi", user: "U1", channel: "D1" } },
      });
      await vi.waitFor(() => expect(AgentSession).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 50));

      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-2",
        payload: { event: { type: "message", text: "hi", user: "U2", channel: "D2" } },
      });
      await vi.waitFor(() => expect(AgentSession).toHaveBeenCalledTimes(2));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("stop closes all sessions", async () => {
      const closeFn = vi.fn();
      vi.mocked(AgentSession).mockImplementation(
        function (this: Record<string, unknown>) {
          this.send = vi.fn().mockResolvedValue("");
          this.close = closeFn;
        } as never,
      );

      const bot = makeBot();
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      // Create two sessions
      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-1",
        payload: { event: { type: "message", text: "hi", user: "U1", channel: "D1" } },
      });
      await new Promise((r) => setTimeout(r, 50));
      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-2",
        payload: { event: { type: "message", text: "hi", user: "U2", channel: "D2" } },
      });
      await new Promise((r) => setTimeout(r, 50));

      bot.stop();
      expect(closeFn).toHaveBeenCalledTimes(2);

      await startPromise.catch(() => {});
    });
  });
});
