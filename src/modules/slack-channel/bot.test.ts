import { describe, expect, it } from "vitest";
import { approvalProjection, makeBot, mockedCallSlackApi, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
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
      await bot.postApproval(approvalProjection());
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
                expect.objectContaining({
                  action_id: "approve:abc123",
                  value: `approve:scope-test:abc123:${"a".repeat(64)}`,
                }),
                expect.objectContaining({
                  action_id: "reject:abc123",
                  value: `reject:scope-test:abc123:${"a".repeat(64)}`,
                }),
              ]),
            }),
          ]),
        }),
      );
    });

    it("does nothing when notifyChannel is not configured", async () => {
      const bot = makeBot({ notifyChannel: undefined });
      await bot.postApproval(approvalProjection("abc"));
      expect(mockedCallSlackApi).not.toHaveBeenCalled();
    });
  });

  // --- Socket Mode payload routing ---

});
