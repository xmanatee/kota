import { describe, expect, it, vi } from "vitest";
import { MockWebSocket, makeBot, sendSlashAndAwait, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("slash commands", () => {
    it("/recall <query> calls recall.recall and renders the hits", async () => {
      const recallFn = vi.fn().mockResolvedValue({
        ok: true,
        hits: [
          {
            source: "knowledge",
            id: "k1",
            title: "Slack adoption notes",
            score: 0.42,
          },
        ],
      });
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RECALL",
        "/recall slack",
        ws,
        "env-r1",
      );

      expect(recallFn).toHaveBeenCalledWith("slack");
      expect(post.text).toContain("knowledge");
      expect(post.text).toContain("k1");
      expect(post.text).toContain("Slack adoption notes");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/recall surfaces semantic_unavailable as the unconfigured notice", async () => {
      const recallFn = vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RECALL2",
        "/recall anything",
        ws,
        "env-r2",
      );

      expect(post.text).toBe(
        "Cross-store recall is not configured: no contributors are registered.",
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/recall with an empty query replies with a usage hint and skips the call", async () => {
      const recallFn = vi.fn();
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-RECALL3", "/recall", ws, "env-r3");

      expect(post.text).toBe("Usage: /recall <query>");
      expect(recallFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer <query> calls answer.answer and renders the synthesized prose plus citations", async () => {
      const answerFn = vi.fn().mockResolvedValue({
        ok: true,
        answer: "KOTA is a personal knowledge agent. [knowledge:k1]",
        citations: [{ source: "knowledge", id: "k1" }],
        hits: [
          {
            source: "knowledge",
            id: "k1",
            title: "KOTA overview",
            score: 0.91,
          },
        ],
      });
      const bot = makeBot({
        answer: { answer: answerFn, log: vi.fn(), show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-ANSWER",
        "/answer what is kota",
        ws,
        "env-a1",
      );

      expect(answerFn).toHaveBeenCalledWith("what is kota");
      expect(post.text).toContain("KOTA is a personal knowledge agent.");
      expect(post.text).toContain("Citations");
      expect(post.text).toContain("k1");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer surfaces no_hits and synthesis_failed reasons one-to-one", async () => {
      const answerFn = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: "no_hits" })
        .mockResolvedValueOnce({ ok: false, reason: "synthesis_failed" });
      const bot = makeBot({
        answer: { answer: answerFn, log: vi.fn(), show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post1 = await sendSlashAndAwait(
        "D-AN1",
        "/answer foo",
        ws,
        "env-a2",
      );
      expect(post1.text).toBe(
        "No matching knowledge, memory, or history sources — nothing to synthesize.",
      );

      const post2 = await sendSlashAndAwait(
        "D-AN2",
        "/answer bar",
        ws,
        "env-a3",
      );
      expect(post2.text).toBe(
        "Synthesis failed (model unreachable or unable to cite resolvable sources).",
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/answer with empty query replies with a usage hint and skips the call", async () => {
      const answerFn = vi.fn();
      const bot = makeBot({
        answer: { answer: answerFn, log: vi.fn(), show: vi.fn() },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-AN3", "/answer    ", ws, "env-a4");
      expect(post.text).toBe("Usage: /answer <query>");
      expect(answerFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

  });
});
