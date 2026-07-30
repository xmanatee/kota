import { describe, expect, it, vi } from "vitest";
import { AgentSession, MockWebSocket, makeBot, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
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
