import { afterEach, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import { callTelegramApi } from "./client.js";
import { loadTelegramModule } from "./notification-subscriptions.js";
import { createTelegramRuntimeState } from "./runtime-state.js";

vi.mock("./client.js", async (original) => ({
  ...await original<typeof import("./client.js")>(),
  callTelegramApi: vi.fn(),
}));

function makePorts(bus: EventBus): Parameters<typeof loadTelegramModule>[0] {
  return {
    cwd: "/tmp/test",
    config: {},
    storage: new ModuleStorage("/tmp/test", "telegram"),
    getModuleConfig: () => undefined,
    getSecret: key => key === "TELEGRAM_BOT_TOKEN" ? "test-token" : key === "TELEGRAM_ALERT_CHAT_ID" ? "99" : null,
    events: makeStubEventProxy(bus),
    getProvider: () => null,
    registerProvider: () => {},
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    client: createKotaClientTestDouble(),
  };
}

afterEach(() => vi.clearAllMocks());

it("disposes only the notification state owned by one host", () => {
  const firstBus = new EventBus();
  const secondBus = new EventBus();
  const firstState = createTelegramRuntimeState();
  const secondState = createTelegramRuntimeState();
  const disposeFirst = loadTelegramModule(makePorts(firstBus), firstState);
  const disposeSecond = loadTelegramModule(makePorts(secondBus), secondState);
  vi.mocked(callTelegramApi).mockResolvedValue({ message_id: 42 });
  try {
    for (const state of [firstState, secondState]) {
      state.pendingOwnerQuestionMessages.set("question", { chatId: "99", messageId: 42, scopeId: "test-scope" });
      state.reportedPollConflicts.add("test-scope:conflict");
    }
    disposeFirst();
    firstBus.emit("module.crash.alert", { text: "first alert" });
    secondBus.emit("module.crash.alert", { text: "second alert" });

    expect(callTelegramApi).toHaveBeenCalledOnce();
    expect(vi.mocked(callTelegramApi).mock.calls[0]?.[2]).toMatchObject({ text: "second alert" });
    expect(firstState.pendingOwnerQuestionMessages.size).toBe(0);
    expect(firstState.reportedPollConflicts.size).toBe(0);
    expect(secondState.pendingOwnerQuestionMessages.has("question")).toBe(true);
    expect(secondState.reportedPollConflicts.has("test-scope:conflict")).toBe(true);
  } finally {
    disposeFirst();
    disposeSecond();
  }
});
