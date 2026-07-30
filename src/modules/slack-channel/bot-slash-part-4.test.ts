import { describe, expect, it, vi } from "vitest";
import { AgentSession, MockWebSocket, makeBot, sendSlashAndAwait, setupSlackBotTestHooks } from "./bot-test-support.js";

setupSlackBotTestHooks();

describe("SlackBot", () => {
  describe("slash commands", () => {
    it("/capture <text> calls capture.capture without a target and renders the success arm", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: true,
        record: { target: "memory", recordId: "mem-42" },
      });
      const bot = makeBot({ capture: { capture: captureFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-CAP",
        "/capture remember to call alice",
        ws,
        "env-c1",
      );

      expect(captureFn).toHaveBeenCalledWith("remember to call alice", undefined);
      expect(post.text).toBe("Captured to memory: mem-42");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/capture-to-tasks dispatches with target=tasks and renders the path-bearing success arm", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: true,
        record: {
          target: "tasks",
          recordId: "task-fix-redirect",
          path: "data/tasks/ready/task-fix-redirect.md",
        },
      });
      const bot = makeBot({ capture: { capture: captureFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait(
        "D-CAP-T",
        "/capture-to-tasks fix the login redirect",
        ws,
        "env-c2",
      );

      expect(captureFn).toHaveBeenCalledWith("fix the login redirect", {
        target: "tasks",
      });
      expect(post.text).toBe(
        "Captured to tasks: task-fix-redirect (data/tasks/ready/task-fix-redirect.md)",
      );

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/capture surfaces ambiguous, no_contributors, and contributor_failed arms", async () => {
      const captureFn = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reason: "ambiguous",
          suggestions: ["memory", "knowledge", "tasks", "inbox"],
        })
        .mockResolvedValueOnce({ ok: false, reason: "no_contributors" })
        .mockResolvedValueOnce({
          ok: false,
          reason: "contributor_failed",
          target: "inbox",
          message: "permission denied",
        });
      const bot = makeBot({ capture: { capture: captureFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post1 = await sendSlashAndAwait(
        "D-CAPF1",
        "/capture something vague",
        ws,
        "env-c3",
      );
      expect(post1.text).toBe(
        "Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.",
      );

      const post2 = await sendSlashAndAwait(
        "D-CAPF2",
        "/capture another",
        ws,
        "env-c4",
      );
      expect(post2.text).toBe(
        "Cross-store capture has no registered contributors.",
      );

      const post3 = await sendSlashAndAwait(
        "D-CAPF3",
        "/capture-to-inbox raw thought",
        ws,
        "env-c5",
      );
      expect(post3.text).toBe("Capture into inbox failed: permission denied");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("/capture with empty body short-circuits to the ambiguous body and skips the seam", async () => {
      const captureFn = vi.fn();
      const bot = makeBot({ capture: { capture: captureFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      const post = await sendSlashAndAwait("D-CAPE", "/capture   ", ws, "env-c6");
      expect(post.text).toBe(
        "Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.",
      );
      expect(captureFn).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("strips a leading bot-mention prefix and matches the command case-insensitively", async () => {
      const recallFn = vi.fn().mockResolvedValue({ ok: true, hits: [] });
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      await sendSlashAndAwait(
        "D-MEN",
        "<@U987654> /Recall protocols",
        ws,
        "env-mn1",
      );

      expect(recallFn).toHaveBeenCalledWith("protocols");

      bot.stop();
      await startPromise.catch(() => {});
    });

    it("does not create a session for a slash command", async () => {
      const recallFn = vi.fn().mockResolvedValue({ ok: true, hits: [] });
      const bot = makeBot({ recall: { recall: recallFn } });
      const startPromise = bot.start();
      await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      const ws = MockWebSocket.instances[0];

      await sendSlashAndAwait("D-NS1", "/recall x", ws, "env-ns1");

      expect(AgentSession).not.toHaveBeenCalled();

      bot.stop();
      await startPromise.catch(() => {});
    });

  });
});
