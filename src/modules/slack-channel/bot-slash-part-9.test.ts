import { describe, expect, it, vi } from "vitest";
import { AgentSession, MockWebSocket, makeBot, mockedCallSlackApi, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("slash commands", () => {
    it("unknown slash commands fall through (no /retract umbrella, no /unknown reply)", async () => {
      const retractFn = vi.fn();
      const bot = makeBot({ retract: { retract: retractFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      ws.simulateMessage({
        type: "events_api",
        envelope_id: "env-unk1",
        payload: {
          event: {
            type: "message",
            text: "/retract memory mem-42",
            user: "U-UNK",
            channel: "D-UNK",
          },
        },
      });

      // Wait briefly to ensure no reply or seam call happens for the
      // unknown umbrella `/retract` (Slack drops the four target-specific
      // commands only).
      await new Promise((r) => setTimeout(r, 50));

      expect(retractFn).not.toHaveBeenCalled();
      // No chat.postMessage to D-UNK either.
      const calls = mockedCallSlackApi.mock.calls.filter(
        (call) =>
          call[1] === "chat.postMessage" &&
          (call[2] as { channel?: string }).channel === "D-UNK",
      );
      expect(calls).toHaveLength(0);

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
