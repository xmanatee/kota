import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelDef } from "#core/channels/channel.js";
import { Daemon } from "#core/daemon/daemon.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { EventBus, resetEventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { callTelegramApi } from "./client.js";
import telegramModule from "./index.js";
import { unloadTelegramModule } from "./notification-subscriptions.js";
import { TelegramScopeSelection } from "./scope-selection.js";
import { startTelegramStatusPoll } from "./status-poll.js";
import {
  buildDaemonScopeClient,
  makeScopedRoutes,
  type RoutedCall,
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
    mockedCallTelegramApi.mockReset();
    resetProviderRegistry();
  });

  it("boots a two-scope daemon and routes Telegram status commands through the selected daemon scope", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-scope-daemon-"));
    const stateDir = join(dir, "daemon-state");
    const dirA = join(dir, "scope-a");
    const dirB = join(dir, "scope-b");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const scopeA = buildDirectoryScope({ scopeRoot: dirA, displayName: "Scope A" });
    const scopeB = buildDirectoryScope({ scopeRoot: dirB, displayName: "Scope B" });
    const routedCalls: RoutedCall[] = [];
    const token = "daemon-token";
    const chatId = "99";
    process.env.TELEGRAM_BOT_TOKEN = token;
    process.env.TELEGRAM_ALERT_CHAT_ID = chatId;

    let delivered = false;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getUpdates") {
        if (delivered) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [];
        }
        delivered = true;
        return [
          makeUpdate(1, "/memory alpha"),
          makeUpdate(2, `/scope ${scopeA.scopeId}`),
          makeUpdate(3, "/memory alpha"),
          makeUpdate(4, `/scope ${scopeB.scopeId}`),
          makeUpdate(5, "/memory alpha"),
          makeUpdate(6, "/capture-to-memory beta note"),
          makeUpdate(7, "/retract-memory mem-b"),
        ];
      }
      return { message_id: 100 };
    });

    const telegramStatusChannel: ChannelDef = {
      name: "telegram-status-daemon-scope",
      create(channelCtx) {
        let stop: (() => void) | null = null;
        return {
          status: "started",
          adapter: {
            listScopeSessionIds: () => [],
            async start() {
              const client = buildDaemonScopeClient(readControlAddress(stateDir));
              const selection = new TelegramScopeSelection(
                client,
                new ModuleStorage(dir, "telegram"),
                [],
              );
              stop = startTelegramStatusPoll(
                token,
                chatId,
                channelCtx.getDefaultScopeRuntime().scope.scopeRoot,
                channelCtx.getWorkflowStatus,
                client.knowledge,
                client.memory,
                client.history,
                client.tasks,
                client.recall,
                client.answer,
                client.capture,
                client.retract,
                channelCtx.log,
                { client, selection },
              );
            },
            stop() {
              stop?.();
            },
          },
        };
      },
    };

    const eventBus = new EventBus();
    const moduleLoader = new ModuleLoader({}, false, { mode: "runtime" });
    moduleLoader.setBus(eventBus);
    const daemon = new Daemon({
      runtimeModuleHost: { eventBus, moduleLoader },
      scopes: [
        { scopeRoot: dirA, displayName: "Scope A" },
        { scopeRoot: dirB, displayName: "Scope B" },
      ],
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      workflows: [],
      channels: [telegramStatusChannel],
      routes: makeScopedRoutes(routedCalls, scopeA),
      config: { defaultAgentHarness: "claude-agent-sdk" },
    });

    const startPromise = daemon.start();
    try {
      await waitFor(() => sendBodies().length >= 7, 3_000);

      expect(sendBodies().some((body) => body.text.includes("not bound to a KOTA scope"))).toBe(true);
      expect(sendBodies().some((body) => body.text.includes("alpha lives only in scope A"))).toBe(true);
      expect(sendBodies().some((body) => body.text === "No matching memory entries.")).toBe(true);
      expect(routedCalls).toEqual(
        expect.arrayContaining([
          { kind: "memory", scopeId: scopeA.scopeId, query: "alpha" },
          { kind: "memory", scopeId: scopeB.scopeId, query: "alpha" },
          { kind: "capture", scopeId: scopeB.scopeId, text: "beta note" },
          { kind: "retract", scopeId: scopeB.scopeId, id: "mem-b" },
        ]),
      );

      const client = buildDaemonScopeClient(readControlAddress(stateDir));
      telegramModule.onLoad!(
        makeCtx(eventBus, client, new ModuleStorage(dir, "telegram")),
      );
      mockedCallTelegramApi.mockClear();
      eventBus.emit("workflow.failure.alert", {
        scopeId: scopeB.scopeId,
        workflow: "builder",
        runId: "run-b",
        status: "failed",
        durationMs: 1000,
        errorSummary: "boom",
        text: "Workflow failed: *builder*",
      });
      await waitFor(() => sendBodies().length === 1);
      expect(sendBodies()[0]?.text).toBe("[Scope B] Workflow failed: *builder*");
    } finally {
      await daemon.stop();
      await startPromise;
    }
  });

});
