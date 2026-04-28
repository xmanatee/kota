import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnswerClient,
  CaptureClient,
  HistoryClient,
  KnowledgeClient,
  MemoryClient,
  RecallClient,
  RepoTasksClient,
} from "#core/server/kota-client.js";
import { renderHistorySearchPlain } from "#modules/history/render.js";
import { renderKnowledgeSearchPlain } from "#modules/knowledge/render.js";
import { renderMemorySearchPlain } from "#modules/memory/render.js";
import { renderRepoTaskSearchPlain } from "#modules/repo-tasks/render.js";
import { SlackBot } from "./bot.js";
import type {
  AttentionSnapshotClient,
  DigestSnapshotClient,
} from "./commands.js";

// Mock external dependencies at module level
vi.mock("./client.js", async () => {
  const actual =
    await vi.importActual<typeof import("./client.js")>("./client.js");
  const SlackTransport = vi.fn(function (this: Record<string, unknown>) {
    this.emit = vi.fn();
    this.flush = vi.fn().mockResolvedValue(undefined);
    this.getBuffer = vi.fn().mockReturnValue("");
  });
  return {
    ...actual,
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

function makeStubClients(): {
  recall: RecallClient;
  answer: AnswerClient;
  capture: CaptureClient;
  memory: MemoryClient;
  knowledge: KnowledgeClient;
  history: HistoryClient;
  tasks: RepoTasksClient;
  attention: AttentionSnapshotClient;
  digest: DigestSnapshotClient;
} {
  return {
    recall: { recall: vi.fn() },
    answer: { answer: vi.fn(), log: vi.fn(), show: vi.fn() },
    capture: { capture: vi.fn() },
    memory: {
      list: vi.fn(),
      add: vi.fn(),
      delete: vi.fn(),
      search: vi.fn(),
      reindex: vi.fn(),
    },
    knowledge: {
      list: vi.fn(),
      show: vi.fn(),
      search: vi.fn(),
      add: vi.fn(),
      delete: vi.fn(),
      reindex: vi.fn(),
    },
    history: {
      list: vi.fn(),
      show: vi.fn(),
      delete: vi.fn(),
      search: vi.fn(),
      reindex: vi.fn(),
    },
    tasks: {
      list: vi.fn(),
      show: vi.fn(),
      move: vi.fn(),
      create: vi.fn(),
      capture: vi.fn(),
      gc: vi.fn(),
      search: vi.fn(),
      reindex: vi.fn(),
    },
    attention: { snapshot: vi.fn().mockReturnValue({ text: "" }) },
    digest: { snapshot: vi.fn().mockReturnValue({ text: "" }) },
  };
}

function makeBot(overrides?: Partial<ConstructorParameters<typeof SlackBot>[0]>) {
  return new SlackBot({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    notifyChannel: "C-NOTIFY",
    autonomyMode: "supervised",
    ...makeStubClients(),
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

  // --- Slash commands: /recall, /answer, /capture, /capture-to-* ---

  describe("slash commands", () => {
    function findPostMessage(channelId: string): Record<string, unknown> | null {
      const calls = mockedCallSlackApi.mock.calls.filter(
        (call) =>
          call[1] === "chat.postMessage" &&
          (call[2] as { channel?: string }).channel === channelId,
      );
      const last = calls[calls.length - 1];
      return last ? (last[2] as Record<string, unknown>) : null;
    }

    async function sendSlashAndAwait(
      channelId: string,
      text: string,
      ws: MockWebSocket,
      envelope: string,
    ): Promise<Record<string, unknown>> {
      ws.simulateMessage({
        type: "events_api",
        envelope_id: envelope,
        payload: {
          event: { type: "message", text, user: "U-SLASH", channel: channelId },
        },
      });
      await vi.waitFor(() => {
        const post = findPostMessage(channelId);
        if (!post) throw new Error("no chat.postMessage yet");
      });
      return findPostMessage(channelId)!;
    }

    it("/recall <query> calls recall.recall and renders the hits", async () => {
      const recallFn = vi.fn().mockResolvedValue({
        ok: true,
        hits: [
          {
            source: "knowledge",
            id: "k1",
            title: "Slack adoption notes",
            score: 0.42,
          },
        ],
      });
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RECALL",
        "/recall slack",
        ws,
        "env-r1",
      );

      expect(recallFn).toHaveBeenCalledWith("slack");
      expect(post.text).toContain("knowledge");
      expect(post.text).toContain("k1");
      expect(post.text).toContain("Slack adoption notes");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/recall surfaces semantic_unavailable as the unconfigured notice", async () => {
      const recallFn = vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RECALL2",
        "/recall anything",
        ws,
        "env-r2",
      );

      expect(post.text).toBe(
        "Cross-store recall is not configured: no contributors are registered.",
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/recall with an empty query replies with a usage hint and skips the call", async () => {
      const recallFn = vi.fn();
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-RECALL3", "/recall", ws, "env-r3");

      expect(post.text).toBe("Usage: /recall <query>");
      expect(recallFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer <query> calls answer.answer and renders the synthesized prose plus citations", async () => {
      const answerFn = vi.fn().mockResolvedValue({
        ok: true,
        answer: "KOTA is a personal knowledge agent. [knowledge:k1]",
        citations: [{ source: "knowledge", id: "k1" }],
        hits: [
          {
            source: "knowledge",
            id: "k1",
            title: "KOTA overview",
            score: 0.91,
          },
        ],
      });
      const bot = makeBot({
        answer: { answer: answerFn, log: vi.fn(), show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-ANSWER",
        "/answer what is kota",
        ws,
        "env-a1",
      );

      expect(answerFn).toHaveBeenCalledWith("what is kota");
      expect(post.text).toContain("KOTA is a personal knowledge agent.");
      expect(post.text).toContain("Citations");
      expect(post.text).toContain("k1");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer surfaces no_hits and synthesis_failed reasons one-to-one", async () => {
      const answerFn = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: "no_hits" })
        .mockResolvedValueOnce({ ok: false, reason: "synthesis_failed" });
      const bot = makeBot({
        answer: { answer: answerFn, log: vi.fn(), show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post1 = await sendSlashAndAwait(
        "D-AN1",
        "/answer foo",
        ws,
        "env-a2",
      );
      expect(post1.text).toBe(
        "No matching sources across the second brain — nothing to synthesize.",
      );

      const post2 = await sendSlashAndAwait(
        "D-AN2",
        "/answer bar",
        ws,
        "env-a3",
      );
      expect(post2.text).toBe(
        "Synthesis failed (model unreachable or unable to cite resolvable sources).",
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer with empty query replies with a usage hint and skips the call", async () => {
      const answerFn = vi.fn();
      const bot = makeBot({
        answer: { answer: answerFn, log: vi.fn(), show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-AN3", "/answer    ", ws, "env-a4");
      expect(post.text).toBe("Usage: /answer <query>");
      expect(answerFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/capture <text> calls capture.capture without a target and renders the success arm", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: true,
        record: { target: "memory", recordId: "mem-42" },
      });
      const bot = makeBot({ capture: { capture: captureFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-CAP",
        "/capture remember to call alice",
        ws,
        "env-c1",
      );

      expect(captureFn).toHaveBeenCalledWith("remember to call alice", undefined);
      expect(post.text).toBe("Captured to memory: mem-42");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/capture-to-tasks dispatches with target=tasks and renders the path-bearing success arm", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: true,
        record: {
          target: "tasks",
          recordId: "task-fix-redirect",
          path: "data/tasks/ready/task-fix-redirect.md",
        },
      });
      const bot = makeBot({ capture: { capture: captureFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-CAP-T",
        "/capture-to-tasks fix the login redirect",
        ws,
        "env-c2",
      );

      expect(captureFn).toHaveBeenCalledWith("fix the login redirect", {
        target: "tasks",
      });
      expect(post.text).toBe(
        "Captured to tasks: task-fix-redirect (data/tasks/ready/task-fix-redirect.md)",
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/capture surfaces ambiguous, no_contributors, and contributor_failed arms", async () => {
      const captureFn = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reason: "ambiguous",
          suggestions: ["memory", "knowledge", "tasks", "inbox"],
        })
        .mockResolvedValueOnce({ ok: false, reason: "no_contributors" })
        .mockResolvedValueOnce({
          ok: false,
          reason: "contributor_failed",
          target: "inbox",
          message: "permission denied",
        });
      const bot = makeBot({ capture: { capture: captureFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post1 = await sendSlashAndAwait(
        "D-CAPF1",
        "/capture something vague",
        ws,
        "env-c3",
      );
      expect(post1.text).toBe(
        "Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.",
      );

      const post2 = await sendSlashAndAwait(
        "D-CAPF2",
        "/capture another",
        ws,
        "env-c4",
      );
      expect(post2.text).toBe(
        "Cross-store capture has no registered contributors.",
      );

      const post3 = await sendSlashAndAwait(
        "D-CAPF3",
        "/capture-to-inbox raw thought",
        ws,
        "env-c5",
      );
      expect(post3.text).toBe("Capture into inbox failed: permission denied");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/capture with empty body short-circuits to the ambiguous body and skips the seam", async () => {
      const captureFn = vi.fn();
      const bot = makeBot({ capture: { capture: captureFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-CAPE", "/capture   ", ws, "env-c6");
      expect(post.text).toBe(
        "Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.",
      );
      expect(captureFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("strips a leading bot-mention prefix and matches the command case-insensitively", async () => {
      const recallFn = vi.fn().mockResolvedValue({ ok: true, hits: [] });
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      await sendSlashAndAwait(
        "D-MEN",
        "<@U987654> /Recall protocols",
        ws,
        "env-mn1",
      );

      expect(recallFn).toHaveBeenCalledWith("protocols");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("does not create a session for a slash command", async () => {
      const recallFn = vi.fn().mockResolvedValue({ ok: true, hits: [] });
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      await sendSlashAndAwait("D-NS1", "/recall x", ws, "env-ns1");

      expect(AgentSession).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/memory <query> calls memory.search and renders the entries", async () => {
      const entries = [
        { id: "mem-1", created: "2026-04-28T06:00:00Z", content: "alice phone" },
      ];
      const searchFn = vi.fn().mockResolvedValue({ ok: true, entries });
      const bot = makeBot({
        memory: {
          list: vi.fn(),
          add: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-MEM",
        "/memory alice",
        ws,
        "env-m1",
      );

      expect(searchFn).toHaveBeenCalledWith("alice", {
        semantic: true,
        limit: 10,
      });
      expect(post.text).toBe(renderMemorySearchPlain(entries));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/memory surfaces semantic_unavailable as the unconfigured notice", async () => {
      const searchFn = vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
      const bot = makeBot({
        memory: {
          list: vi.fn(),
          add: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-MEM2",
        "/memory anything",
        ws,
        "env-m2",
      );
      expect(post.text).toBe(
        "Semantic memory search requires an embedding-backed memory provider.",
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/memory with empty body replies with usage hint and skips the call", async () => {
      const searchFn = vi.fn();
      const bot = makeBot({
        memory: {
          list: vi.fn(),
          add: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-MEM3", "/memory", ws, "env-m3");
      expect(post.text).toBe("Usage: /memory <query>");
      expect(searchFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/memory replies 'No matching memory entries.' when the search returns nothing", async () => {
      const searchFn = vi.fn().mockResolvedValue({ ok: true, entries: [] });
      const bot = makeBot({
        memory: {
          list: vi.fn(),
          add: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-MEM4", "/memory none", ws, "env-m4");
      expect(post.text).toBe("No matching memory entries.");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/knowledge <query> calls knowledge.search and renders the entries", async () => {
      const entries = [
        {
          id: "k-1",
          title: "KOTA overview",
          type: "note",
          tags: [],
          status: "active",
          created: "2026-04-01T00:00:00Z",
          updated: "2026-04-01T00:00:00Z",
          content: "",
          meta: {},
        },
      ];
      const searchFn = vi.fn().mockResolvedValue({ ok: true, entries });
      const bot = makeBot({
        knowledge: {
          list: vi.fn(),
          show: vi.fn(),
          search: searchFn,
          add: vi.fn(),
          delete: vi.fn(),
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-KN",
        "/knowledge kota",
        ws,
        "env-k1",
      );
      expect(searchFn).toHaveBeenCalledWith("kota", {
        semantic: true,
        limit: 10,
      });
      expect(post.text).toBe(renderKnowledgeSearchPlain(entries));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/knowledge with empty body replies with usage hint and skips the call", async () => {
      const searchFn = vi.fn();
      const bot = makeBot({
        knowledge: {
          list: vi.fn(),
          show: vi.fn(),
          search: searchFn,
          add: vi.fn(),
          delete: vi.fn(),
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-KN2", "/knowledge", ws, "env-k2");
      expect(post.text).toBe("Usage: /knowledge <query>");
      expect(searchFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/history <query> calls history.search and renders the conversations", async () => {
      const conversations = [
        {
          id: "h-1",
          title: "Slack ramp",
          createdAt: "2026-04-20T00:00:00Z",
          updatedAt: "2026-04-21T00:00:00Z",
          model: "opus",
          messageCount: 4,
          cwd: "/repo",
        },
      ];
      const searchFn = vi.fn().mockResolvedValue({ ok: true, conversations });
      const bot = makeBot({
        history: {
          list: vi.fn(),
          show: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-HI", "/history slack", ws, "env-h1");
      expect(searchFn).toHaveBeenCalledWith("slack", {
        semantic: true,
        limit: 10,
      });
      expect(post.text).toBe(renderHistorySearchPlain(conversations));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/history with empty body replies with usage hint and skips the call", async () => {
      const searchFn = vi.fn();
      const bot = makeBot({
        history: {
          list: vi.fn(),
          show: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-HI2", "/history", ws, "env-h2");
      expect(post.text).toBe("Usage: /history <query>");
      expect(searchFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/tasks <query> calls tasks.search and renders the hits", async () => {
      const hits = [
        {
          id: "task-foo",
          title: "do foo",
          state: "ready" as const,
          priority: "p2",
          area: "architecture",
          summary: "",
          updatedAt: "2026-04-20T00:00:00Z",
          score: 0.5,
        },
      ];
      const searchFn = vi.fn().mockResolvedValue({ ok: true, tasks: hits });
      const bot = makeBot({
        tasks: {
          list: vi.fn(),
          show: vi.fn(),
          move: vi.fn(),
          create: vi.fn(),
          capture: vi.fn(),
          gc: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-TA", "/tasks foo", ws, "env-t1");
      expect(searchFn).toHaveBeenCalledWith("foo", {
        semantic: true,
        limit: 10,
      });
      expect(post.text).toBe(renderRepoTaskSearchPlain(hits));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/tasks with empty body replies with usage hint and skips the call", async () => {
      const searchFn = vi.fn();
      const bot = makeBot({
        tasks: {
          list: vi.fn(),
          show: vi.fn(),
          move: vi.fn(),
          create: vi.fn(),
          capture: vi.fn(),
          gc: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-TA2", "/tasks", ws, "env-t2");
      expect(post.text).toBe("Usage: /tasks <query>");
      expect(searchFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/attention calls attention.snapshot and posts the rendered text verbatim", async () => {
      const snapshot = vi
        .fn()
        .mockReturnValue({ text: "Attention items:\n- task-foo (ready)" });
      const bot = makeBot({ attention: { snapshot } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-AT", "/attention", ws, "env-at1");
      expect(snapshot).toHaveBeenCalled();
      expect(post.text).toBe("Attention items:\n- task-foo (ready)");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/attention <noise> still triggers the snapshot (body is ignored)", async () => {
      const snapshot = vi
        .fn()
        .mockReturnValue({ text: "All caught up." });
      const bot = makeBot({ attention: { snapshot } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-AT2",
        "/attention now please",
        ws,
        "env-at2",
      );
      expect(snapshot).toHaveBeenCalledTimes(1);
      expect(post.text).toBe("All caught up.");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/digest calls digest.snapshot and posts the rendered text verbatim", async () => {
      const snapshot = vi
        .fn()
        .mockReturnValue({ text: "Daily digest:\nbuilder: 3 runs" });
      const bot = makeBot({ digest: { snapshot } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-DI", "/digest", ws, "env-di1");
      expect(snapshot).toHaveBeenCalled();
      expect(post.text).toBe("Daily digest:\nbuilder: 3 runs");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("free-form (non-slash) DMs still route to the per-user session", async () => {
      const recallFn = vi.fn();
      const captureFn = vi.fn();
      const bot = makeBot({
        recall: { recall: recallFn },
        capture: { capture: captureFn },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-ff1",
        payload: {
          event: { type: "message", text: "hello bot", user: "U-FREE", channel: "D-FREE" },
        },
      });

      await vi.waitFor(() => expect(AgentSession).toHaveBeenCalled());
      expect(recallFn).not.toHaveBeenCalled();
      expect(captureFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });
  });
});
