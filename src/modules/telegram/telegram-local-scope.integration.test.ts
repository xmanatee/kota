import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { EventBus, resetEventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { callTelegramApi } from "./client.js";
import telegramModule from "./index.js";
import { unloadTelegramModule } from "./notification-subscriptions.js";
import {
  makeClient,
  makeSpies,
  makeStatusInfo,
} from "./telegram-scope-client-test-support.integration.js";
import {
  makeScopeRuntime,
  SCOPE_A,
  SCOPE_B,
} from "./telegram-scope-daemon-test-support.integration.js";
import {
  makeCtx,
  makeUpdate,
  registerDaemonScopeProvider,
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

  it("routes interactive slash commands with a pre-daemon local client and the daemon scope provider", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-local-client-scope-"));
    registerDaemonScopeProvider();
    process.env.TELEGRAM_BOT_TOKEN = "daemon-token";
    process.env.TELEGRAM_ALERT_CHAT_ID = "99";

    const storage = new ModuleStorage(dir, "telegram");
    const spies = makeSpies();
    const localClient = makeClient(spies, {
      ok: false,
      reason: "daemon_required",
    });
    let delivered = false;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getMe") {
        return { id: 1, first_name: "Bot", username: "kota_bot" };
      }
      if (method === "getUpdates") {
        if (delivered) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [];
        }
        delivered = true;
        return [
          makeUpdate(1, "/scope scope-b"),
          makeUpdate(2, "/memory alpha"),
        ];
      }
      return { message_id: 100 };
    });

    if (typeof telegramModule.channels !== "function") {
      throw new Error("expected telegramModule.channels to be a factory");
    }
    const ctx = makeCtx(new EventBus(), localClient, storage);
    ctx.getModuleConfig = () =>
      ({ defaultAutonomyMode: "supervised" }) as never;
    const resolved = telegramModule.channels(ctx);
    const channels = Array.isArray(resolved) ? resolved : await resolved;
    const interactive = channels.find((c) => c.name === "telegram-interactive");
    if (!interactive) throw new Error("telegram-interactive channel missing");
    const runtimeA = makeScopeRuntime(SCOPE_A);
    const runtimeB = makeScopeRuntime(SCOPE_B);
    const started = interactive.create({
      getDefaultScopeRuntime: () => runtimeA,
      getScopeRuntime: (scopeId: string) => {
        if (scopeId === SCOPE_A.scopeId) return runtimeA;
        if (scopeId === SCOPE_B.scopeId) return runtimeB;
        throw new Error(`unknown scope ${scopeId}`);
      },
      log: () => {},
      reportFailure: () => {},
      getWorkflowStatus: makeStatusInfo,
    });
    if (started.status !== "started") {
      throw new Error(`telegram-interactive did not start: ${started.status}`);
    }

    await started.adapter.start();
    try {
      await waitFor(() => sendBodies().length >= 2);
    } finally {
      await started.adapter.stop();
    }

    expect(localClient.scopes.list).not.toHaveBeenCalled();
    expect(sendBodies().some((body) => body.text.includes("Scope selection requires"))).toBe(false);
    expect(sendBodies().some((body) => body.text.includes("Telegram chat is now using Scope B"))).toBe(true);
    expect(spies.get(SCOPE_B.scopeId)!.memorySearch).toHaveBeenCalledWith("alpha", {
      semantic: true,
      limit: 10,
    });
  });

});
