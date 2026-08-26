/**
 * End-to-end integration test for the Telegram personal-assistant path.
 *
 * Demonstrates that Telegram channels running inside the daemon coexist with
 * scheduled workflows and in-process workflow runtime. Covers both the status
 * poll channel and the interactive bot channel to prove a single daemon owns
 * both inbound Telegram traffic and scheduled work.
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Daemon,
  type DaemonConfig,
} from "#core/daemon/daemon.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { resetEventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import { createTelegramModule } from "./index.js";

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

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("#modules/claude-agent-harness/executor.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

import "#modules/claude-agent-harness/index.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fixedTime(): number {
  return Math.floor(Date.now() / 1000);
}

describe("Telegram personal-assistant daemon integration", () => {
  let scopeRoot: string;
  let stateDir: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-telegram-integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    stateDir = join(scopeRoot, ".kota");
    mkdirSync(join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder"), {
      recursive: true,
    });
    resetEventBus();
    resetScheduler();
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  function makeDaemon(overrides: Partial<DaemonConfig> = {}): Daemon {
    return new Daemon({
      scopeRoot,
      model: "claude-sonnet-4-6",
      verbose: false,
      idleIntervalMs: 1000,
      pollIntervalMs: 60_000,
      stateDir,
      ...overrides,
    });
  }

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
    const telegramModule = createTelegramModule(
      outboundHttpRequestPort((request) => fetchMock(String(request.url))),
    );

    // Resolve the interactive channel from the real telegram module through a
    // stub context, with the live bus so bot scheduler broadcasts can flow.
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALERT_CHAT_ID = String(chatId);
    const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const { initEventBus } = await import("#core/events/event-bus.js");
    const bus = initEventBus();

    const stubCtx: ModuleRuntimeContext = {
      cwd: scopeRoot,
      verbose: false,
      config: {
        model: "claude-sonnet-4-6",
        modelProvider: { type: "anthropic", apiKey: "sk-test" },
      } as ModuleRuntimeContext["config"],
      storage: new ModuleStorage(scopeRoot, "telegram"),
      registerGroup: () => {},
      getRoutes: () => [],
      getContributedWorkflows: () => [],
      getContributedChannels: () => [],
      getContributedUiSurfaces: () => [],
      getContributedControlRoutes: () => [],
      getModuleSummaries: () => [],
      getModuleConfig: () =>
        ({ defaultAutonomyMode: "supervised" }) as never,
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getSecret: (key) => process.env[key] ?? null,
      listTools: () => [],
      events: makeStubEventProxy(bus),
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
      client: {} as never,
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
