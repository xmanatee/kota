import { describe, expect, it, vi } from "vitest";
import { renderAnswerHistoryEntriesPlain, renderAnswerReplyPlain } from "#modules/answer/render.js";
import { MockWebSocket, makeBot, sendSlashAndAwait, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("slash commands", () => {
    it("/answer-log <N> calls answer.log with the parsed limit and renders entries via the shared renderer", async () => {
      const entries = [
        {
          id: "ans-2",
          createdAt: "2026-04-28T05:00:00.123Z",
          query: "what is kota",
          result: { ok: true as const, citationCount: 2 },
        },
        {
          id: "ans-1",
          createdAt: "2026-04-27T22:30:00.000Z",
          query: "older question",
          result: { ok: false as const, reason: "no_hits" as const },
        },
      ];
      const logFn = vi.fn().mockResolvedValue({ entries });
      const bot = makeBot({
        answer: { answer: vi.fn(), log: logFn, show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-ALOG",
        "/answer-log 2",
        ws,
        "env-al1",
      );

      expect(logFn).toHaveBeenCalledWith({ limit: 2 });
      // Byte-identical parity with Telegram's /answer-log handler: both
      // render the same entries through the shared module-owned renderer.
      expect(post.text).toBe(renderAnswerHistoryEntriesPlain(entries));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer-log with no arg uses the default page size matching Telegram", async () => {
      const logFn = vi.fn().mockResolvedValue({ entries: [] });
      const bot = makeBot({
        answer: { answer: vi.fn(), log: logFn, show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      await sendSlashAndAwait("D-ALOG2", "/answer-log", ws, "env-al2");

      expect(logFn).toHaveBeenCalledWith({ limit: 5 });

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer-log with empty store replies with the empty-store message", async () => {
      const logFn = vi.fn().mockResolvedValue({ entries: [] });
      const bot = makeBot({
        answer: { answer: vi.fn(), log: logFn, show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-ALOG3",
        "/answer-log",
        ws,
        "env-al3",
      );
      expect(post.text).toBe("No past answer records yet.");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer-log with a non-positive-integer body replies with the usage hint and skips the call", async () => {
      const logFn = vi.fn();
      const bot = makeBot({
        answer: { answer: vi.fn(), log: logFn, show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-ALOG4",
        "/answer-log abc",
        ws,
        "env-al4",
      );
      expect(post.text).toBe("Usage: /answer-log [N]");
      expect(logFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer-show <id> calls answer.show and renders the record via the shared renderer", async () => {
      const result = {
        ok: true as const,
        answer: "KOTA is a personal knowledge agent. [knowledge:k1]",
        citations: [{ source: "knowledge" as const, id: "k1" }],
        hits: [
          {
            source: "knowledge" as const,
            id: "k1",
            title: "KOTA overview",
            preview: "Personal knowledge agent.",
            updated: "2026-04-01T00:00:00Z",
            score: 0.91,
          },
        ],
      };
      const record = {
        id: "ans-42",
        createdAt: "2026-04-28T05:00:00.000Z",
        query: "what is kota",
        recallHits: result.hits,
        result,
      };
      const showFn = vi.fn().mockResolvedValue({ ok: true, record });
      const bot = makeBot({
        answer: { answer: vi.fn(), log: vi.fn(), show: showFn },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-ASHOW",
        "/answer-show ans-42",
        ws,
        "env-as1",
      );

      expect(showFn).toHaveBeenCalledWith("ans-42");
      // Byte-identical parity with Telegram's /answer-show handler: both
      // re-render the persisted record's typed result through the same
      // shared renderer that backs /answer.
      expect(post.text).toBe(renderAnswerReplyPlain(result));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer-show <unknown> surfaces the not-found reply matching Telegram's wording", async () => {
      const showFn = vi.fn().mockResolvedValue({ ok: false, reason: "not_found" });
      const bot = makeBot({
        answer: { answer: vi.fn(), log: vi.fn(), show: showFn },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-ASHOW2",
        "/answer-show ans-missing",
        ws,
        "env-as2",
      );

      expect(showFn).toHaveBeenCalledWith("ans-missing");
      expect(post.text).toBe('No answer record found for id "ans-missing".');

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer-show with empty body replies with the usage hint and skips the call", async () => {
      const showFn = vi.fn();
      const bot = makeBot({
        answer: { answer: vi.fn(), log: vi.fn(), show: showFn },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-ASHOW3",
        "/answer-show   ",
        ws,
        "env-as3",
      );
      expect(post.text).toBe("Usage: /answer-show <id>");
      expect(showFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

  });
});
