/**
 * End-to-end integration test for the Telegram personal-assistant path.
 *
 * Demonstrates that Telegram channels running inside the daemon coexist with
 * scheduled workflows and in-process workflow runtime. Covers both the status
 * poll channel and the interactive bot channel to prove a single daemon owns
 * both inbound Telegram traffic and scheduled work.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeWithAgentSDK } from "#core/agent-sdk/index.js";
import type { ChannelDef } from "#core/channels/channel.js";
import {
  Daemon,
  type DaemonConfig,
} from "#core/daemon/daemon.js";
import {
  getScheduler,
  initScheduler,
  resetScheduler,
} from "#core/daemon/scheduler.js";
import { resetEventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import telegramModule from "./index.js";
import { startTelegramStatusPoll } from "./status-poll.js";

const agentSendMock = vi.fn(async () => undefined);

vi.mock("#core/loop/loop.js", async () => {
  const actual = await vi.importActual<typeof import("#core/loop/loop.js")>(
    "#core/loop/loop.js",
  );
  class FakeAgentSession {
    send = agentSendMock;
    close = vi.fn();
    getCostSummary = vi.fn().mockReturnValue("$0.00");
    get isClosed(): boolean {
      return false;
    }
  }
  return {
    ...actual,
    AgentSession: FakeAgentSession as unknown as typeof actual.AgentSession,
  };
});

vi.mock("#core/agent-sdk/index.js", async () => {
  const actual = await vi.importActual("#core/agent-sdk/index.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

vi.mock("#core/daemon/task-store.js", () => ({
  initTaskStore: vi.fn(),
}));

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fixedTime(): number {
  return Math.floor(Date.now() / 1000);
}

describe("Telegram personal-assistant daemon integration", () => {
  let projectDir: string;
  let stateDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-telegram-integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    stateDir = join(projectDir, ".kota");
    mkdirSync(join(projectDir, "src", "modules", "autonomy", "workflows", "builder"), {
      recursive: true,
    });
    resetEventBus();
    resetScheduler();
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetEventBus();
    resetScheduler();
    rmSync(projectDir, { recursive: true, force: true });
  });

  function makeDaemon(overrides: Partial<DaemonConfig> = {}): Daemon {
    return new Daemon({
      projectDir,
      model: "claude-sonnet-4-6",
      verbose: false,
      idleIntervalMs: 1000,
      pollIntervalMs: 60_000,
      stateDir,
      ...overrides,
    });
  }

  it("serves a Telegram channel and fires a scheduled item in one daemon process", async () => {
    writeFileSync(
      join(projectDir, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      subtype: "success",
      isError: false,
    });

    // Stubbed Telegram API: one /status message, then empty polls.
    const statusChatId = 9_876_543_210;
    const statusText = "/status";
    let delivered = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes("/bot")) throw new Error(`unexpected url: ${url}`);
      if (url.endsWith("/getUpdates")) {
        if (!delivered) {
          delivered = true;
          return {
            json: () =>
              Promise.resolve({
                ok: true,
                result: [
                  {
                    update_id: 1,
                    message: {
                      message_id: 1,
                      chat: { id: statusChatId, type: "private" },
                      text: statusText,
                      date: fixedTime(),
                    },
                  },
                ],
              }),
          } as unknown as Response;
        }
        return {
          json: () => Promise.resolve({ ok: true, result: [] }),
        } as unknown as Response;
      }
      return {
        json: () => Promise.resolve({ ok: true, result: true }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Contribute a minimal Telegram channel that responds to /status using
    // the daemon-owned runtime state.
    const telegramStatusChannel: ChannelDef = {
      name: "telegram-status-test",
      create(ctx) {
        let stop: (() => void) | null = null;
        return {
          async start() {
            stop = startTelegramStatusPoll(
              "test-token",
              String(statusChatId),
              ctx.getWorkflowStatus,
              ctx.log,
            );
          },
          stop() {
            stop?.();
          },
        };
      },
    };

    // Pre-schedule a due notification item so the scheduler fires on the poll.
    initScheduler(projectDir, stateDir);
    const scheduler = getScheduler();
    scheduler.add("Test reminder", new Date(Date.now() - 1000));

    const daemon = makeDaemon({
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "build",
              type: "agent",
              promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
              harness: "claude-agent-sdk",
              model: "claude-opus-4-7",
              effort: "xhigh",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
      channels: [telegramStatusChannel],
      pollIntervalMs: 100,
    });

    const startPromise = daemon.start();

    // Wait for the channel to deliver the /status reply AND for the
    // scheduled item to fire within the same daemon lifetime.
    const deadline = Date.now() + 2_000;
    let sawStatusReply = false;
    let sawSchedulerFire = false;
    while (Date.now() < deadline) {
      const sendMessageCalls = fetchMock.mock.calls.filter((call) => {
        const url = call[0] as string;
        return url.endsWith("/sendMessage");
      });
      if (sendMessageCalls.length > 0) sawStatusReply = true;
      const fired = scheduler.list().filter((item) => item.status === "fired");
      if (fired.length > 0) sawSchedulerFire = true;
      if (sawStatusReply && sawSchedulerFire) break;
      await wait(50);
    }

    await daemon.stop();
    await startPromise;

    expect(sawStatusReply).toBe(true);
    expect(sawSchedulerFire).toBe(true);
  });

  it("routes an inbound Telegram text message to AgentSession.send inside the daemon", async () => {
    agentSendMock.mockReset();
    resetProviderRegistry();

    const chatId = 4_242_424;
    let delivered = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes("/bot")) throw new Error(`unexpected url: ${url}`);
      if (url.endsWith("/getMe")) {
        return {
          json: () => Promise.resolve({ ok: true, result: { id: 1, first_name: "TestBot" } }),
        } as unknown as Response;
      }
      if (url.endsWith("/getUpdates")) {
        if (!delivered) {
          delivered = true;
          return {
            json: () =>
              Promise.resolve({
                ok: true,
                result: [
                  {
                    update_id: 7,
                    message: {
                      message_id: 7,
                      chat: { id: chatId, type: "private", first_name: "Op" },
                      text: "hello from the daemon",
                      date: fixedTime(),
                    },
                  },
                ],
              }),
          } as unknown as Response;
        }
        // Throttle subsequent empty polls so bot's loop does not spin hot.
        return {
          json: () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ ok: true, result: [] }), 100),
            ),
        } as unknown as Response;
      }
      return {
        json: () => Promise.resolve({ ok: true, result: true }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Resolve the interactive channel from the real telegram module through a
    // stub context, with the live bus so bot scheduler broadcasts can flow.
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALERT_CHAT_ID = String(chatId);
    const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const { initEventBus } = await import("#core/events/event-bus.js");
    const bus = initEventBus();

    const stubCtx: ModuleContext = {
      cwd: projectDir,
      verbose: false,
      config: { model: "claude-sonnet-4-6" } as ModuleContext["config"],
      storage: new ModuleStorage(projectDir, "telegram"),
      registerGroup: () => {},
      getRoutes: () => [],
      getContributedWorkflows: () => [],
      getContributedChannels: () => [],
      getModuleSummaries: () => [],
      getModuleConfig: () =>
        ({ defaultAutonomyMode: "supervised" }) as never,
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getSecret: () => null,
      listTools: () => [],
      events: {
        emit: (event, payload) => bus.emit(event as never, payload as never),
        subscribe: (event, handler) => bus.on(event, handler as never),
      },
      createSession: () => ({ send: async () => "", close: () => {} }),
      registerProvider: () => {},
      getProvider: () => null,
      callTool: async () => ({ content: "" }),
      registerMiddleware: () => {},
      registerDynamicStateProvider: () => {},
      registerCleanupHook: () => {},
      registerPreSendHook: () => {},
      resolveAgentDef: () => undefined,
      resolveSkillsPrompt: () => "",
      probeHealthChecks: async () => ({}),
      getRegisteredConfigKeys: () => new Set<string>(),
    };

    if (typeof telegramModule.channels !== "function") {
      throw new Error("expected telegramModule.channels to be a factory");
    }
    const resolved = telegramModule.channels(stubCtx);
    const channels = Array.isArray(resolved) ? resolved : await resolved;
    const interactive = channels.find((c) => c.name === "telegram-interactive");
    if (!interactive) throw new Error("telegram-interactive channel missing");

    const daemon = makeDaemon({
      channels: [interactive],
      pollIntervalMs: 100,
    });

    const startPromise = daemon.start();

    try {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline && agentSendMock.mock.calls.length === 0) {
        await wait(25);
      }

      expect(agentSendMock).toHaveBeenCalledWith("hello from the daemon");
    } finally {
      await daemon.stop();
      await startPromise;
      if (savedAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_ALERT_CHAT_ID;
    }
  });

});
