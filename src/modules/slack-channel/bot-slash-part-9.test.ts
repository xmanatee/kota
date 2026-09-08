import { describe, expect, it, vi } from "vitest";
import { AgentSession, MockWebSocket, makeBot, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("slash commands", () => {
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
          team_id: "T-TEST",
          event: { type: "message", text: "hello bot", user: "U-FREE", channel: "D-FREE", channel_type: "im" },
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
