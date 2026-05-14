import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resolveModuleChannels } from "#core/modules/module-types.js";

vi.mock("./bot.js", () => {
  const SlackBot = vi.fn(function (this: Record<string, unknown>) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn();
    this.postApproval = vi.fn().mockResolvedValue(undefined);
  });
  return { SlackBot };
});

import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { SlackBot } from "./bot.js";
import slackChannelModule from "./index.js";

const MockedSlackBot = vi.mocked(SlackBot);

const STUB_CHANNEL_START_CTX = {
  projectDir: "/tmp",
  defaultProjectRuntime: {
    project: { projectId: "test-project", projectDir: "/tmp", displayName: "test" },
  } as never,
  getProjectRuntime: () =>
    ({
      project: { projectId: "test-project", projectDir: "/tmp", displayName: "test" },
    }) as never,
  log: () => {},
  getWorkflowStatus: () => ({
    runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
    dispatchPaused: false,
    runsDir: "/tmp/.kota/runs",
  }),
};

function makeStubCtx(
  bus?: EventBus,
  moduleConfig?: Record<string, unknown>,
  kotaConfig?: ModuleRuntimeContext["config"],
): ModuleRuntimeContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: kotaConfig ?? ({ serve: { defaultAutonomyMode: "supervised" } } as ModuleRuntimeContext["config"]),
    storage: new ModuleStorage("/tmp/test", "slack-channel"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedControlRoutes: () => [],
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
    events: makeStubEventProxy(b),
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: () => null,
    callTool: async () => ({ content: "" }),
    registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
    registerPreSendHook: () => {},
    registerHarnessHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
    client: {
      recall: {},
      answer: {},
      capture: {},
      memory: {},
      knowledge: {},
      history: {},
      tasks: {},
    } as never,
  };
}

async function resolveStartResult(ctx: ModuleRuntimeContext) {
  const channels = await resolveModuleChannels(slackChannelModule, ctx);
  const def = channels[0];
  return def.create(STUB_CHANNEL_START_CTX);
}

async function resolveAdapter(ctx: ModuleRuntimeContext) {
  const result = await resolveStartResult(ctx);
  return result.status === "started" ? result.adapter : null;
}

describe("slackChannelModule metadata", () => {
  it("has correct name and version", () => {
    expect(slackChannelModule.name).toBe("slack-channel");
    expect(slackChannelModule.version).toBe("1.0.0");
  });

  it("description mentions Slack", () => {
    expect(slackChannelModule.description).toContain("Slack");
  });

  it("contributes a slack-channel channel", async () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const channels = await resolveModuleChannels(slackChannelModule, ctx);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("slack-channel");
    expect(channels[0].description).toBeTruthy();
  });

  it("does not register tools, routes, or commands", () => {
    expect(slackChannelModule.tools).toBeUndefined();
    expect(slackChannelModule.routes).toBeUndefined();
    expect(slackChannelModule.commands).toBeUndefined();
  });
});

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

  it("throws loudly when neither channel nor serve autonomy is configured", () => {
    const ctx = makeStubCtx(
      undefined,
      { botToken: "xoxb-test", appToken: "xapp-test" },
      {} as ModuleRuntimeContext["config"],
    );
    expect(() => slackChannelModule.onLoad!(ctx)).toThrow(
      /slack-channel: autonomy mode is not configured/,
    );
  });
});

describe("slackChannelModule channel adapter", () => {
  beforeEach(() => {
    MockedSlackBot.mockClear();
  });

  it("create returns disabled result and logs when config is missing", async () => {
    const logFn = vi.fn();
    const ctx = makeStubCtx(undefined, undefined);
    const channels = await resolveModuleChannels(slackChannelModule, ctx);
    const result = channels[0].create({
      ...STUB_CHANNEL_START_CTX,
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
      notifyChannel: "C-ALERTS",
    });
    const adapter = await resolveAdapter(ctx);
    expect(adapter).not.toBeNull();
    expect(MockedSlackBot).toHaveBeenCalledWith(
      expect.objectContaining({
        botToken: "xoxb-test",
        appToken: "xapp-test",
        notifyChannel: "C-ALERTS",
      }),
    );
    const constructed = MockedSlackBot.mock.calls[0][0];
    expect(constructed.attention).toEqual(
      expect.objectContaining({ snapshot: expect.any(Function) }),
    );
    expect(constructed.digest).toEqual(
      expect.objectContaining({ snapshot: expect.any(Function) }),
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

    adapter!.stop();
    expect(botInstance.stop).toHaveBeenCalled();

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
