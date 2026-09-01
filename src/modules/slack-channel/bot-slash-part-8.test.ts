import { describe, expect, it, vi } from "vitest";
import type { RetractResult } from "#modules/retract/client.js";
import { renderRetractResultPlain } from "#modules/retract/render.js";
import { MockWebSocket, makeBot, sendSlashAndAwait, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("slash commands", () => {
    it("/retract-inbox <path> dispatches with target=inbox", async () => {
      const result: RetractResult = {
        ok: true,
        target: "inbox",
        identifier: "data/inbox/note-foo.md",
        recordId: "note-foo",
        path: "data/inbox/note-foo.md",
      };
      const retractFn = vi.fn().mockResolvedValue(result);
      const bot = makeBot({ retract: { retract: retractFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RI",
        "/retract-inbox data/inbox/note-foo.md",
        ws,
        "env-ri1",
      );

      expect(retractFn).toHaveBeenCalledWith({
        target: "inbox",
        identifier: "data/inbox/note-foo.md",
      });
      expect(post.text).toBe(renderRetractResultPlain(result));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/retract-<target> with empty body replies with the per-target usage hint and skips the call", async () => {
      const retractFn = vi.fn();
      const bot = makeBot({ retract: { retract: retractFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post1 = await sendSlashAndAwait(
        "D-RU1",
        "/retract-memory",
        ws,
        "env-ru1",
      );
      expect(post1.text).toBe("Usage: /retract-memory <id>");

      const post2 = await sendSlashAndAwait(
        "D-RU2",
        "/retract-knowledge   ",
        ws,
        "env-ru2",
      );
      expect(post2.text).toBe("Usage: /retract-knowledge <slug>");

      const post3 = await sendSlashAndAwait(
        "D-RU3",
        "/retract-tasks",
        ws,
        "env-ru3",
      );
      expect(post3.text).toBe("Usage: /retract-tasks <id>");

      const post4 = await sendSlashAndAwait(
        "D-RU4",
        "/retract-inbox",
        ws,
        "env-ru4",
      );
      expect(post4.text).toBe("Usage: /retract-inbox <path>");

      expect(retractFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/retract-<target> renders not_found verbatim through the shared renderer", async () => {
      const result: RetractResult = {
        ok: false,
        reason: "not_found",
        target: "memory",
        identifier: "mem-missing",
      };
      const retractFn = vi.fn().mockResolvedValue(result);
      const bot = makeBot({ retract: { retract: retractFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RNF",
        "/retract-memory mem-missing",
        ws,
        "env-rnf1",
      );

      expect(retractFn).toHaveBeenCalledWith({
        target: "memory",
        identifier: "mem-missing",
      });
      expect(post.text).toBe(renderRetractResultPlain(result));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/retract-<target> renders store failures without throwing", async () => {
      const retractFailed: RetractResult = {
        ok: false,
        reason: "retract_failed",
        target: "inbox",
        identifier: "data/inbox/locked.md",
        message: "permission denied",
      };
      const retractFn = vi.fn().mockResolvedValue(retractFailed);
      const bot = makeBot({ retract: { retract: retractFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RCF",
        "/retract-inbox data/inbox/locked.md",
        ws,
        "env-rcf1",
      );
      expect(post.text).toBe(renderRetractResultPlain(retractFailed));

      bot.stop();
      await startPromise.catch(() => {});
    });

  });
});
