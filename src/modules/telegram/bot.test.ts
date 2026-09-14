import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessResult,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import {
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import {
  type InboundSignalReceivedPayload,
  type InboundSignalRoutedPayload,
  inboundSignalReceived,
} from "#modules/inbound-signals/events.js";
import { dispatchInboundSignalRoute } from "#modules/inbound-signals/routing.js";
import {
  TRANSCRIPTION_PROVIDER_TYPE,
  type TranscriptionProvider,
} from "#modules/transcription/index.js";
import { channelSessionFixture } from "#root/channel-session-test-support.js";
import {
  callTelegramApi as callProductionTelegramApi,
  TelegramTransport as ProductionTelegramTransport,
  TelegramBot,
  type TelegramBotOptions,
} from "./bot.js";
import {
  ERROR_BACKOFF_MS,
  POLL_REQUEST_TIMEOUT_MS,
  POLL_TIMEOUT_S,
  type TelegramApiBody,
} from "./client.js";
import { TELEGRAM_SIGNAL_ALLOWED_UPDATES } from "./inbound-signal.js";
import { resetTelegramPollingOwnersForTests } from "./polling-ownership.js";
import { TelegramScopeSelection } from "./scope-selection.js";

let sessions: ReturnType<typeof channelSessionFixture>;
beforeEach(() => { sessions = channelSessionFixture(); });
afterEach(async () => { await sessions.close(); });

const harnessResult: AgentHarnessResult = {
  text: "harness response",
  streamedText: "harness response",
  turns: 1,
  usage: {
    tokens: { state: "complete", inputTokens: 3, outputTokens: 4 },
    cost: { state: "unknown" },
  },
  isError: false,
};

function makeTestHarness(name: string): AgentHarness {
  return {
    name,
    description: `${name} test harness`,
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    unsupportedRunOptions: [],
    async run() {
      return harnessResult;
    },
  };
}

function makeScopeRuntime(scopeId = "scope-a") {
  return sessions.runtime(scopeId);
}

function botOptions(
  overrides: Partial<TelegramBotOptions> = {},
): TelegramBotOptions {
  const defaultScopeRuntime =
    overrides.defaultScopeRuntime ?? makeScopeRuntime();
  return {
    token: "tok",
    autonomyMode: "supervised",
    config: { modelProvider: { type: "openai" } },
    defaultScopeRuntime,
    getScopeRuntime: (scopeId) =>
      scopeId === defaultScopeRuntime.scope.scopeId
        ? defaultScopeRuntime
        : makeScopeRuntime(scopeId),
    http: telegramHttp,
    moduleLoader: sessions.loader,
    ...overrides,
  };
}

// --- Shared Telegram request-port fixture ---

let activeTelegramRequest = vi.fn();
const telegramHttp = outboundHttpRequestPort(async (request) =>
  activeTelegramRequest(String(request.url), {
    method: request.method ?? "GET",
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    limits: request.limits,
  }) as Promise<Response>
);

function installFetchMock(defaultResponse?: unknown) {
  const mock = vi.fn();
  if (defaultResponse !== undefined) {
    mock.mockResolvedValue({ json: () => Promise.resolve(defaultResponse) });
  }
  activeTelegramRequest = mock;
  return mock;
}

function callTelegramApi<T>(
  token: string,
  method: string,
  body?: TelegramApiBody,
): Promise<T> {
  return callProductionTelegramApi<T>(token, method, body, { http: telegramHttp });
}

class TelegramTransport extends ProductionTelegramTransport {
  constructor(chatId: number, token: string) {
    super(chatId, token, telegramHttp);
  }
}

// --- TelegramTransport ---

describe("TelegramTransport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetchMock({ ok: true, result: true });
  });

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

  it.each([4094, 4095])("flush preserves emoji at boundary %i", async (prefixLength) => {
    const transport = new TelegramTransport(123, "tok");
    const text = `${"a".repeat(prefixLength)}😀`;
    transport.emit({ type: "text", content: text });
    await transport.flush();
    const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(bodies).toEqual(prefixLength === 4094
      ? [{ chat_id: 123, text }]
      : [{ chat_id: 123, text: "a".repeat(prefixLength) }, { chat_id: 123, text: "😀" }]);
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
    resetTelegramPollingOwnersForTests();
    fetchMock = installFetchMock();
  });

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
  let origPreset: string | undefined;

  beforeEach(() => {
    origPreset = process.env.KOTA_PRESET;
    delete process.env.KOTA_PRESET;
    fetchMock = installFetchMock();
  });

  afterEach(() => {
    if (origPreset !== undefined) {
      process.env.KOTA_PRESET = origPreset;
    } else {
      delete process.env.KOTA_PRESET;
    }
    resetTelegramPollingOwnersForTests();
  });

  it("stop clears sessions", () => {
    const bot = new TelegramBot(botOptions({ token: "test-token" }));
    bot.stop();
    expect(bot.sessionCount).toBe(0);
  });

  it("start verifies token via getMe", async () => {
    const bot = new TelegramBot(botOptions({ token: "test-token" }));
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

  it("retries a transient getMe failure before polling", async () => {
    vi.useFakeTimers();
    const bot = new TelegramBot(botOptions({ token: "test-token" }));
    let getMeAttempts = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/getMe")) {
        getMeAttempts++;
        if (getMeAttempts === 1) {
          return {
            status: 504,
            json: () =>
              Promise.resolve({
                ok: false,
                error_code: 504,
                description: "Gateway Timeout",
              }),
          };
        }
        return {
          status: 200,
          json: () =>
            Promise.resolve({
              ok: true,
              result: { id: 1, first_name: "TestBot" },
            }),
        };
      }
      if (url.endsWith("/getUpdates")) {
        bot.stop();
        return {
          status: 200,
          json: () => Promise.resolve({ ok: true, result: [] }),
        };
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const started = bot.start();
    await vi.advanceTimersByTimeAsync(ERROR_BACKOFF_MS);
    await started;

    expect(getMeAttempts).toBe(2);
    vi.useRealTimers();
  });

  it("does not retry a permanent getMe API error", async () => {
    const bot = new TelegramBot(botOptions({ token: "bad-token" }));
    fetchMock.mockResolvedValue({
      status: 401,
      json: () =>
        Promise.resolve({
          ok: false,
          error_code: 401,
          description: "Unauthorized",
        }),
    });

    await expect(bot.start()).rejects.toThrow("Telegram API getMe: Unauthorized");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats getUpdates conflict as terminal instead of retrying forever", async () => {
    const bot = new TelegramBot(botOptions({ token: "test-token" }));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/getMe")) {
        return {
          json: () =>
            Promise.resolve({
              ok: true,
              result: { id: 1, first_name: "TestBot", username: "test_bot" },
            }),
        };
      }
      if (url.endsWith("/getUpdates")) {
        return {
          json: () =>
            Promise.resolve({
              ok: false,
              description:
                "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
            }),
        };
      }
      throw new Error(`unexpected URL ${url}`);
    });

    await expect(bot.start()).rejects.toThrow(
      "another Telegram Bot API getUpdates consumer is already using this bot token",
    );
    const getUpdatesCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith("/getUpdates"),
    );
    expect(getUpdatesCalls).toHaveLength(1);
  });

  it("rejects a duplicate TelegramBot getUpdates owner for the same token", async () => {
    const first = new TelegramBot(botOptions({ token: "shared-token" }));
    const second = new TelegramBot(botOptions({ token: "shared-token" }));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/getMe")) {
        return {
          json: () =>
            Promise.resolve({
              ok: true,
              result: { id: 1, first_name: "TestBot", username: "test_bot" },
            }),
        };
      }
      if (url.endsWith("/getUpdates")) {
        return new Promise((resolve) => {
          init?.signal?.addEventListener("abort", () => {
            resolve({
              json: () => Promise.resolve({ ok: true, result: [] }),
            });
          });
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const firstStart = first.start();
    const deadline = Date.now() + 1_500;
    while (
      Date.now() < deadline &&
      !fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/getUpdates"))
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }

    await expect(second.start()).rejects.toThrow(
      'cannot start because "telegram-interactive" (TelegramBot.start) already owns this bot token',
    );
    first.stop();
    await firstStart;
  });

  it.each([true, false])("routes tracked replies without opening a session, and delivers untracked replies (%s)", async (tracked) => {
    const onChatReply = vi.fn(async () => tracked);
    const bot = new TelegramBot(botOptions({ onChatReply }));
    let delivered = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/getMe")) return Response.json({ ok: true, result: { id: 1, first_name: "Bot" } });
      if (!url.endsWith("/getUpdates")) return Response.json({ ok: true, result: true });
      if (!delivered) {
        delivered = true;
        return Response.json({ ok: true, result: [{ update_id: 1, message: {
          message_id: 2, chat: { id: 9, type: "private" }, date: 0,
          text: "what about edge case X?", reply_to_message: { message_id: 1 },
        } }] });
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ ok: true, result: [] });
    });
    const running = bot.start();
    try {
      await vi.waitFor(() => expect(onChatReply).toHaveBeenCalledWith(9, 1, "what about edge case X?"));
      if (tracked) expect(bot.sessionCount).toBe(0);
      else {
        await vi.waitFor(() => expect(sentTexts()).toContain("Delivered model reply"));
        expect(JSON.stringify(sessions.modelRequests.at(-1)?.messages)).toContain("what about edge case X?");
      }
    } finally { bot.stop(); await running; }
  });

  it.each(["model", "harness"] as const)("delivers %s replies and broadcasts only to the selected scope", async (backend) => {
    const runtime = makeScopeRuntime("scope-b");
    const run = vi.fn<AgentHarness["run"]>(async () => harnessResult);
    const unregister = registerAgentHarness({ ...makeTestHarness("codex"), run });
    const scopeSelection = new TelegramScopeSelection(createKotaClientTestDouble({ scopes: {
      list: async () => ({ ok: true, defaultScopeId: "scope-a", activeScopeId: null, scopes: [makeScopeRuntime().scope, runtime.scope] }),
    } }), new ModuleStorage(runtime.scope.scopeRoot, "telegram"), [{ chatId: 77, scopeId: "scope-b" }]);
    const bot = new TelegramBot(botOptions({
      scopeSelection,
      config: backend === "harness" ? { defaultPreset: "codex" } : {
        defaultAgentHarness: "codex", model: "openai/controlled",
      },
    }));
    let delivered = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/getMe")) return Response.json({ ok: true, result: { id: 1, first_name: "Bot" } });
      if (url.endsWith("/getUpdates")) {
        if (!delivered) {
          delivered = true;
          return Response.json({ ok: true, result: [{ update_id: 1, message: {
            message_id: 1, chat: { id: 77, type: "private" }, text: "ping", date: 0,
          } }] });
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ ok: true, result: [] });
      }
      return Response.json({ ok: true, result: true });
    });
    const running = bot.start();
    try {
      await vi.waitFor(() => expect(sentTexts()).toContain(backend === "harness" ? "harness response" : "Delivered model reply"));
      expect(bot.listScopeSessionIds("scope-b")).toHaveLength(1);
      expect(bot.listScopeSessionIds("scope-a")).toEqual([]);
      bot.broadcastToChats("scope-b ping", "scope-b");
      bot.broadcastToChats("scope-a ping", "scope-a");
      await vi.waitFor(() => expect(sentTexts()).toContain("scope-b ping"));
      expect(sentTexts()).not.toContain("scope-a ping");
      if (backend === "model") {
        expect(JSON.stringify(sessions.modelRequests.at(-1)?.messages)).toContain("ping");
        expect(run).not.toHaveBeenCalled();
      } else {
        expect(run).toHaveBeenCalledWith(expect.objectContaining({ prompt: "ping", cwd: runtime.scope.scopeRoot }), expect.anything());
        expect(sessions.modelRequests).toEqual([]);
      }
    } finally { bot.stop(); await running; unregister(); }
    expect(bot.sessionCount).toBe(0);
  });

  function sentTexts(): string[] {
    return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/sendMessage"))
      .map(([, init]) => JSON.parse(init.body).text);
  }

  it("emits configured automation messages as inbound signals and skips the session loop", async () => {
    const events = { emit: vi.fn() };
    const bot = new TelegramBot(
      botOptions({
        allowedChatIds: [9],
        inboundSignals: {
          config: { prefixes: ["!task"] },
          events,
        },
      }),
    );
    let delivered = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/getMe")) {
        return {
          json: () => Promise.resolve({ ok: true, result: { id: 1, first_name: "Bot" } }),
        };
      }
      if (url.endsWith("/getUpdates")) {
        if (!delivered) {
          delivered = true;
          return {
            json: () =>
              Promise.resolve({
                ok: true,
                result: [
                  {
                    update_id: 1,
                    message: {
                      message_id: 12,
                      from: { id: 7, first_name: "Op", username: "op" },
                      chat: { id: 9, type: "private", first_name: "Op" },
                      text: "!task capture telegram-origin regression",
                      date: 1770000000,
                    },
                  },
                ],
              }),
          };
        }
        return {
          json: () =>
            new Promise((resolve) =>
              setTimeout(() => {
                bot.stop();
                resolve({ ok: true, result: [] });
              }, 100),
            ),
        };
      }
      return { json: () => Promise.resolve({ ok: true, result: true }) };
    });

    const startPromise = bot.start();

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && events.emit.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 20));
    }

    await startPromise;

    expect(events.emit).toHaveBeenCalledWith(
      inboundSignalReceived,
      expect.objectContaining({
        scopeId: "scope-a",
        provider: "telegram",
        channel: "telegram.message",
        actor: expect.objectContaining({
          trust: "trusted",
          trustReason:
            "Telegram chat id is allowed by modules.telegram.allowedChatIds",
        }),
        body: expect.objectContaining({
          kind: "message",
          text: "capture telegram-origin regression",
        }),
      }),
    );
    const getUpdatesCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/getUpdates")
    );
    const getUpdatesRequest = getUpdatesCall?.[1] as {
      body: string;
      limits: { timeoutMs: number };
    };
    expect(JSON.parse(getUpdatesRequest.body)).toMatchObject({
      allowed_updates: [...TELEGRAM_SIGNAL_ALLOWED_UPDATES],
      timeout: POLL_TIMEOUT_S,
    });
    expect(getUpdatesRequest.limits.timeoutMs).toBe(POLL_REQUEST_TIMEOUT_MS);
    expect(getUpdatesRequest.limits.timeoutMs).toBeGreaterThan(POLL_TIMEOUT_S * 1000);
    expect(sessions.modelRequests).toEqual([]);
  });

  it("dispatches callbacks only when their message belongs to an allowed chat", async () => {
    const onCallbackQuery = vi.fn(async () => true);
    const bot = new TelegramBot(botOptions({
      allowedChatIds: [9],
      onCallbackQuery,
    }));
    let delivered = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/getMe")) {
        return {
          json: () => Promise.resolve({ ok: true, result: { id: 1, first_name: "Bot" } }),
        };
      }
      if (url.endsWith("/getUpdates")) {
        if (!delivered) {
          delivered = true;
          return {
            json: () => Promise.resolve({
              ok: true,
              result: [
                {
                  update_id: 1,
                  callback_query: {
                    id: "unauthorized-chat",
                    from: { id: 7, first_name: "Other" },
                    message: {
                      message_id: 10,
                      chat: { id: 10, type: "private" },
                      date: 0,
                    },
                    data: "approve:callback-receipt",
                  },
                },
                {
                  update_id: 2,
                  callback_query: {
                    id: "missing-message",
                    from: { id: 7, first_name: "Other" },
                    data: "approve:callback-receipt",
                  },
                },
                {
                  update_id: 3,
                  callback_query: {
                    id: "authorized-chat",
                    from: { id: 7, first_name: "Operator" },
                    message: {
                      message_id: 11,
                      chat: { id: 9, type: "private" },
                      date: 0,
                    },
                    data: "approve:callback-receipt",
                  },
                },
              ],
            }),
          };
        }
        return new Promise((resolve) => {
          init?.signal?.addEventListener("abort", () => {
            resolve({ json: () => Promise.resolve({ ok: true, result: [] }) });
          });
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const startPromise = bot.start();
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline && onCallbackQuery.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await bot.stop();
    await startPromise;

    expect(onCallbackQuery).toHaveBeenCalledTimes(1);
    expect(onCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ id: "authorized-chat" }),
    );
  });

  it("emits blocked and archived text/caption updates outside allowed chats through the polling path", async () => {
    const routed: InboundSignalRoutedPayload[] = [];
    const routePromises: Promise<InboundSignalRoutedPayload>[] = [];
    const triggerWorkflow = vi.fn(async () => ({
      ok: true as const,
      path: "daemon" as const,
      queued: "telegram-signal-probe",
      runId: "run-telegram-signal-probe",
    }));
    const events = {
      emit: vi.fn((event: unknown, payload: InboundSignalReceivedPayload) => {
        if (event !== inboundSignalReceived) return;
        routePromises.push(
          dispatchInboundSignalRoute({
            config: {
              routes: [
                {
                  id: "telegram-blocked-group",
                  provider: "telegram",
                  channel: "telegram.message",
                  actorTrust: "blocked",
                  sourceStatus: "blocked",
                  targets: [{ kind: "workflow", name: "telegram-signal-probe" }],
                },
                {
                  id: "telegram-archived-group",
                  provider: "telegram",
                  channel: "telegram.media_caption",
                  sourceId: "telegram:chat:100",
                  sourceStatus: "archived",
                  targets: [{ kind: "workflow", name: "telegram-signal-probe" }],
                },
              ],
            },
            signal: payload,
            context: {
              workflowNames: new Set(["telegram-signal-probe"]),
              agentNames: new Set(),
            },
            deps: {
              triggerWorkflow,
              emitRouted(payload) {
                routed.push(payload);
              },
            },
          }),
        );
      }),
    };
    const bot = new TelegramBot(
      botOptions({
        allowedChatIds: [9],
        inboundSignals: {
          config: {
            prefixes: ["!task"],
            blockedChatIds: [99],
            trustedChatIds: [100],
          },
          events,
        },
      }),
    );
    let delivered = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/getMe")) {
        return {
          json: () => Promise.resolve({ ok: true, result: { id: 1, first_name: "Bot" } }),
        };
      }
      if (url.endsWith("/getUpdates")) {
        if (!delivered) {
          delivered = true;
          return {
            json: () =>
              Promise.resolve({
                ok: true,
                result: [
                  {
                    update_id: 20,
                    message: {
                      message_id: 30,
                      from: { id: 7, first_name: "Blocked", username: "blocked" },
                      chat: { id: 99, type: "group", title: "Blocked group" },
                      text: "!task blocked source audit",
                      date: 1770000100,
                    },
                  },
                  {
                    update_id: 21,
                    message: {
                      message_id: 31,
                      from: { id: 8, first_name: "Archived", username: "archived" },
                      chat: { id: 100, type: "group", title: "Archived group" },
                      caption: "!task archived caption audit",
                      photo: [
                        {
                          file_id: "redacted-photo-file-id",
                          file_unique_id: "redacted-photo-unique-id",
                          width: 640,
                          height: 480,
                        },
                      ],
                      date: 1770000110,
                    },
                  },
                ],
              }),
          };
        }
        return {
          json: () =>
            new Promise((resolve) =>
              setTimeout(() => {
                bot.stop();
                resolve({ ok: true, result: [] });
              }, 100),
            ),
        };
      }
      return { json: () => Promise.resolve({ ok: true, result: true }) };
    });

    const startPromise = bot.start();

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && events.emit.mock.calls.length < 2) {
      await new Promise((r) => setTimeout(r, 20));
    }

    await startPromise;
    await Promise.all(routePromises);

    const emittedPayloads = events.emit.mock.calls.map(
      (call) => call[1] as InboundSignalReceivedPayload,
    );
    expect(emittedPayloads).toHaveLength(2);
    expect(emittedPayloads[0]).toMatchObject({
      channel: "telegram.message",
      sourceId: "telegram:chat:99",
      actor: { trust: "blocked" },
      body: { kind: "message", text: "blocked source audit" },
    });
    expect(emittedPayloads[1]).toMatchObject({
      channel: "telegram.media_caption",
      sourceId: "telegram:chat:100",
      actor: { trust: "trusted" },
      body: { kind: "message", text: "archived caption audit" },
    });
    expect(routed.map((entry) => entry.decision)).toEqual(["blocked", "archived"]);
    expect(routed.map((entry) => entry.sourceStatus)).toEqual(["blocked", "archived"]);
    expect(triggerWorkflow).not.toHaveBeenCalled();
    expect(sessions.modelRequests).toEqual([]);
  });

  it("emits non-text Telegram updates as inbound signals without entering chat sessions", async () => {
    const events = { emit: vi.fn() };
    const bot = new TelegramBot(
      botOptions({
        allowedChatIds: [9],
        inboundSignals: {
          config: { prefixes: ["!task"], trustedChatIds: [9] },
          events,
        },
      }),
    );
    let delivered = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/getMe")) {
        return {
          json: () => Promise.resolve({ ok: true, result: { id: 1, first_name: "Bot" } }),
        };
      }
      if (url.endsWith("/getUpdates")) {
        if (!delivered) {
          delivered = true;
          return {
            json: () =>
              Promise.resolve({
                ok: true,
                result: [
                  {
                    update_id: 10,
                    edited_message: {
                      message_id: 20,
                      from: { id: 7, first_name: "Op", username: "op" },
                      chat: { id: 9, type: "private", first_name: "Op" },
                      text: "!task edited event",
                      date: 1770000000,
                      edit_date: 1770000060,
                    },
                  },
                  {
                    update_id: 11,
                    message_reaction: {
                      chat: { id: 9, type: "private", first_name: "Op" },
                      message_id: 20,
                      user: { id: 8, first_name: "Peer", username: "peer" },
                      date: 1770000070,
                      old_reaction: [],
                      new_reaction: [{ type: "emoji", emoji: "👍" }],
                    },
                  },
                  {
                    update_id: 12,
                    chat_member: {
                      chat: { id: 9, type: "private", first_name: "Op" },
                      from: { id: 7, first_name: "Op", username: "op" },
                      date: 1770000080,
                      old_chat_member: {
                        user: { id: 8, first_name: "Peer", username: "peer" },
                        status: "left",
                      },
                      new_chat_member: {
                        user: { id: 8, first_name: "Peer", username: "peer" },
                        status: "member",
                      },
                    },
                  },
                  {
                    update_id: 13,
                    callback_query: {
                      id: "callback-13",
                      from: { id: 7, first_name: "Op", username: "op" },
                      message: {
                        message_id: 21,
                        from: { id: 1, first_name: "Bot" },
                        chat: { id: 9, type: "private", first_name: "Op" },
                        text: "Choose a court",
                        date: 1770000090,
                      },
                      data: "court:4",
                    },
                  },
                ],
              }),
          };
        }
        return {
          json: () =>
            new Promise((resolve) =>
              setTimeout(() => {
                bot.stop();
                resolve({ ok: true, result: [] });
              }, 100),
            ),
        };
      }
      return { json: () => Promise.resolve({ ok: true, result: true }) };
    });

    const startPromise = bot.start();

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && events.emit.mock.calls.length < 4) {
      await new Promise((r) => setTimeout(r, 20));
    }

    await startPromise;

    expect(events.emit).toHaveBeenCalledTimes(4);
    expect(events.emit.mock.calls.map((call) => call[1].channel)).toEqual([
      "telegram.edited_message",
      "telegram.message_reaction",
      "telegram.chat_member",
      "telegram.callback",
    ]);
    expect(sessions.modelRequests).toEqual([]);
  });
});

// --- Voice message handling ---

describe("TelegramBot voice messages", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetchMock();
    resetTelegramPollingOwnersForTests();
    resetProviderRegistry();
  });

  afterEach(() => {
    resetTelegramPollingOwnersForTests();
    resetProviderRegistry();
  });

  function collectSendMessageBodies(): { chat_id: number; text: string }[] {
    return fetchMock.mock.calls
      .filter((c: unknown[]) => typeof c[0] === "string" && (c[0] as string).endsWith("/sendMessage"))
      .map((c: unknown[]) => {
        const init = c[1] as { body: string };
        return JSON.parse(init.body) as { chat_id: number; text: string };
      });
  }

  async function waitForSendMessage(
    predicate: (body: { chat_id: number; text: string }) => boolean,
    timeoutMs = 1000,
  ): Promise<{ chat_id: number; text: string }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const hit = collectSendMessageBodies().find(predicate);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("Timed out waiting for matching sendMessage call");
  }

  function startBotAndQueueUpdate(
    bot: TelegramBot,
    update: unknown,
  ): Promise<void> {
    let deliveredOnce = false;
    let stopping = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/getMe")) {
        return {
          json: () => Promise.resolve({ ok: true, result: { id: 1, first_name: "Bot" } }),
        };
      }
      if (url.endsWith("/getUpdates")) {
        if (deliveredOnce) {
          if (!stopping) {
            stopping = true;
            // Give the async voice handler a moment to flush a sendMessage
            setTimeout(() => bot.stop(), 200);
          }
          return {
            json: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, result: [] }), 10)),
          };
        }
        deliveredOnce = true;
        return { json: () => Promise.resolve({ ok: true, result: [update] }) };
      }
      if (url.includes("/getFile")) {
        return {
          json: () =>
            Promise.resolve({ ok: true, result: { file_id: "v1", file_unique_id: "u1", file_path: "voice/v1.ogg" } }),
        };
      }
      if (url.includes("/file/bot")) {
        return {
          ok: true,
          arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer),
          headers: { get: () => "audio/ogg" },
        };
      }
      return { json: () => Promise.resolve({ ok: true, result: true }) };
    });
    return bot.start();
  }

  it("transcribes voice messages and feeds the transcript into the chat", async () => {
    const registry = initProviderRegistry();
    const provider: TranscriptionProvider = {
      name: "stub",
      async transcribe(input) {
        expect(input.audio.length).toBe(4);
        expect(input.mimeType).toBe("audio/ogg");
        return { text: "hello from voice" };
      },
    };
    registry.register(TRANSCRIPTION_PROVIDER_TYPE, provider.name, provider);

    const bot = new TelegramBot(botOptions());

    const startPromise = startBotAndQueueUpdate(bot, {
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 42, type: "private", first_name: "Alice" },
        date: 0,
        voice: { file_id: "v1", duration: 2, mime_type: "audio/ogg" },
      },
    });

    const transcribedEcho = await waitForSendMessage((m) => m.text.includes("Transcribed"));
    expect(transcribedEcho.text).toContain("hello from voice");
    await waitForSendMessage((m) => m.text === "Delivered model reply");
    expect(JSON.stringify(sessions.modelRequests.at(-1)?.messages)).toContain("hello from voice");

    await startPromise;
  });

  it("replies with a clear failure when no transcription provider is registered", async () => {
    const bot = new TelegramBot(botOptions());

    const startPromise = startBotAndQueueUpdate(bot, {
      update_id: 2,
      message: {
        message_id: 11,
        chat: { id: 42, type: "private", first_name: "Alice" },
        date: 0,
        voice: { file_id: "v2", duration: 2, mime_type: "audio/ogg" },
      },
    });

    const failureNotice = await waitForSendMessage((m) => m.text.toLowerCase().includes("transcription"));
    expect(failureNotice.text).toContain("isn't configured");

    await startPromise;
  });

  it("emits blocked voice transcripts outside allowed chats through the polling path", async () => {
    const registry = initProviderRegistry();
    const provider: TranscriptionProvider = {
      name: "stub",
      async transcribe() {
        return { text: "!task blocked voice audit" };
      },
    };
    registry.register(TRANSCRIPTION_PROVIDER_TYPE, provider.name, provider);

    const events = { emit: vi.fn() };
    const bot = new TelegramBot(
      botOptions({
        allowedChatIds: [9],
        inboundSignals: {
          config: { prefixes: ["!task"], blockedChatIds: [42] },
          events,
        },
      }),
    );

    const startPromise = startBotAndQueueUpdate(bot, {
      update_id: 3,
      message: {
        message_id: 12,
        chat: { id: 42, type: "private", first_name: "Alice" },
        date: 0,
        voice: { file_id: "v3", duration: 2, mime_type: "audio/ogg" },
      },
    });

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && events.emit.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 20));
    }

    await startPromise;

    expect(events.emit).toHaveBeenCalledWith(
      inboundSignalReceived,
      expect.objectContaining({
        channel: "telegram.voice_transcript",
        sourceId: "telegram:chat:42",
        actor: expect.objectContaining({ trust: "blocked" }),
        body: expect.objectContaining({
          kind: "message",
          text: "blocked voice audit",
        }),
      }),
    );
    expect(collectSendMessageBodies()).toEqual([]);
    expect(sessions.modelRequests).toEqual([]);
  });
});
