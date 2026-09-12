import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, resetEventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { outboundHttp } from "#core/outbound-http/index.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { channelSessionFixture } from "#root/channel-session-test-support.js";
import { makeTelegramInteractiveChannel } from "./channels.js";
import { callTelegramApi } from "./client.js";
import { createTelegramRuntimeState } from "./runtime-state.js";
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

let sessions: ReturnType<typeof channelSessionFixture>;
beforeEach(() => { sessions = channelSessionFixture(); });
afterEach(async () => { await sessions.close(); vi.restoreAllMocks(); });

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

  it("routes interactive slash commands with a pre-daemon local client and the daemon scope provider", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-local-client-scope-"));
    registerDaemonScopeProvider();
    const replies: string[] = [];
    vi.spyOn(outboundHttp, "request").mockImplementation(outboundHttpRequestPort((request) => {
      if (String(request.url).endsWith("/sendMessage")) replies.push(JSON.parse(String(request.body)).text);
      return Response.json({ ok: true, result: { message_id: 100 } });
    }).request);
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
          makeUpdate(3, "Reply in the selected scope"),
        ];
      }
      return { message_id: 100 };
    });

    const ctx = makeTelegramPorts(new EventBus(), localClient, storage);
    ctx.getModuleConfig = () =>
      ({ defaultAutonomyMode: "supervised" }) as never;
    const interactive = makeTelegramInteractiveChannel(ctx, [], createTelegramRuntimeState());
    const runtimeA = sessions.runtime(SCOPE_A.scopeId);
    const runtimeB = sessions.runtime(SCOPE_B.scopeId);
    const started = interactive.create({
      moduleLoader: sessions.loader,
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
      await waitFor(() => replies.includes("Delivered model reply"));
      expect(started.adapter.listScopeSessionIds(SCOPE_B.scopeId)).toHaveLength(1);
      expect(started.adapter.listScopeSessionIds(SCOPE_A.scopeId)).toEqual([]);
      expect(JSON.stringify(sessions.modelRequests.at(-1)?.messages)).toContain("Reply in the selected scope");
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
