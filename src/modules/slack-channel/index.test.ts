import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";

vi.mock("./bot.js", () => {
  const SlackBot = vi.fn(function (this: Record<string, unknown>) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn();
    this.postApproval = vi.fn().mockResolvedValue(undefined);
    this.listScopeSessionIds = vi.fn().mockReturnValue([]);
    this.closeScopeSessions = vi.fn();
  });
  return { SlackBot };
});

import { SlackBot } from "./bot.js";
import slackChannelModule from "./index.js";
import { makeSlackChannelModuleTestContext as makeStubCtx } from "./index-test-support.js";

const MockedSlackBot = vi.mocked(SlackBot);



describe("slackChannelModule onLoad", () => {
  beforeEach(() => {
    MockedSlackBot.mockClear();
  });

  it("warns when config is missing", () => {
    const ctx = makeStubCtx(undefined, undefined);
    slackChannelModule.onLoad!(ctx);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("botToken and appToken are required"),
    );
  });

  it("warns when only botToken is present (no appToken)", () => {
    const ctx = makeStubCtx(undefined, { botToken: "xoxb-test" });
    slackChannelModule.onLoad!(ctx);
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("does not construct SlackBot at load time", () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    slackChannelModule.onLoad!(ctx);
    expect(MockedSlackBot).not.toHaveBeenCalled();
  });

  it("warns that interactive input is default-denied without admission config", () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    slackChannelModule.onLoad!(ctx);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("interactive input is disabled"),
    );
  });

  it("throws loudly when neither channel nor serve autonomy is configured", () => {
    const ctx = makeStubCtx(
      undefined,
      { botToken: "xoxb-test", appToken: "xapp-test" },
      {} as ModuleRuntimeContext["config"],
    );
    expect(() => slackChannelModule.onLoad!(ctx)).toThrow(
      /slack-channel: autonomy mode is not configured/,
    );
  });});
