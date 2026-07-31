import { describe, expect, it, vi } from "vitest";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import { AgentSession, approvalProjection, MockWebSocket, makeBot, makeStubClients, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
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

    it("emits configured automation messages as inbound signals and skips the session", async () => {
      const events = { emit: vi.fn() };
      const bot = makeBot({
        inboundSignals: {
          projectId: "project-slack",
          config: { prefixes: ["!task"], trustedUserIds: ["U1"] },
          events,
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-auto",
        payload: {
          team_id: "T1",
          event_id: "Ev1",
          event_time: 1770000000,
          event: {
            type: "message",
            text: "!task capture deploy regression",
            user: "U1",
            channel: "D1",
            ts: "1770000000.100000",
          },
        },
      });

      await vi.waitFor(() => expect(events.emit).toHaveBeenCalled());
      expect(events.emit).toHaveBeenCalledWith(
        inboundSignalReceived,
        expect.objectContaining({
          projectId: "project-slack",
          provider: "slack",
          channel: "slack.message",
          actor: expect.objectContaining({ trust: "trusted" }),
          body: expect.objectContaining({
            kind: "message",
            text: "capture deploy regression",
          }),
        }),
      );
      expect(AgentSession).not.toHaveBeenCalled();

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
      const approve = vi.fn(async (id) => ({
        ok: true as const,
        approval: { ...approvalProjection(id), status: "approved" as const },
        resolution: {
          kind: "tool_execution" as const,
          execution: {
            status: "succeeded" as const,
            output: { redacted: true as const, reason: "tool-io" as const },
          },
        },
      }));
      const bot = makeBot({
        approvals: { ...makeStubClients().approvals, approve },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "interactive",
        envelope_id: "env-2",
        payload: {
          type: "block_actions",
          actions: [{
            action_id: "approve:abc123",
            value: `approve:abc123:${"a".repeat(64)}`,
          }],
          user: { id: "U1", name: "Test" },
          channel: { id: "C1" },
          message: { ts: "1234.5678" },
        },
      });

      await vi.waitFor(() => expect(approve).toHaveBeenCalledWith(
        "abc123",
        "a".repeat(64),
      ));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("parses interactive payload when it arrives as a JSON string", async () => {
      const reject = vi.fn(async (id) => ({
        ok: true as const,
        approval: { ...approvalProjection(id), status: "rejected" as const },
      }));
      const bot = makeBot({
        approvals: { ...makeStubClients().approvals, reject },
      });
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

      await vi.waitFor(() => expect(reject).toHaveBeenCalledWith("xyz"));

      bot.stop();
      await startPromise.catch(() => {});
    });
  });

  // --- handleMessage: busy user ---

});
