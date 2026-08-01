import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelDef } from "#core/channels/channel.js";
import { Daemon } from "#core/daemon/daemon.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { buildConfiguredProject } from "#core/daemon/scope-registry.js";
import { EventBus, getEventBus, resetEventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { callTelegramApi } from "./client.js";
import telegramModule from "./index.js";
import { TelegramProjectSelection } from "./project-selection.js";
import { startTelegramStatusPoll } from "./status-poll.js";
import {
  buildDaemonProjectClient,
  makeProjectScopedRoutes,
  type RoutedCall,
  readControlAddress,
} from "./telegram-project-scope-daemon-test-support.integration.js";
import {
  makeCtx,
  makeUpdate,
  sendBodies,
  waitFor,
} from "./telegram-project-scope-module-test-support.integration.js";

vi.mock("./client.js", async () => {
  const actual =
    await vi.importActual<typeof import("./client.js")>("./client.js");
  return { ...actual, callTelegramApi: vi.fn() };
});

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

describe("telegram project-scope integration", () => {
  let dir = "";

  afterEach(async () => {
    await telegramModule.onUnload?.();
    if (dir) rmSync(dir, { recursive: true, force: true });
    resetEventBus();
    resetScheduler();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    mockedCallTelegramApi.mockReset();
    resetProviderRegistry();
  });

  it("boots a two-project daemon and routes Telegram status commands through the selected daemon project", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-project-scope-daemon-"));
    const stateDir = join(dir, "daemon-state");
    const dirA = join(dir, "project-a");
    const dirB = join(dir, "project-b");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const projectA = buildConfiguredProject({ projectDir: dirA, displayName: "Project A" });
    const projectB = buildConfiguredProject({ projectDir: dirB, displayName: "Project B" });
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
          makeUpdate(2, `/project ${projectA.projectId}`),
          makeUpdate(3, "/memory alpha"),
          makeUpdate(4, `/project ${projectB.projectId}`),
          makeUpdate(5, "/memory alpha"),
          makeUpdate(6, "/capture-to-memory beta note"),
          makeUpdate(7, "/retract-memory mem-b"),
        ];
      }
      return { message_id: 100 };
    });

    const telegramStatusChannel: ChannelDef = {
      name: "telegram-status-daemon-project-scope",
      create(channelCtx) {
        let stop: (() => void) | null = null;
        return {
          status: "started",
          adapter: {
            listScopeSessionIds: () => [],
            async start() {
              const client = buildDaemonProjectClient(readControlAddress(stateDir));
              const selection = new TelegramProjectSelection(
                client,
                new ModuleStorage(dir, "telegram"),
                [],
              );
              stop = startTelegramStatusPoll(
                token,
                chatId,
                channelCtx.getDefaultProjectRuntime().project.projectDir,
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

    const daemon = new Daemon({
      projects: [
        { projectDir: dirA, displayName: "Project A" },
        { projectDir: dirB, displayName: "Project B" },
      ],
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      workflows: [],
      channels: [telegramStatusChannel],
      routes: makeProjectScopedRoutes(routedCalls, projectA),
      config: { defaultAgentHarness: "claude-agent-sdk" },
    });

    const startPromise = daemon.start();
    try {
      await waitFor(() => sendBodies().length >= 7, 3_000);

      expect(sendBodies().some((body) => body.text.includes("not bound to a KOTA project"))).toBe(true);
      expect(sendBodies().some((body) => body.text.includes("alpha lives only in project A"))).toBe(true);
      expect(sendBodies().some((body) => body.text === "No matching memory entries.")).toBe(true);
      expect(routedCalls).toEqual(
        expect.arrayContaining([
          { kind: "memory", projectId: projectA.projectId, query: "alpha" },
          { kind: "memory", projectId: projectB.projectId, query: "alpha" },
          { kind: "capture", projectId: projectB.projectId, text: "beta note" },
          { kind: "retract", projectId: projectB.projectId, id: "mem-b" },
        ]),
      );

      const client = buildDaemonProjectClient(readControlAddress(stateDir));
      telegramModule.onLoad!(
        makeCtx(getEventBus() ?? new EventBus(), client, new ModuleStorage(dir, "telegram")),
      );
      mockedCallTelegramApi.mockClear();
      getEventBus()?.emit("workflow.failure.alert", {
        projectId: projectB.projectId,
        workflow: "builder",
        runId: "run-b",
        status: "failed",
        durationMs: 1000,
        errorSummary: "boom",
        text: "Workflow failed: *builder*",
      });
      await waitFor(() => sendBodies().length === 1);
      expect(sendBodies()[0]?.text).toBe("[Project B] Workflow failed: *builder*");
    } finally {
      await daemon.stop();
      await startPromise;
    }
  });

});
