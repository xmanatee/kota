import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { EventBus, resetEventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { TelegramBot } from "./bot.js";
import { callTelegramApi } from "./client.js";
import telegramModule from "./index.js";
import { unloadTelegramModule } from "./notification-subscriptions.js";
import { TelegramScopeSelection } from "./scope-selection.js";
import { startTelegramStatusPoll } from "./status-poll.js";
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
  sendBodies,
  waitFor,
} from "./telegram-scope-module-test-support.integration.js";

vi.mock("./client.js", async () => {
  const actual =
    await vi.importActual<typeof import("./client.js")>("./client.js");
  return { ...actual, callTelegramApi: vi.fn() };
});

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

  it("routes status commands, interactive sessions, and notifications through the selected scope", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-scope-"));
    const storage = new ModuleStorage(dir, "telegram");
    const spies = makeSpies();
    const client = makeClient(spies);
    const selection = new TelegramScopeSelection(client, storage, []);

    let firstPoll = true;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getUpdates") {
        if (!firstPoll) return [];
        firstPoll = false;
        return [
          makeUpdate(1, "/memory alpha"),
          makeUpdate(2, "/scope scope-a"),
          makeUpdate(3, "/memory alpha"),
          makeUpdate(4, "/scope scope-b"),
          makeUpdate(5, "/memory alpha"),
          makeUpdate(6, "/capture-to-memory beta note"),
          makeUpdate(7, "/retract-memory mem-b"),
          makeUpdate(8, "/status"),
        ];
      }
      return { message_id: 100 };
    });
    const statusInfo = makeStatusInfo();

    const stopStatus = startTelegramStatusPoll(
      "token",
      "99",
      SCOPE_A.scopeRoot,
      () => ({
        ...statusInfo,
        runtimeState: { ...statusInfo.runtimeState, activeRuns: [] },
      }),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      () => {},
      { client, selection },
    );
    await waitFor(() => sendBodies().length >= 8);
    stopStatus();

    const scopeASpies = spies.get(SCOPE_A.scopeId)!;
    const scopeBSpies = spies.get(SCOPE_B.scopeId)!;
    expect(scopeASpies.memorySearch).toHaveBeenCalledWith("alpha", {
      semantic: true,
      limit: 10,
    });
    expect(scopeBSpies.memorySearch).toHaveBeenCalledWith("alpha", {
      semantic: true,
      limit: 10,
    });
    expect(scopeBSpies.capture).toHaveBeenCalledWith("beta note", {
      target: "memory",
    });
    expect(scopeBSpies.retract).toHaveBeenCalledWith({
      target: "memory",
      id: "mem-b",
    });
    expect(scopeBSpies.workflowStatus).toHaveBeenCalledOnce();
    expect(scopeASpies.workflowStatus).not.toHaveBeenCalled();
    expect(scopeASpies.capture).not.toHaveBeenCalled();
    expect(scopeASpies.retract).not.toHaveBeenCalled();
    expect(sendBodies().some((body) => body.text.includes("not bound to a KOTA scope"))).toBe(true);
    expect(sendBodies().some((body) => body.text.includes("alpha lives only in scope A"))).toBe(true);
    expect(sendBodies().some((body) => body.text === "No matching memory entries.")).toBe(true);

    mockedCallTelegramApi.mockClear();
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_ALERT_CHAT_ID = "99";
    const bus = new EventBus();
    telegramModule.onLoad!(makeCtx(bus, client, storage));
    bus.emit("workflow.failure.alert", {
      scopeId: SCOPE_B.scopeId,
      workflow: "builder",
      runId: "run-b",
      status: "failed",
      durationMs: 1000,
      errorSummary: "boom",
      text: "Workflow failed: *builder*",
    });
    await waitFor(() => sendBodies().length === 1);
    expect(sendBodies()[0]?.text).toBe("[Scope B] Workflow failed: *builder*");
    unloadTelegramModule();

    mockedCallTelegramApi.mockClear();
    let bot: TelegramBot;
    const runtimeA = makeScopeRuntime(SCOPE_A);
    const runtimeB = makeScopeRuntime(SCOPE_B);
    let getUpdatesCount = 0;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getMe") {
        return { id: 1, first_name: "Bot", username: "kota_bot" };
      }
      if (method === "getUpdates") {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) return [makeUpdate(10, "hello from selected scope")];
        if (getUpdatesCount === 2) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [makeUpdate(11, "/scope scope-a")];
        }
        if (getUpdatesCount === 3) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [makeUpdate(12, "hello from scope a")];
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        bot.stop();
        return [];
      }
      return { message_id: 200 };
    });

    bot = new TelegramBot({
      token: "token",
      autonomyMode: "supervised",
      config: { modelProvider: { type: "openai" } },
      defaultScopeRuntime: runtimeA,
      getScopeRuntime: (scopeId) => {
        if (scopeId === SCOPE_A.scopeId) return runtimeA;
        if (scopeId === SCOPE_B.scopeId) return runtimeB;
        throw new Error(`unknown scope ${scopeId}`);
      },
      scopeSelection: selection,
    });
    await bot.start();

    expect(agentSessionOptions.map((options) => options.scopeRoot)).toEqual([
      SCOPE_B.scopeRoot,
      SCOPE_A.scopeRoot,
    ]);
    expect(agentSendMock).toHaveBeenCalledWith("hello from selected scope");
    expect(agentSendMock).toHaveBeenCalledWith("hello from scope a");
    expect(agentCloseMock).toHaveBeenCalled();
  });

  it("rechecks admission when a selected scope drains before session creation", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-drain-admission-"));
    const storage = new ModuleStorage(dir, "telegram");
    const selection = new TelegramScopeSelection(
      makeClient(makeSpies()),
      storage,
      [{ chatId: 99, scopeId: SCOPE_B.scopeId }],
    );
    const runtimeB = makeScopeRuntime(SCOPE_B);
    let bot: TelegramBot;
    let updateDelivered = false;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getMe") return { id: 1, first_name: "Bot" };
      if (method === "getUpdates" && !updateDelivered) {
        updateDelivered = true;
        return [makeUpdate(1, "start a session")];
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      bot.stop();
      return [];
    });
    const getScopeRuntime = vi.fn(() => {
      if (getScopeRuntime.mock.calls.length > 1) {
        throw new Error("Scope scope-b is draining and cannot accept channel work");
      }
      return runtimeB;
    });
    bot = new TelegramBot({
      token: "token",
      autonomyMode: "supervised",
      config: { modelProvider: { type: "openai" } },
      defaultScopeRuntime: makeScopeRuntime(SCOPE_A),
      getScopeRuntime,
      scopeSelection: selection,
    });

    await bot.start();

    expect(getScopeRuntime).toHaveBeenCalledTimes(2);
    expect(agentSessionOptions).toEqual([]);
    expect(agentSendMock).not.toHaveBeenCalled();
  });
});
