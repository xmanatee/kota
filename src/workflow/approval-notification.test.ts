import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import { callTelegramApi } from "../telegram-client.js";
import { subscribeApprovalNotification } from "./approval-notification.js";

vi.mock("../telegram-client.js", () => ({
  callTelegramApi: vi.fn(),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

const FAKE_TOKEN = "bot-token-123";
const FAKE_CHAT_ID = "987654321";

function makePayload(overrides: Partial<{
  id: string;
  tool: string;
  risk: string;
  reason: string;
  source: string;
}> = {}) {
  return {
    id: overrides.id ?? "abc12345",
    tool: overrides.tool ?? "bash",
    risk: overrides.risk ?? "high",
    reason: overrides.reason ?? "Runs arbitrary shell commands",
    source: overrides.source ?? "builder",
  };
}

describe("subscribeApprovalNotification", () => {
  let bus: EventBus;
  let unsubscribe: () => void;

  beforeEach(() => {
    bus = new EventBus();
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue({ ok: true, result: {} } as never);
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    process.env.TELEGRAM_ALERT_CHAT_ID = FAKE_CHAT_ID;
    unsubscribe = subscribeApprovalNotification(bus);
  });

  afterEach(() => {
    unsubscribe();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
  });

  it("sends notification on approval.requested", async () => {
    bus.emit("approval.requested", makePayload());
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "sendMessage",
      expect.objectContaining({
        chat_id: FAKE_CHAT_ID,
        parse_mode: "Markdown",
      }),
    );
  });

  it("includes tool name, risk, reason, and id in message", async () => {
    bus.emit("approval.requested", makePayload());
    await Promise.resolve();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("bash");
    expect(body.text).toContain("high");
    expect(body.text).toContain("Runs arbitrary shell commands");
    expect(body.text).toContain("abc12345");
  });

  it("includes copy-paste approve and reject commands", async () => {
    bus.emit("approval.requested", makePayload({ id: "xyz99" }));
    await Promise.resolve();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("kota approval approve xyz99");
    expect(body.text).toContain("kota approval reject xyz99");
  });

  it("is a no-op when TELEGRAM_BOT_TOKEN is missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    bus.emit("approval.requested", makePayload());
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("is a no-op when TELEGRAM_ALERT_CHAT_ID is missing", async () => {
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    bus.emit("approval.requested", makePayload());
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("catches and logs Telegram API errors without throwing", async () => {
    const logs: string[] = [];
    unsubscribe();
    unsubscribe = subscribeApprovalNotification(bus, (msg) => logs.push(msg));
    mockedCallTelegramApi.mockRejectedValue(new Error("network failure"));
    bus.emit("approval.requested", makePayload());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("network failure");
  });

  it("unsubscribes correctly and stops receiving events", async () => {
    unsubscribe();
    bus.emit("approval.requested", makePayload());
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });
});
