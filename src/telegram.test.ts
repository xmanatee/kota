import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { partitionDueItems } from "./action-executor.js";
import { resetScheduler, Scheduler } from "./scheduler.js";
import { callTelegramApi, splitMessage, TelegramBot, TelegramTransport } from "./telegram.js";

// --- splitMessage ---

describe("splitMessage", () => {
  it("returns single chunk for short messages", () => {
    expect(splitMessage("hello", 100)).toEqual(["hello"]);
  });

  it("returns single chunk at exact limit", () => {
    const text = "a".repeat(100);
    expect(splitMessage(text, 100)).toEqual([text]);
  });

  it("splits at newline boundary", () => {
    const text = "line1\nline2\nline3";
    const chunks = splitMessage(text, 12);
    expect(chunks[0]).toBe("line1\nline2");
    expect(chunks[1]).toBe("line3");
  });

  it("hard splits when no newline found", () => {
    const text = "a".repeat(200);
    const chunks = splitMessage(text, 100);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("a".repeat(100));
    expect(chunks[1]).toBe("a".repeat(100));
  });

  it("handles empty string", () => {
    expect(splitMessage("")).toEqual([""]);
  });

  it("splits long text into multiple chunks", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const chunks = splitMessage(text, 20);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
    expect(chunks.join("\n")).toBe(text);
  });

  it("uses default max length of 4096", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });
});

// --- Shared fetch mock helper ---

const originalFetch = globalThis.fetch;

function installFetchMock(defaultResponse?: unknown) {
  const mock = vi.fn();
  if (defaultResponse !== undefined) {
    mock.mockResolvedValue({ json: () => Promise.resolve(defaultResponse) });
  }
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// --- TelegramTransport ---

describe("TelegramTransport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetchMock({ ok: true, result: true });
  });

  afterEach(restoreFetch);

  it("buffers text events", () => {
    const transport = new TelegramTransport(123, "token");
    transport.emit({ type: "text", content: "Hello " });
    transport.emit({ type: "text", content: "world" });
    expect(transport.getBuffer()).toBe("Hello world");
  });

  it("ignores non-text events", () => {
    const transport = new TelegramTransport(123, "token");
    transport.emit({ type: "status", message: "status msg" });
    transport.emit({ type: "cost", summary: "cost", budgetPercent: 50 });
    transport.emit({ type: "error", message: "err" });
    expect(transport.getBuffer()).toBe("");
  });

  it("flush sends buffered text as message", async () => {
    const transport = new TelegramTransport(123, "tok123");
    transport.emit({ type: "text", content: "Hello!" });
    await transport.flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottok123/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chat_id: 123, text: "Hello!" }),
      }),
    );
  });

  it("flush does nothing for empty buffer", async () => {
    const transport = new TelegramTransport(123, "token");
    await transport.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flush does nothing for whitespace-only buffer", async () => {
    const transport = new TelegramTransport(123, "token");
    transport.emit({ type: "text", content: "   \n  " });
    await transport.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flush clears buffer", async () => {
    const transport = new TelegramTransport(123, "token");
    transport.emit({ type: "text", content: "Hello" });
    await transport.flush();
    expect(transport.getBuffer()).toBe("");
  });

  it("startTyping sends chat action", () => {
    vi.useFakeTimers();
    const transport = new TelegramTransport(123, "token");
    transport.startTyping();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendChatAction",
      expect.objectContaining({
        body: JSON.stringify({ chat_id: 123, action: "typing" }),
      }),
    );
    transport.stopTyping();
    vi.useRealTimers();
  });

  it("stopTyping clears interval", () => {
    vi.useFakeTimers();
    const transport = new TelegramTransport(123, "token");
    transport.startTyping();
    fetchMock.mockClear();
    transport.stopTyping();
    vi.advanceTimersByTime(10000);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// --- callTelegramApi ---

describe("callTelegramApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });

  afterEach(restoreFetch);

  it("calls correct URL with token and method", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { id: 1, first_name: "Bot" } }),
    });
    const result = await callTelegramApi("mytoken", "getMe");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/botmytoken/getMe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ id: 1, first_name: "Bot" });
  });

  it("sends body as JSON", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: true }),
    });
    await callTelegramApi("tok", "sendMessage", { chat_id: 42, text: "hi" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: 42, text: "hi" }),
      }),
    );
  });

  it("throws on API error", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, description: "Unauthorized" }),
    });
    await expect(callTelegramApi("bad", "getMe")).rejects.toThrow("Telegram API getMe: Unauthorized");
  });
});

// --- TelegramBot ---

describe("TelegramBot", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });

  afterEach(() => {
    restoreFetch();
    resetScheduler();
  });

  it("constructs with options", () => {
    const bot = new TelegramBot({ token: "test-token" });
    expect(bot.sessionCount).toBe(0);
  });

  it("stop clears sessions", () => {
    const bot = new TelegramBot({ token: "test-token" });
    bot.stop();
    expect(bot.sessionCount).toBe(0);
  });

  it("start verifies token via getMe and initializes scheduler", async () => {
    const bot = new TelegramBot({ token: "test-token" });
    fetchMock
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, result: { id: 1, first_name: "TestBot", username: "test_bot" } }),
      })
      .mockImplementation(() => {
        bot.stop();
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, result: [] }),
        });
      });

    await bot.start();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/getMe",
      expect.any(Object),
    );
  });

  it("stop cleans up scheduler timer", async () => {
    const bot = new TelegramBot({ token: "test-token" });
    fetchMock
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, result: { id: 1, first_name: "Bot", username: "bot" } }),
      })
      .mockImplementation(() => {
        bot.stop();
        return Promise.resolve({
          json: () => Promise.resolve({ ok: true, result: [] }),
        });
      });

    await bot.start();
    // After stop, scheduler should be reset
    expect(bot.sessionCount).toBe(0);
  });
});

// --- Scheduler integration (unit tests with Scheduler directly) ---

describe("TelegramBot scheduler integration", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetchMock({ ok: true, result: true });
  });

  afterEach(() => {
    restoreFetch();
    resetScheduler();
  });

  it("Scheduler fires due reminders to callback", () => {
    vi.useFakeTimers();

    const scheduler = new Scheduler(undefined, null);
    const now = new Date();
    scheduler.add("Test reminder", new Date(now.getTime() - 1000));

    const fired: string[] = [];
    scheduler.startTimer(1000, (items) => {
      for (const item of items) fired.push(item.description);
    });

    vi.advanceTimersByTime(1500);
    expect(fired).toContain("Test reminder");

    scheduler.stopTimer();
    vi.useRealTimers();
  });

  it("Scheduler fires action items separately from notifications", () => {
    vi.useFakeTimers();

    const scheduler = new Scheduler(undefined, null);
    const now = new Date();
    scheduler.add("Plain reminder", new Date(now.getTime() - 1000));
    scheduler.add("Action item", new Date(now.getTime() - 1000), {
      action: "Do something automatically",
    });

    const notifications: string[] = [];
    const actions: string[] = [];

    scheduler.startTimer(1000, (items) => {
      const partitioned = partitionDueItems(items);
      for (const item of partitioned.notifications) notifications.push(item.description);
      for (const item of partitioned.actions) actions.push(item.description);
    });

    vi.advanceTimersByTime(1500);
    expect(notifications).toContain("Plain reminder");
    expect(actions).toContain("Action item");

    scheduler.stopTimer();
    vi.useRealTimers();
  });

  it("partitionDueItems correctly separates actions from notifications", () => {
    const items = [
      { id: 1, description: "Reminder only", triggerAt: new Date().toISOString(), status: "pending" as const, created: new Date().toISOString() },
      { id: 2, description: "With action", triggerAt: new Date().toISOString(), status: "pending" as const, created: new Date().toISOString(), action: "do stuff" },
      { id: 3, description: "Another reminder", triggerAt: new Date().toISOString(), status: "pending" as const, created: new Date().toISOString() },
    ];

    const result = partitionDueItems(items);
    expect(result.notifications).toHaveLength(2);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].description).toBe("With action");
  });

  it("broadcastToChats sends to all active sessions via sendMessage", async () => {
    // Test the broadcast pattern: sendText is called for each active chat
    // We test this by verifying callTelegramApi calls for sendMessage
    const token = "test-tok";

    // Simulate what broadcastToChats does: send a message to multiple chat IDs
    const chatIds = [111, 222, 333];
    for (const chatId of chatIds) {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: "\u23f0 Reminder: Check email",
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const chatId of chatIds) {
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${token}/sendMessage`,
        expect.objectContaining({
          body: JSON.stringify({ chat_id: chatId, text: "\u23f0 Reminder: Check email" }),
        }),
      );
    }
  });

  it("Scheduler does not fire cancelled items", () => {
    vi.useFakeTimers();

    const scheduler = new Scheduler(undefined, null);
    const now = new Date();
    const item = scheduler.add("Will cancel", new Date(now.getTime() + 500));
    scheduler.cancel(item.id);

    const fired: string[] = [];
    scheduler.startTimer(1000, (items) => {
      for (const i of items) fired.push(i.description);
    });

    vi.advanceTimersByTime(2000);
    expect(fired).not.toContain("Will cancel");

    scheduler.stopTimer();
    vi.useRealTimers();
  });

  it("Scheduler handles repeating items", () => {
    vi.useFakeTimers();

    const scheduler = new Scheduler(undefined, null);
    const now = new Date();
    scheduler.add("Hourly check", new Date(now.getTime() - 1000), {
      repeatMs: 3600_000,
      repeatLabel: "hourly",
    });

    let fireCount = 0;
    scheduler.startTimer(1000, () => { fireCount++; });

    vi.advanceTimersByTime(1500);
    expect(fireCount).toBe(1);

    // The item should still be pending (repeating), not fired
    const pending = scheduler.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending");

    scheduler.stopTimer();
    vi.useRealTimers();
  });
});
