import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, resetEventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { channelSessionFixture } from "#root/channel-session-test-support.js";
import { TelegramBot } from "./bot.js";
import { callTelegramApi } from "./client.js";
import { loadTelegramModule } from "./notification-subscriptions.js";
import { createTelegramRuntimeState } from "./runtime-state.js";
import { TelegramScopeSelection } from "./scope-selection.js";
import { handleTelegramStatusCommand } from "./status-commands.js";
import {
  makeClient,
  makeSpies,
  makeStatusInfo,
} from "./telegram-scope-client-test-support.integration.js";
import {
  SCOPE_A,
  SCOPE_B,
} from "./telegram-scope-daemon-test-support.integration.js";
import {
  makeTelegramPorts,
  makeUpdate,
  sendBodies,
  waitFor,
} from "./telegram-scope-module-test-support.integration.js";

vi.mock("./client.js", async () => {
  const actual = await vi.importActual<typeof import("./client.js")>(
    "./client.js",
  );
  return { ...actual, callTelegramApi: vi.fn() };
});

const deliveredReplies: string[] = [];
const http = outboundHttpRequestPort((request) => {
  if (String(request.url).endsWith("/sendMessage")) deliveredReplies.push(JSON.parse(String(request.body)).text);
  return Response.json({ ok: true, result: { message_id: 200 } });
});

let sessions: ReturnType<typeof channelSessionFixture>;
beforeEach(() => { sessions = channelSessionFixture(); deliveredReplies.length = 0; });
afterEach(async () => { await sessions.close(); });

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

describe("telegram scope integration", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    resetEventBus();

    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    mockedCallTelegramApi.mockReset();
    resetProviderRegistry();
  });

  it("routes status commands, interactive sessions, and notifications through the selected scope", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-scope-"));
    const storage = new ModuleStorage(dir, "telegram");
    const spies = makeSpies();
    const client = makeClient(spies);
    const selection = new TelegramScopeSelection(client, storage, []);

    mockedCallTelegramApi.mockResolvedValue({ message_id: 100 });
    const statusInfo = makeStatusInfo();
    const defaultScope = {
      ...client,
      scopeRoot: SCOPE_A.scopeRoot,
      getStatusInfo: () => ({
        ...statusInfo,
        runtimeState: { ...statusInfo.runtimeState, activeRuns: [] },
      }),
    };
    for (const text of [
      "/memory alpha",
      "/scope scope-a",
      "/memory alpha",
      "/scope scope-b",
      "/memory alpha",
      "/capture-to-memory beta note",
      "/retract-memory mem-b",
      "/status",
    ]) {
      expect(await handleTelegramStatusCommand({
        token: "token",
        messageChatId: 99,
        text,
        defaultScope,
        scopeRouting: { client, selection },
      })).toBe(true);
    }
    expect(sendBodies()).toHaveLength(8);

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
      identifier: "mem-b",
    });
    expect(scopeBSpies.workflowStatus).toHaveBeenCalledOnce();
    expect(scopeASpies.workflowStatus).not.toHaveBeenCalled();
    expect(scopeASpies.capture).not.toHaveBeenCalled();
    expect(scopeASpies.retract).not.toHaveBeenCalled();
    expect(
      sendBodies().some((body) =>
        body.text.includes("not bound to a KOTA scope")
      ),
    ).toBe(true);
    expect(
      sendBodies().some((body) =>
        body.text.includes("alpha lives only in scope A")
      ),
    ).toBe(true);
    expect(
      sendBodies().some((body) => body.text === "No matching memory entries."),
    ).toBe(true);

    mockedCallTelegramApi.mockClear();
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_ALERT_CHAT_ID = "99";
    const bus = new EventBus();
    const dispose = loadTelegramModule(makeTelegramPorts(bus, client, storage), createTelegramRuntimeState());
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
    dispose();

    mockedCallTelegramApi.mockClear();
    let bot: TelegramBot;
    const runtimeA = sessions.runtime(SCOPE_A.scopeId);
    const runtimeB = sessions.runtime(SCOPE_B.scopeId);
    let getUpdatesCount = 0;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getMe") {
        return { id: 1, first_name: "Bot", username: "kota_bot" };
      }
      if (method === "getUpdates") {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) {
          return [makeUpdate(10, "hello from selected scope")];
        }
        if (getUpdatesCount === 2) {
          await waitFor(() => deliveredReplies.includes("Delivered model reply"));
          return [makeUpdate(11, "/scope scope-a")];
        }
        if (getUpdatesCount === 3) {
          await waitFor(() => sendBodies().some((body) => body.text.includes("Telegram chat is now using Scope A")));
          return [makeUpdate(12, "hello from scope a")];
        }
        await waitFor(() => deliveredReplies.filter((text) => text === "Delivered model reply").length === 2);
        bot.stop();
        return [];
      }
      return { message_id: 200 };
    });

    bot = new TelegramBot({
      token: "token",
      http,
      moduleLoader: sessions.loader,
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

    expect(sessions.modelRequests).toHaveLength(2);
    expect(JSON.stringify(sessions.modelRequests[0].messages)).toContain("hello from selected scope");
    expect(JSON.stringify(sessions.modelRequests[1].messages)).toContain("hello from scope a");
    expect(JSON.stringify(sessions.modelRequests[1].messages)).not.toContain("hello from selected scope");
    expect(bot.sessionCount).toBe(0);
  });

  it("rechecks admission when a selected scope drains before session creation", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-drain-admission-"));
    const storage = new ModuleStorage(dir, "telegram");
    const selection = new TelegramScopeSelection(
      makeClient(makeSpies()),
      storage,
      [{ chatId: 99, scopeId: SCOPE_B.scopeId }],
    );
    const runtimeB = sessions.runtime(SCOPE_B.scopeId);
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
        throw new Error(
          "Scope scope-b is draining and cannot accept channel work",
        );
      }
      return runtimeB;
    });
    bot = new TelegramBot({
      token: "token",
      http,
      moduleLoader: sessions.loader,
      autonomyMode: "supervised",
      config: { modelProvider: { type: "openai" } },
      defaultScopeRuntime: sessions.runtime(SCOPE_A.scopeId),
      getScopeRuntime,
      scopeSelection: selection,
    });

    await bot.start();

    expect(getScopeRuntime).toHaveBeenCalledTimes(2);
    expect(sessions.modelRequests).toEqual([]);
    expect(sendBodies().some((body) => body.text.includes("Something went wrong"))).toBe(true);
  });
});
