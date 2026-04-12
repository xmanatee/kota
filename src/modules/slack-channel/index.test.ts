import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { resolveModuleChannels } from "#core/modules/module-types.js";

vi.mock("./bot.js", () => {
  const SlackBot = vi.fn(function (this: Record<string, unknown>) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn();
    this.postApproval = vi.fn().mockResolvedValue(undefined);
  });
  return { SlackBot };
});

import { SlackBot } from "./bot.js";
import slackChannelModule from "./index.js";

const MockedSlackBot = vi.mocked(SlackBot);

function makeStubCtx(
  bus?: EventBus,
  moduleConfig?: Record<string, unknown>,
): ModuleContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleContext["config"],
    storage: new ModuleStorage("/tmp/test", "slack-channel"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => moduleConfig as never,
    log: Object.assign(() => {}, {
      info: () => {},
      warn: vi.fn(),
      error: () => {},
      debug: () => {},
    }),
    getSecret: () => null,
    listTools: () => [],
    events: {
      emit: (event, payload) => b.emit(event, payload as never),
      subscribe: (event, handler) => b.on(event, handler as never),
    },
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: () => null,
    callTool: async () => ({ content: "" }),
    registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
  };
}

describe("slackChannelModule metadata", () => {
  it("has correct name and version", () => {
    expect(slackChannelModule.name).toBe("slack-channel");
    expect(slackChannelModule.version).toBe("1.0.0");
  });

  it("description mentions Slack", () => {
    expect(slackChannelModule.description).toContain("Slack");
  });

  it("contributes a slack-channel channel", () => {
    const channels = slackChannelModule.channels;
    expect(channels).toBeDefined();
    expect(Array.isArray(channels)).toBe(true);
    expect(channels).toHaveLength(1);
    if (!Array.isArray(channels)) throw new Error("expected channels to be static");
    expect(channels[0].name).toBe("slack-channel");
    expect(channels[0].description).toBeTruthy();
  });

  it("does not register tools, routes, or commands", () => {
    expect(slackChannelModule.tools).toBeUndefined();
    expect(slackChannelModule.routes).toBeUndefined();
    expect(slackChannelModule.commands).toBeUndefined();
  });
});

describe("slackChannelModule onLoad/onUnload", () => {
  beforeEach(() => {
    MockedSlackBot.mockClear();
  });

  afterEach(async () => {
    await slackChannelModule.onUnload?.();
  });

  it("creates SlackBot when config has botToken and appToken", () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    slackChannelModule.onLoad!(ctx);
    expect(MockedSlackBot).toHaveBeenCalledWith(
      expect.objectContaining({
        botToken: "xoxb-test",
        appToken: "xapp-test",
      }),
    );
  });

  it("passes notifyChannel to SlackBot when configured", () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      notifyChannel: "C-ALERTS",
    });
    slackChannelModule.onLoad!(ctx);
    expect(MockedSlackBot).toHaveBeenCalledWith(
      expect.objectContaining({ notifyChannel: "C-ALERTS" }),
    );
  });

  it("warns and skips bot creation when config is missing", () => {
    const ctx = makeStubCtx(undefined, undefined);
    slackChannelModule.onLoad!(ctx);
    expect(MockedSlackBot).not.toHaveBeenCalled();
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("botToken and appToken are required"),
    );
  });

  it("warns when only botToken is present (no appToken)", () => {
    const ctx = makeStubCtx(undefined, { botToken: "xoxb-test" });
    slackChannelModule.onLoad!(ctx);
    expect(MockedSlackBot).not.toHaveBeenCalled();
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("subscribes to approval.requested and delegates to bot.postApproval", async () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    slackChannelModule.onLoad!(ctx);

    const botInstance = MockedSlackBot.mock.results[0].value;

    bus.emit("approval.requested", {
      id: "abc123",
      tool: "shell",
      risk: "high",
      reason: "Runs commands",
      source: "builder",
    });
    await Promise.resolve();

    expect(botInstance.postApproval).toHaveBeenCalledWith(
      "abc123",
      "shell",
      "high",
      "Runs commands",
    );
  });

  it("onUnload stops bot and unsubscribes from events", async () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    slackChannelModule.onLoad!(ctx);

    const botInstance = MockedSlackBot.mock.results[0].value;

    await slackChannelModule.onUnload?.();
    expect(botInstance.stop).toHaveBeenCalled();

    // Events after unload should not reach bot
    botInstance.postApproval.mockClear();
    bus.emit("approval.requested", {
      id: "xyz",
      tool: "write",
      risk: "low",
      reason: "test",
      source: "test",
    });
    await Promise.resolve();
    expect(botInstance.postApproval).not.toHaveBeenCalled();
  });
});

describe("slackChannelModule channel adapter", () => {
  beforeEach(() => {
    MockedSlackBot.mockClear();
  });

  afterEach(async () => {
    await slackChannelModule.onUnload?.();
  });

  it("channel create returns adapter with start/stop", async () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    slackChannelModule.onLoad!(ctx);

    const [channel] = await resolveModuleChannels(slackChannelModule, ctx);
    const adapter = channel.create({
      projectDir: "/tmp",
      log: () => {},
      getWorkflowStatus: () => ({
        runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
        dispatchPaused: false,
        runsDir: "/tmp/.kota/runs",
      }),
    });
    expect(adapter).not.toBeNull();
    expect(adapter).toHaveProperty("start");
    expect(adapter).toHaveProperty("stop");
  });

  it("adapter.start calls bot.start", async () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    slackChannelModule.onLoad!(ctx);

    const botInstance = MockedSlackBot.mock.results[0].value;
    const [channel] = await resolveModuleChannels(slackChannelModule, ctx);
    const adapter = channel.create({
      projectDir: "/tmp",
      log: () => {},
      getWorkflowStatus: () => ({
        runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
        dispatchPaused: false,
        runsDir: "/tmp/.kota/runs",
      }),
    });

    await adapter!.start();
    expect(botInstance.start).toHaveBeenCalled();
  });

  it("adapter.start logs and returns when bot is not configured", async () => {
    const logFn = vi.fn();
    // No config — bot is null
    const ctx = makeStubCtx(undefined, undefined);
    slackChannelModule.onLoad!(ctx);

    const [channel] = await resolveModuleChannels(slackChannelModule, ctx);
    const adapter = channel.create({
      projectDir: "/tmp",
      log: logFn,
      getWorkflowStatus: () => ({
        runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
        dispatchPaused: false,
        runsDir: "/tmp/.kota/runs",
      }),
    });

    // Should not throw
    await adapter!.start();
    expect(logFn).toHaveBeenCalledWith(expect.stringContaining("No config"));
  });
});
