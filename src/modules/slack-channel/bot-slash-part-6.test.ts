import { describe, expect, it, vi } from "vitest";
import { renderHistorySearchPlain } from "#modules/history/render.js";
import { renderRepoTaskSearchPlain } from "#modules/repo-tasks/render.js";
import { MockWebSocket, makeBot, sendSlashAndAwait, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("slash commands", () => {
    it("/knowledge with empty body replies with usage hint and skips the call", async () => {
      const searchFn = vi.fn();
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

      const post = await sendSlashAndAwait("D-KN2", "/knowledge", ws, "env-k2");
      expect(post.text).toBe("Usage: /knowledge <query>");
      expect(searchFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/history <query> calls history.search and renders the conversations", async () => {
      const conversations = [
        {
          id: "h-1",
          title: "Slack ramp",
          createdAt: "2026-04-20T00:00:00Z",
          updatedAt: "2026-04-21T00:00:00Z",
          model: "opus",
          messageCount: 4,
          cwd: "/repo",
        },
      ];
      const searchFn = vi.fn().mockResolvedValue({ ok: true, conversations });
      const bot = makeBot({
        history: {
          list: vi.fn(),
          listDiscoveredScopeRecords: vi.fn(),
          show: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-HI", "/history slack", ws, "env-h1");
      expect(searchFn).toHaveBeenCalledWith("slack", {
        semantic: true,
        limit: 10,
      });
      expect(post.text).toBe(renderHistorySearchPlain(conversations));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/history with empty body replies with usage hint and skips the call", async () => {
      const searchFn = vi.fn();
      const bot = makeBot({
        history: {
          list: vi.fn(),
          listDiscoveredScopeRecords: vi.fn(),
          show: vi.fn(),
          delete: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-HI2", "/history", ws, "env-h2");
      expect(post.text).toBe("Usage: /history <query>");
      expect(searchFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/tasks <query> calls tasks.search and renders the hits", async () => {
      const hits = [
        {
          id: "task-foo",
          title: "do foo",
          state: "open" as const,
          priority: "p2",
          score: 0.5,
        },
      ];
      const searchFn = vi.fn().mockResolvedValue({ ok: true, tasks: hits });
      const bot = makeBot({
        tasks: {
          list: vi.fn(),
          show: vi.fn(),
          move: vi.fn(),
          create: vi.fn(),
          capture: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-TA", "/tasks foo", ws, "env-t1");
      expect(searchFn).toHaveBeenCalledWith("foo", {
        semantic: true,
        limit: 10,
      });
      expect(post.text).toBe(renderRepoTaskSearchPlain(hits));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/tasks with empty body replies with usage hint and skips the call", async () => {
      const searchFn = vi.fn();
      const bot = makeBot({
        tasks: {
          list: vi.fn(),
          show: vi.fn(),
          move: vi.fn(),
          create: vi.fn(),
          capture: vi.fn(),
          search: searchFn,
          reindex: vi.fn(),
        },
      });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-TA2", "/tasks", ws, "env-t2");
      expect(post.text).toBe("Usage: /tasks <query>");
      expect(searchFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

  });
});
