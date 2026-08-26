import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelDef } from "#core/channels/channel.js";
import { Daemon } from "#core/daemon/daemon.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { EventBus, resetEventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { callTelegramApi } from "./client.js";
import telegramModule from "./index.js";
import { unloadTelegramModule } from "./notification-subscriptions.js";
import {
  buildDaemonScopeClient,
  readControlAddress,
} from "./telegram-scope-daemon-test-support.integration.js";
import {
  makeCtx,
  makeUpdate,
  sendBodies,
  waitFor,
} from "./telegram-scope-module-test-support.integration.js";

vi.mock("./client.js", async () => {
  const actual =
    await vi.importActual<typeof import("./client.js")>("./client.js");
  return { ...actual, callTelegramApi: vi.fn() };
});
vi.mock("./callback-poll.js", () => ({
  createTelegramCallbackHandler: vi.fn(() => async () => false),
  startCallbackPoll: vi.fn(() => () => {}),
}));

import type { LoopOptions } from "#core/loop/loop.js";

const agentSendMock = vi.fn(async () => undefined);
const agentCloseMock = vi.fn();
const agentSessionOptions: LoopOptions[] = [];

vi.mock("#core/loop/loop.js", async () => {
  const actual = await vi.importActual<typeof import("#core/loop/loop.js")>(
    "#core/loop/loop.js",
  );
  class FakeAgentSession {
    constructor(options?: LoopOptions) {
      if (options) agentSessionOptions.push(options);
    }
    send = agentSendMock;
    close = agentCloseMock;
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

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

describe("telegram scope integration", () => {
  let dir = "";

  afterEach(async () => {
    unloadTelegramModule();
    if (dir) rmSync(dir, { recursive: true, force: true });
    resetEventBus();
    resetScheduler();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    agentSessionOptions.length = 0;
    agentSendMock.mockClear();
    agentCloseMock.mockClear();
    mockedCallTelegramApi.mockReset();
    resetProviderRegistry();
  });

  it("starts Telegram interactive sessions with the selected daemon scope runtime bundle", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-interactive-scope-"));
    const stateDir = join(dir, "daemon-state");
    const dirA = join(dir, "scope-a");
    const dirB = join(dir, "scope-b");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const scopeB = buildDirectoryScope({ scopeRoot: dirB, displayName: "Scope B" });

    process.env.TELEGRAM_BOT_TOKEN = "daemon-token";
    process.env.TELEGRAM_ALERT_CHAT_ID = "99";
    let clientRef: KotaClient | null = null;
    const bus = new EventBus();
    const ctx = makeCtx(
      bus,
      createKotaClientTestDouble(),
      new ModuleStorage(dir, "telegram"),
    );
    Object.defineProperty(ctx, "client", {
      get: () => {
        if (!clientRef) throw new Error("daemon client not ready");
        return clientRef;
      },
    });
    ctx.getModuleConfig = () =>
      ({ defaultAutonomyMode: "supervised" }) as never;

    if (typeof telegramModule.channels !== "function") {
      throw new Error("expected telegramModule.channels to be a factory");
    }
    const resolved = telegramModule.channels(ctx);
    const channels = Array.isArray(resolved) ? resolved : await resolved;
    const interactive = channels.find((c) => c.name === "telegram-interactive");
    if (!interactive) throw new Error("telegram-interactive channel missing");
    const wrappedInteractive: ChannelDef = {
      ...interactive,
      create(channelCtx) {
        clientRef = buildDaemonScopeClient(readControlAddress(stateDir));
        return interactive.create(channelCtx);
      },
    };

    let pollCount = 0;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getMe") {
        return { id: 1, first_name: "Bot", username: "kota_bot" };
      }
      if (method === "getUpdates") {
        pollCount += 1;
        if (pollCount === 1) return [makeUpdate(10, `/scope ${scopeB.scopeId}`)];
        if (pollCount === 2) {
          await waitFor(
            () => sendBodies().some((body) => body.text.includes("Telegram chat is now using")),
            1_000,
          );
          return [makeUpdate(11, "hello from scope b")];
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [];
      }
      return { message_id: 200 };
    });

    const daemon = new Daemon({
      scopes: [
        { scopeRoot: dirA, displayName: "Scope A" },
        { scopeRoot: dirB, displayName: "Scope B" },
      ],
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      workflows: [],
      channels: [wrappedInteractive],
      config: {
        defaultAgentHarness: "claude-agent-sdk",
        model: "claude-sonnet-4-6",
        modelProvider: { type: "anthropic", apiKey: "sk-test" },
        modules: { telegram: { defaultAutonomyMode: "supervised" } },
      },
    });

    const startPromise = daemon.start();
    try {
      await waitFor(() => agentSendMock.mock.calls.length > 0, 3_000);
      expect(agentSendMock).toHaveBeenCalledWith("hello from scope b");
      expect(agentSessionOptions).toHaveLength(1);
      const options = agentSessionOptions[0]!;
      expect(options.scopeRoot).toBe(scopeB.scopeRoot);
      const scopeRuntime = options.scopeRuntime;
      if (!scopeRuntime) throw new Error("Telegram session did not receive a scope runtime");
      expect(scopeRuntime.scope.scopeId).toBe(scopeB.scopeId);
      expect(scopeRuntime.scope.scopeRoot).toBe(scopeB.scopeRoot);
    } finally {
      await daemon.stop();
      await startPromise;
    }
  });

});
