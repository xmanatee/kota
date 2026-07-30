import { describe, expect, it, vi } from "vitest";
import { renderKnowledgeSearchPlain } from "#modules/knowledge/render.js";
import { renderMemorySearchPlain } from "#modules/memory/render.js";
import { MockWebSocket, makeBot, sendSlashAndAwait, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("slash commands", () => {
    it("/memory <query> calls memory.search and renders the entries", async () => {
      const entries = [
        { id: "mem-1", created: "2026-04-28T06:00:00Z", content: "alice phone" },
      ];
      const searchFn = vi.fn().mockResolvedValue({ ok: true, entries });
      const bot = makeBot({
        memory: {
          list: vi.fn(),
          add: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-MEM",
        "/memory alice",
        ws,
        "env-m1",
      );

      expect(searchFn).toHaveBeenCalledWith("alice", {
        semantic: true,
        limit: 10,
      });
      expect(post.text).toBe(renderMemorySearchPlain(entries));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/memory surfaces semantic_unavailable as the unconfigured notice", async () => {
      const searchFn = vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
      const bot = makeBot({
        memory: {
          list: vi.fn(),
          add: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-MEM2",
        "/memory anything",
        ws,
        "env-m2",
      );
      expect(post.text).toBe(
        "Semantic memory search requires an embedding-backed memory provider.",
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/memory with empty body replies with usage hint and skips the call", async () => {
      const searchFn = vi.fn();
      const bot = makeBot({
        memory: {
          list: vi.fn(),
          add: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-MEM3", "/memory", ws, "env-m3");
      expect(post.text).toBe("Usage: /memory <query>");
      expect(searchFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/memory replies 'No matching memory entries.' when the search returns nothing", async () => {
      const searchFn = vi.fn().mockResolvedValue({ ok: true, entries: [] });
      const bot = makeBot({
        memory: {
          list: vi.fn(),
          add: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-MEM4", "/memory none", ws, "env-m4");
      expect(post.text).toBe("No matching memory entries.");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/knowledge <query> calls knowledge.search and renders the entries", async () => {
      const entries = [
        {
          id: "k-1",
          title: "KOTA overview",
          type: "note",
          tags: [],
          status: "active",
          created: "2026-04-01T00:00:00Z",
          updated: "2026-04-01T00:00:00Z",
          content: "",
          meta: {},
        },
      ];
      const searchFn = vi.fn().mockResolvedValue({ ok: true, entries });
      const bot = makeBot({
        knowledge: {
          list: vi.fn(),
          show: vi.fn(),
          search: searchFn,
          add: vi.fn(),
          delete: vi.fn(),
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-KN",
        "/knowledge kota",
        ws,
        "env-k1",
      );
      expect(searchFn).toHaveBeenCalledWith("kota", {
        semantic: true,
        limit: 10,
      });
      expect(post.text).toBe(renderKnowledgeSearchPlain(entries));

      bot.stop();
      await startPromise.catch(() => {});
    });

  });
});
