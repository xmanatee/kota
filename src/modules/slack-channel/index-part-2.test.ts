import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelStartContext } from "#core/channels/channel.js";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resolveModuleChannels } from "#core/modules/module-types.js";

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
import {
  makeSlackChannelModuleTestContext as makeStubCtx,
  STUB_CHANNEL_START_CTX,
} from "./index-test-support.js";

const MockedSlackBot = vi.mocked(SlackBot);

const CHANNEL_START_CTX: ChannelStartContext = {
  ...STUB_CHANNEL_START_CTX,
  getWorkflowStatus: () => ({
    runtimeState: { activeRuns: [], completedRuns: 0, pendingRuns: [], workflows: {} },
    dispatchPaused: false,
    runsDir: "/tmp/.kota/runs",
  }),
};

async function resolveStartResult(ctx: ModuleRuntimeContext) {
  const channels = await resolveModuleChannels(slackChannelModule, ctx);
  const def = channels[0];
  return def.create(CHANNEL_START_CTX);
}

async function resolveAdapter(ctx: ModuleRuntimeContext) {
  const result = await resolveStartResult(ctx);
  return result.status === "started" ? result.adapter : null;
}

describe("slackChannelModule channel adapter", () => {
  beforeEach(() => {
    MockedSlackBot.mockClear();
  });

  it("create returns disabled result and logs when config is missing", async () => {
    const logFn = vi.fn();
    const ctx = makeStubCtx(undefined, undefined);
    const channels = await resolveModuleChannels(slackChannelModule, ctx);
    const result = channels[0].create({
      ...CHANNEL_START_CTX,
      log: logFn,
    });
    expect(result.status).toBe("disabled");
    if (result.status === "disabled") {
      expect(result.reason).toMatch(/botToken/);
    }
    expect(logFn).toHaveBeenCalledWith(expect.stringContaining("No config"));
    expect(MockedSlackBot).not.toHaveBeenCalled();
  });

  it("create constructs SlackBot with config + namespace seams", async () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      workspaceId: "T-EXPECTED",
      allowedUserIds: ["U-OWNER"],
      notifyChannel: "C-ALERTS",
    });
    const adapter = await resolveAdapter(ctx);
    expect(adapter).not.toBeNull();
    expect(MockedSlackBot).toHaveBeenCalledWith(
		expect.objectContaining({
        botToken: "xoxb-test",
        appToken: "xapp-test",
        workspaceId: "T-EXPECTED",
        allowedUserIds: ["U-OWNER"],
        notifyChannel: "C-ALERTS",
		}),
		expect.anything(),
    );
    const constructed = MockedSlackBot.mock.calls[0][0];
    expect(constructed.attention).toEqual(
      expect.objectContaining({ snapshot: expect.any(Function) }),
    );
    expect(constructed.digest).toEqual(
      expect.objectContaining({ snapshot: expect.any(Function) }),
    );
  });

  it("resolves token references through the module secret store", async () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "$SLACK_BOT_TOKEN",
      appToken: "$SLACK_APP_TOKEN",
      notifyChannel: "C-ALERTS",
    });
    vi.mocked(ctx.getSecret).mockImplementation(
      (key) => ({
        SLACK_BOT_TOKEN: "xoxb-stored",
        SLACK_APP_TOKEN: "xapp-stored",
      })[key] ?? null,
    );

    await resolveAdapter(ctx);

		expect(MockedSlackBot).toHaveBeenCalledWith(
			expect.objectContaining({
        botToken: "xoxb-stored",
        appToken: "xapp-stored",
			}),
			expect.anything(),
    );
  });

  it("uses per-channel defaultAutonomyMode when set", async () => {
    const ctx = makeStubCtx(
      undefined,
      {
        botToken: "xoxb-test",
        appToken: "xapp-test",
        defaultAutonomyMode: "autonomous",
      },
      { serve: { defaultAutonomyMode: "passive" } } as ModuleRuntimeContext["config"],
    );
    await resolveAdapter(ctx);
		expect(MockedSlackBot).toHaveBeenCalledWith(
			expect.objectContaining({ autonomyMode: "autonomous" }),
			expect.anything(),
    );
  });

  it("falls back to config.serve.defaultAutonomyMode when channel default is absent", async () => {
    const ctx = makeStubCtx(
      undefined,
      { botToken: "xoxb-test", appToken: "xapp-test" },
      { serve: { defaultAutonomyMode: "passive" } } as ModuleRuntimeContext["config"],
    );
    await resolveAdapter(ctx);
		expect(MockedSlackBot).toHaveBeenCalledWith(
			expect.objectContaining({ autonomyMode: "passive" }),
			expect.anything(),
    );
  });

  it("adapter.start calls bot.start", async () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const adapter = await resolveAdapter(ctx);
    const botInstance = MockedSlackBot.mock.results[0].value;
    await adapter!.start();
    expect(botInstance.start).toHaveBeenCalled();
  });

  it("reports channel sessions and closes the previous default scope immediately", async () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const adapter = await resolveAdapter(ctx);
    const botInstance = MockedSlackBot.mock.results[0].value;
    botInstance.listScopeSessionIds.mockReturnValue(["slack:U1:scope-a"]);

    expect(adapter!.listScopeSessionIds("scope-a")).toEqual(["slack:U1:scope-a"]);

    bus.emit("scope.lifecycle.changed", {
      transition: "default-changed",
      affectedScopeId: "scope-b",
      previousDefaultScopeId: "scope-a",
      directoryRoot: "/tmp/scope-b",
      displayName: "Scope B",
    });

    expect(botInstance.closeScopeSessions).toHaveBeenCalledWith("scope-a");
    await adapter!.stop();
  });
  it("adapter.stop unsubscribes from approval events and stops the bot", async () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const adapter = await resolveAdapter(ctx);
    const botInstance = MockedSlackBot.mock.results[0].value;

		bus.emit("approval.requested", {
			id: "abc123",
			scopeId: "test-scope",
      tool: "shell",
      risk: "high",
      reason: "Runs commands",
      source: "builder",
      sessionId: "",
    });
    await Promise.resolve();
    expect(botInstance.postApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "abc123",
        review: expect.objectContaining({
          digest: "a".repeat(64),
          context: "user: deploy the client release",
        }),
      }),
    );

    adapter!.stop();
    expect(botInstance.stop).toHaveBeenCalled();

    botInstance.postApproval.mockClear();
		bus.emit("approval.requested", {
			id: "xyz",
			scopeId: "test-scope",
      tool: "write",
      risk: "low",
      reason: "test",
      source: "test",
      sessionId: "",
    });
    await Promise.resolve();
    expect(botInstance.postApproval).not.toHaveBeenCalled();
  });});
