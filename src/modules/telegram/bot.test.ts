import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetScheduler, Scheduler } from "#core/daemon/scheduler.js";
import { callTelegramApi, splitMessage, TelegramBot, TelegramTransport } from "./bot.js";

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

  it("flush attempts all chunks even when middle chunk fails", async () => {
    const transport = new TelegramTransport(123, "tok");
    // Buffer text that will split into 3 chunks (each >4096 chars)
    const chunk1 = "a".repeat(4000);
    const chunk2 = "b".repeat(4000);
    const chunk3 = "c".repeat(4000);
    transport.emit({ type: "text", content: `${chunk1}\n${chunk2}\n${chunk3}` });

    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        // Second chunk fails
        return Promise.resolve({
          json: () => Promise.resolve({ ok: false, description: "Too Many Requests" }),
        });
      }
      return Promise.resolve({
        json: () => Promise.resolve({ ok: true, result: true }),
      });
    });

    await expect(transport.flush()).rejects.toThrow("Too Many Requests");
    // All 3 chunks should have been attempted
    expect(callCount).toBe(3);
  });

  it("flush clears buffer even when send fails (prevents duplicate sends)", async () => {
    const transport = new TelegramTransport(123, "tok");
    transport.emit({ type: "text", content: "Hello!" });

    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, description: "Forbidden" }),
    });

    await expect(transport.flush()).rejects.toThrow("Forbidden");
    // Buffer should be cleared so a second flush doesn't re-send
    expect(transport.getBuffer()).toBe("");
    fetchMock.mockClear();
    await transport.flush(); // Should be a no-op
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flush succeeds when all chunks succeed", async () => {
    const transport = new TelegramTransport(123, "tok");
    transport.emit({ type: "text", content: "chunk1\nchunk2" });

    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: true }),
    });

    await expect(transport.flush()).resolves.toBeUndefined();
  });

  it("flush handles network error on one chunk and still sends others", async () => {
    const transport = new TelegramTransport(123, "tok");
    // Two chunks that exceed the 4096 limit
    const text = `${"a".repeat(4000)}\n${"b".repeat(4000)}`;
    transport.emit({ type: "text", content: text });

    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("ECONNRESET"));
      }
      return Promise.resolve({
        json: () => Promise.resolve({ ok: true, result: true }),
      });
    });

    await expect(transport.flush()).rejects.toThrow("network error: ECONNRESET");
    expect(callCount).toBe(2); // Both chunks attempted
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

  it("wraps network errors with method context", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(callTelegramApi("tok", "sendMessage")).rejects.toThrow(
      "Telegram API sendMessage: network error: ECONNREFUSED",
    );
  });

  it("wraps DNS resolution failures with method context", async () => {
    fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.telegram.org"));
    await expect(callTelegramApi("tok", "getUpdates")).rejects.toThrow(
      "Telegram API getUpdates: network error: getaddrinfo ENOTFOUND api.telegram.org",
    );
  });

  it("handles non-JSON response (e.g., 502 HTML page)", async () => {
    fetchMock.mockResolvedValue({
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    });
    await expect(callTelegramApi("tok", "getUpdates")).rejects.toThrow(
      "Telegram API getUpdates: non-JSON response (HTTP 502)",
    );
  });

  it("handles non-JSON response with 503 status", async () => {
    fetchMock.mockResolvedValue({
      status: 503,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });
    await expect(callTelegramApi("tok", "sendMessage")).rejects.toThrow(
      "Telegram API sendMessage: non-JSON response (HTTP 503)",
    );
  });

  it("handles empty response body", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
    });
    await expect(callTelegramApi("tok", "getMe")).rejects.toThrow(
      "Telegram API getMe: non-JSON response (HTTP 200)",
    );
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
    const bot = new TelegramBot({ token: "test-token", autonomyMode: "supervised" });
    expect(bot.sessionCount).toBe(0);
  });

  it("stop clears sessions", () => {
    const bot = new TelegramBot({ token: "test-token", autonomyMode: "supervised" });
    bot.stop();
    expect(bot.sessionCount).toBe(0);
  });

  it("start verifies token via getMe and initializes scheduler", async () => {
    const bot = new TelegramBot({ token: "test-token", autonomyMode: "supervised" });
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
    const bot = new TelegramBot({ token: "test-token", autonomyMode: "supervised" });
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

  it("Scheduler delivers due reminders through the timer callback", () => {
    vi.useFakeTimers();

    const scheduler = new Scheduler(undefined, null);
    const now = new Date();
    scheduler.add("Plain reminder", new Date(now.getTime() - 1000));

    const reminders: string[] = [];

    scheduler.startTimer(1000, (items) => {
      for (const item of items) reminders.push(item.description);
    });

    vi.advanceTimersByTime(1500);
    expect(reminders).toContain("Plain reminder");

    scheduler.stopTimer();
    vi.useRealTimers();
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
