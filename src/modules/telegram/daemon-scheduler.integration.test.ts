import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import type { ChannelDef } from "#core/channels/channel.js";
import { Daemon } from "#core/daemon/daemon.js";
import { resetScheduler, Scheduler } from "#core/daemon/scheduler.js";
import { resetEventBus } from "#core/events/event-bus.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import { callTelegramApi } from "./client.js";
import { startTelegramStatusPoll } from "./status-poll.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("#modules/claude-agent-harness/executor.js");
  return { ...actual, executeWithAgentSDK: vi.fn() };
});

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return { ...actual, callTelegramApi: vi.fn() };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);
const mockedCallTelegramApi = vi.mocked(callTelegramApi);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function neverCalledClient<T>(): T {
  return new Proxy({}, {
    get: (_target, property) => async () => {
      throw new Error(`unexpected client call: ${String(property)}`);
    },
  }) as T;
}

describe("Telegram daemon scheduling", () => {
  let scopeRoot: string;
  let stateDir: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-telegram-scheduler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    stateDir = join(scopeRoot, ".kota");
    mkdirSync(join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder"), {
      recursive: true,
    });
    resetEventBus();
    resetScheduler();
    mockedExecuteWithAgentSDK.mockReset();
    mockedCallTelegramApi.mockReset();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("serves status and fires a scheduled item in one daemon process", async () => {
    writeFileSync(
      join(scopeRoot, "src", "modules", "autonomy", "workflows", "builder", "prompt.md"),
      "Build.\n",
    );
    mockedExecuteWithAgentSDK.mockResolvedValue({
      text: "done",
      streamedText: "",
      turns: 1,
      usage: UNKNOWN_AGENT_USAGE,
      subtype: "success",
      isError: false,
    });

    const statusChatId = 9_876_543_210;
    let delivered = false;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getUpdates") {
        if (delivered) {
          return [];
        }
        delivered = true;
        return [{
          update_id: 1,
          message: {
            message_id: 1,
            chat: { id: statusChatId, type: "private" },
            text: "/status",
            date: Math.floor(Date.now() / 1000),
          },
        }];
      }
      return true;
    });

    const telegramStatusChannel: ChannelDef = {
      name: "telegram-status-test",
      create(ctx) {
        let stop: (() => void) | null = null;
        return {
          status: "started",
          adapter: {
            listScopeSessionIds: () => [],
            async start() {
              stop = startTelegramStatusPoll(
                "test-token",
                String(statusChatId),
                ctx.getDefaultScopeRuntime().scope.scopeRoot,
                ctx.getWorkflowStatus,
                neverCalledClient<Parameters<typeof startTelegramStatusPoll>[4]>(),
                neverCalledClient<Parameters<typeof startTelegramStatusPoll>[5]>(),
                neverCalledClient<Parameters<typeof startTelegramStatusPoll>[6]>(),
                neverCalledClient<Parameters<typeof startTelegramStatusPoll>[7]>(),
                neverCalledClient<Parameters<typeof startTelegramStatusPoll>[8]>(),
                neverCalledClient<Parameters<typeof startTelegramStatusPoll>[9]>(),
                neverCalledClient<Parameters<typeof startTelegramStatusPoll>[10]>(),
                neverCalledClient<Parameters<typeof startTelegramStatusPoll>[11]>(),
                ctx.log,
              );
            },
            stop: () => stop?.(),
          },
        };
      },
    };

    const daemon = new Daemon({
      scopeRoot,
      model: "claude-sonnet-4-6",
      verbose: false,
      idleIntervalMs: 1000,
      stateDir,
      workflows: [
        registerWorkflowDefinition("test/builder.ts", {
          repository: "read",
          name: "builder",
          triggers: [{ event: "runtime.idle" }],
          steps: [{
            id: "build",
            type: "agent",
            promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
            harness: "claude-agent-sdk",
            model: "claude-opus-4-7",
            effort: "xhigh",
            autonomyMode: "autonomous",
          }],
        }),
      ],
      channels: [telegramStatusChannel],
      pollIntervalMs: 100,
    });
    new Scheduler(scopeRoot, stateDir).add("Test reminder", new Date(Date.now() - 1000));

    const startPromise = daemon.start();
    const deadline = Date.now() + 10_000;
    let sawStatusReply = false;
    let sawSchedulerFire = false;
    while (Date.now() < deadline) {
      sawStatusReply = mockedCallTelegramApi.mock.calls.some(
        ([, method]) => method === "sendMessage",
      );
      sawSchedulerFire = new Scheduler(scopeRoot, stateDir)
        .list()
        .some((item) => item.status === "fired");
      if (sawStatusReply && sawSchedulerFire) break;
      await wait(50);
    }

    await daemon.stop();
    await startPromise;
    expect(sawStatusReply).toBe(true);
    expect(sawSchedulerFire).toBe(true);
  });
});
