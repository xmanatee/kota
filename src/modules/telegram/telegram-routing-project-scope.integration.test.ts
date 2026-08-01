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
import { TelegramProjectSelection } from "./project-selection.js";
import { startTelegramStatusPoll } from "./status-poll.js";
import {
  makeClient,
  makeSpies,
  makeStatusInfo,
} from "./telegram-project-scope-client-test-support.integration.js";
import {
  makeProjectRuntime,
  PROJECT_A,
  PROJECT_B,
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

describe("telegram project-scope integration", () => {
  let dir = "";

  afterEach(async () => {
    await telegramModule.onUnload?.();
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

  it("routes status commands, interactive sessions, and notifications through the selected project", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-project-scope-"));
    const storage = new ModuleStorage(dir, "telegram");
    const spies = makeSpies();
    const client = makeClient(spies);
    const selection = new TelegramProjectSelection(client, storage, []);

    let firstPoll = true;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getUpdates") {
        if (!firstPoll) return [];
        firstPoll = false;
        return [
          makeUpdate(1, "/memory alpha"),
          makeUpdate(2, "/project project-a"),
          makeUpdate(3, "/memory alpha"),
          makeUpdate(4, "/project project-b"),
          makeUpdate(5, "/memory alpha"),
          makeUpdate(6, "/capture-to-memory beta note"),
          makeUpdate(7, "/retract-memory mem-b"),
          makeUpdate(8, "/status"),
        ];
      }
      return { message_id: 100 };
    });

    const stopStatus = startTelegramStatusPoll(
      "token",
      "99",
      PROJECT_A.projectDir,
      makeStatusInfo,
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

    const projectASpies = spies.get(PROJECT_A.projectId)!;
    const projectBSpies = spies.get(PROJECT_B.projectId)!;
    expect(projectASpies.memorySearch).toHaveBeenCalledWith("alpha", {
      semantic: true,
      limit: 10,
    });
    expect(projectBSpies.memorySearch).toHaveBeenCalledWith("alpha", {
      semantic: true,
      limit: 10,
    });
    expect(projectBSpies.capture).toHaveBeenCalledWith("beta note", {
      target: "memory",
    });
    expect(projectBSpies.retract).toHaveBeenCalledWith({
      target: "memory",
      id: "mem-b",
    });
    expect(projectBSpies.workflowStatus).toHaveBeenCalledOnce();
    expect(projectASpies.workflowStatus).not.toHaveBeenCalled();
    expect(projectASpies.capture).not.toHaveBeenCalled();
    expect(projectASpies.retract).not.toHaveBeenCalled();
    expect(sendBodies().some((body) => body.text.includes("not bound to a KOTA project"))).toBe(true);
    expect(sendBodies().some((body) => body.text.includes("alpha lives only in project A"))).toBe(true);
    expect(sendBodies().some((body) => body.text === "No matching memory entries.")).toBe(true);

    mockedCallTelegramApi.mockClear();
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_ALERT_CHAT_ID = "99";
    const bus = new EventBus();
    telegramModule.onLoad!(makeCtx(bus, client, storage));
    bus.emit("workflow.failure.alert", {
      projectId: PROJECT_B.projectId,
      workflow: "builder",
      runId: "run-b",
      status: "failed",
      durationMs: 1000,
      errorSummary: "boom",
      text: "Workflow failed: *builder*",
    });
    await waitFor(() => sendBodies().length === 1);
    expect(sendBodies()[0]?.text).toBe("[Project B] Workflow failed: *builder*");
    await telegramModule.onUnload?.();

    mockedCallTelegramApi.mockClear();
    let bot: TelegramBot;
    const runtimeA = makeProjectRuntime(PROJECT_A);
    const runtimeB = makeProjectRuntime(PROJECT_B);
    let getUpdatesCount = 0;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getMe") {
        return { id: 1, first_name: "Bot", username: "kota_bot" };
      }
      if (method === "getUpdates") {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) return [makeUpdate(10, "hello from selected project")];
        if (getUpdatesCount === 2) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [makeUpdate(11, "/project project-a")];
        }
        if (getUpdatesCount === 3) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [makeUpdate(12, "hello from project a")];
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
      defaultProjectRuntime: runtimeA,
      getProjectRuntime: (projectId) => {
        if (projectId === PROJECT_A.projectId) return runtimeA;
        if (projectId === PROJECT_B.projectId) return runtimeB;
        throw new Error(`unknown project ${projectId}`);
      },
      projectSelection: selection,
    });
    await bot.start();

    expect(agentSessionOptions.map((options) => options.projectDir)).toEqual([
      PROJECT_B.projectDir,
      PROJECT_A.projectDir,
    ]);
    expect(agentSendMock).toHaveBeenCalledWith("hello from selected project");
    expect(agentSendMock).toHaveBeenCalledWith("hello from project a");
    expect(agentCloseMock).toHaveBeenCalled();
  });

  it("rechecks admission when a selected scope drains before session creation", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-drain-admission-"));
    const storage = new ModuleStorage(dir, "telegram");
    const selection = new TelegramProjectSelection(
      makeClient(makeSpies()),
      storage,
      [{ chatId: 99, projectId: PROJECT_B.projectId }],
    );
    const runtimeB = makeProjectRuntime(PROJECT_B);
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
    const getProjectRuntime = vi.fn(() => {
      if (getProjectRuntime.mock.calls.length > 1) {
        throw new Error("Scope project-b is draining and cannot accept channel work");
      }
      return runtimeB;
    });
    bot = new TelegramBot({
      token: "token",
      autonomyMode: "supervised",
      config: { modelProvider: { type: "openai" } },
      defaultProjectRuntime: makeProjectRuntime(PROJECT_A),
      getProjectRuntime,
      projectSelection: selection,
    });

    await bot.start();

    expect(getProjectRuntime).toHaveBeenCalledTimes(2);
    expect(agentSessionOptions).toEqual([]);
    expect(agentSendMock).not.toHaveBeenCalled();
  });
});
