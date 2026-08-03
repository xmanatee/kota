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
    this.listScopeSessionIds = vi.fn().mockReturnValue([]);
    this.closeScopeSessions = vi.fn();
  });
  return { SlackBot };
});

import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { SlackBot } from "./bot.js";
import slackChannelModule from "./index.js";

const MockedSlackBot = vi.mocked(SlackBot);

const STUB_CHANNEL_START_CTX = {
  getDefaultProjectRuntime: () =>
    ({
      project: { projectId: "test-project", projectDir: "/tmp", displayName: "test" },
    }) as never,
  getProjectRuntime: () =>
    ({
      project: { projectId: "test-project", projectDir: "/tmp", displayName: "test" },
    }) as never,
  log: () => {},
  reportFailure: () => {},
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
    cwd: "/tmp",
    verbose: false,
    config: kotaConfig ?? ({ serve: { defaultAutonomyMode: "supervised" } } as ModuleRuntimeContext["config"]),
    storage: new ModuleStorage("/tmp/test", "slack-channel"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
      getContributedUiSurfaces: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => moduleConfig as never,
    log: Object.assign(() => {}, {
      info: () => {},
      warn: vi.fn(),
      error: () => {},
      debug: () => {},
    }),
    getSecret: vi.fn(() => null),
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
      approvals: {
        list: vi.fn(async () => ({
          approvals: [{
            id: "abc123",
            scopeId: "test-project",
            tool: "shell",
            input: { redacted: true, reason: "tool-io" },
            review: {
              status: "available",
              input: { command: "deploy --target /srv/app" },
              context: "user: deploy the client release",
              digest: "a".repeat(64),
            },
            risk: "dangerous",
            reason: "Runs commands",
            createdAt: "2026-07-28T22:00:00.000Z",
            status: "pending",
          }],
        })),
        approve: vi.fn(),
        reject: vi.fn(),
      },
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
      tool: "write",
      risk: "low",
      reason: "test",
      source: "test",
      sessionId: "",
    });
    await Promise.resolve();
    expect(botInstance.postApproval).not.toHaveBeenCalled();
  });});
