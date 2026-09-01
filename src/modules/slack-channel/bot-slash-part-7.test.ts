import { describe, expect, it, vi } from "vitest";
import type { RetractResult } from "#modules/retract/client.js";
import { renderRetractResultPlain } from "#modules/retract/render.js";
import { MockWebSocket, makeBot, sendSlashAndAwait, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("slash commands", () => {
    it("/attention calls attention.snapshot and posts the rendered text verbatim", async () => {
      const snapshot = vi
        .fn()
        .mockReturnValue({ text: "Attention items:\n- task-foo (ready)" });
      const bot = makeBot({ attention: { snapshot } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-AT", "/attention", ws, "env-at1");
      expect(snapshot).toHaveBeenCalled();
      expect(post.text).toBe("Attention items:\n- task-foo (ready)");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/attention <noise> still triggers the snapshot (body is ignored)", async () => {
      const snapshot = vi
        .fn()
        .mockReturnValue({ text: "All caught up." });
      const bot = makeBot({ attention: { snapshot } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-AT2",
        "/attention now please",
        ws,
        "env-at2",
      );
      expect(snapshot).toHaveBeenCalledTimes(1);
      expect(post.text).toBe("All caught up.");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/digest calls digest.snapshot and posts the rendered text verbatim", async () => {
      const snapshot = vi
        .fn()
        .mockReturnValue({ text: "Daily digest:\nbuilder: 3 runs" });
      const bot = makeBot({ digest: { snapshot } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-DI", "/digest", ws, "env-di1");
      expect(snapshot).toHaveBeenCalled();
      expect(post.text).toBe("Daily digest:\nbuilder: 3 runs");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/retract-memory <id> calls retract.retract and renders the success arm", async () => {
      const result: RetractResult = {
        ok: true,
        target: "memory",
        identifier: "mem-42",
      };
      const retractFn = vi.fn().mockResolvedValue(result);
      const bot = makeBot({ retract: { retract: retractFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RM",
        "/retract-memory mem-42",
        ws,
        "env-rm1",
      );

      expect(retractFn).toHaveBeenCalledWith({
        target: "memory",
        identifier: "mem-42",
      });
      // Byte-identical parity with Telegram's /retract-<store> handler:
      // both render the same envelope through `renderRetractResultPlain`.
      expect(post.text).toBe(renderRetractResultPlain(result));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/retract-knowledge <slug> dispatches with target=knowledge", async () => {
      const result: RetractResult = {
        ok: true,
        target: "knowledge",
        identifier: "kota-overview",
      };
      const retractFn = vi.fn().mockResolvedValue(result);
      const bot = makeBot({ retract: { retract: retractFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RK",
        "/retract-knowledge kota-overview",
        ws,
        "env-rk1",
      );

      expect(retractFn).toHaveBeenCalledWith({
        target: "knowledge",
        identifier: "kota-overview",
      });
      expect(post.text).toBe(renderRetractResultPlain(result));

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/retract-tasks <id> dispatches with target=tasks and renders the path-bearing success arm", async () => {
      const result: RetractResult = {
        ok: true,
        target: "tasks",
        identifier: "task-fix-redirect",
        id: "task-fix-redirect",
        fromState: "open",
        previousPath: "data/tasks/task-fix-redirect.md",
        path: "data/tasks/archive/task-fix-redirect.md",
        toState: "dropped",
      };
      const retractFn = vi.fn().mockResolvedValue(result);
      const bot = makeBot({ retract: { retract: retractFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-RT",
        "/retract-tasks task-fix-redirect",
        ws,
        "env-rt1",
      );

      expect(retractFn).toHaveBeenCalledWith({
        target: "tasks",
        identifier: "task-fix-redirect",
      });
      expect(post.text).toBe(renderRetractResultPlain(result));

      bot.stop();
      await startPromise.catch(() => {});
    });

  });
});
