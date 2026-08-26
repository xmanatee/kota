/**
 * Load-bearing regression for the owner-decision blocked-task unblock cycle.
 *
 * Drives the real `blocked-promoter` workflow, the real `askOwnerSteps`
 * recipe, the real `OwnerQuestionQueue`, the real `installAwaitResumers`
 * resume path, and the real `tryHandleOwnerQuestionReply` chat-reply path
 * end-to-end through a real `Daemon` stop/start cycle. A regression in any
 * of those four named seams fails this single test with a message naming
 * the broken seam.
 *
 * The test seeds a synthetic `kind: owner-decision` blocked task in a
 * scratch project, lets blocked-promoter ask the operator, asserts the
 * question lands in the queue and the workflow run is suspended, simulates
 * a daemon restart, delivers a free-form chat reply through the same
 * `owner-question-reply` path Telegram uses, and asserts the next
 * blocked-promoter cycle writes a `<!-- blocked-promoter-resolved -->`
 * marker and promotes the task to `ready/`.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetScheduler } from "#core/daemon/index.js";
import {
  getOwnerQuestionQueue,
  resetOwnerQuestionQueue,
} from "#core/daemon/owner-question-queue.js";
import { getEventBus, resetEventBus } from "#core/events/event-bus.js";
import {
  makeDaemon,
  setupScopeRoot,
  tryHandleOwnerQuestionReply,
  waitFor,
} from "./owner-decision-cycle-test-support.js";

describe("owner-decision blocked-task unblock cycle", () => {
  let workspaceRoot: string;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    resetEventBus();
    resetScheduler();
    resetOwnerQuestionQueue();
    originalExitCode = process.exitCode;
    workspaceRoot = setupScopeRoot();
    // Pin the OwnerQuestionQueue singleton to the scratch project before any
    // production code reads it. Both the workflow's askOwnerSteps recipe and
    // the Telegram chat-reply path resolve through this same singleton.
    getOwnerQuestionQueue(join(workspaceRoot, ".kota", "owner-questions"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    resetOwnerQuestionQueue();
    process.exitCode = originalExitCode;
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it(
    "ask -> daemon-restart -> free-form Telegram reply -> resolved-marker -> auto-promote",
    async () => {
      const runsDir = join(workspaceRoot, ".kota", "runs");
      let questionId: string;

      // ---- Phase 1: ask + suspend, then stop the daemon ---------------------
      const firstDaemon = makeDaemon(workspaceRoot);
      const firstStart = firstDaemon.start();
      try {
        const bus = await waitFor(
          () => {
            const b = getEventBus();
            return b && b.listenerCount("*") > 0 ? b : null;
          },
          5_000,
          "first daemon to register its workflow event listener",
        );

        // Trigger the workflow. blocked-promoter's askOwnerSteps recipe
        // enqueues the question and the wait step suspends on
        // owner.question.resolved.
        bus.emit("autonomy.queue.available", {
          pullableCount: 0,
          actionableCount: 0,
        });

        // (a) Question lands in the queue with the precondition's text.
        const question = await waitFor(
          () => getOwnerQuestionQueue().list("pending")[0] ?? null,
          15_000,
          "askOwnerSteps to enqueue an owner question " +
            "(seam: askOwnerSteps + blocked-promoter ask gate)",
        );
        expect(
          question.source,
          "askOwnerSteps must record the workflow's source label",
        ).toBe("blocked-promoter");
        expect(
          question.question,
          "the queued question must carry the precondition's question text",
        ).toBe("Which variant should we pick?");
        expect(
          question.context,
          "the queued context must carry the precondition's slot identifier",
        ).toContain("Blocked task: task-pick-variant (slot pick-variant).");
        expect(question.proposedAnswers).toContain("unblock");
        questionId = question.id;

        // (b) Workflow run is suspended on owner.question.resolved.
        const suspendedRunId = await waitFor(
          () => {
            if (!existsSync(runsDir)) return null;
            for (const dir of readdirSync(runsDir)) {
              if (existsSync(
                join(
                  runsDir,
                  dir,
                  "awaits",
                  "blocked-promoter-owner-decision-wait.json",
                ),
              )) {
                return dir;
              }
            }
            return null;
          },
          10_000,
          "await-event step to persist a suspension file " +
            "(seam: askOwnerSteps wait step persistence)",
        );
        const suspensionPath = join(
          runsDir,
          suspendedRunId,
          "awaits",
          "blocked-promoter-owner-decision-wait.json",
        );
        const suspension = JSON.parse(readFileSync(suspensionPath, "utf-8"));
        expect(
          suspension.event,
          "suspension must reference the owner.question.resolved bus event",
        ).toBe("owner.question.resolved");
        expect(suspension.matchField).toBe("id");
        expect(
          suspension.matchValue,
          "suspension must match by the asked question's id",
        ).toBe(questionId);
      } finally {
        // Short grace: the wait step's promise rejects on the abort signal,
        // which lets the run settle and the daemon exit cleanly. The default
        // 60s grace would blow the test budget.
        await firstDaemon.stop(100);
        await firstStart;
      }

      // (c) Suspension survives the stop. ----
      const persistedSuspensionRunId = readdirSync(runsDir).find((dir) =>
        existsSync(
          join(
            runsDir,
            dir,
            "awaits",
            "blocked-promoter-owner-decision-wait.json",
          ),
        ),
      );
      expect(
        persistedSuspensionRunId,
        "suspension file must persist across daemon stop " +
          "(seam: installAwaitResumers crash-window contract)",
      ).toBeTruthy();
      // The OwnerQuestionQueue file persists too — independent of the bus.
      expect(getOwnerQuestionQueue().get(questionId!)?.status).toBe("pending");

      // ---- Phase 2: restart daemon, deliver free-form chat reply ------------
      const secondDaemon = makeDaemon(workspaceRoot);
      const secondStart = secondDaemon.start();
      try {
        await waitFor(
          () => {
            const b = getEventBus();
            return b && b.listenerCount("*") > 0 ? b : null;
          },
          5_000,
          "second daemon to register its workflow event listener " +
            "(seam: installAwaitResumers must run on workflow runtime start)",
        );

        // (d) Free-form Telegram chat reply enters via the real
        //     `tryHandleOwnerQuestionReply` path. The `pending` map mirrors
        //     the chat-binding store the bot maintains for outstanding
        //     owner-question messages.
        const chatId = 99;
        const messageId = 7;
        const pending = new Map<string, { chatId: string; messageId: number; scopeId: string }>(
          [[questionId!, { chatId: String(chatId), messageId, scopeId: "test-scope" }]],
        );

        const stubLog = {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        };

        const handled = await tryHandleOwnerQuestionReply({
          token: "tok",
          chatId,
          replyToMessageId: messageId,
          text: "unblock",
          pending,
          allowedChatIds: [chatId],
          log: stubLog,
        });
        expect(
          handled,
          "owner-question-reply must consume a tracked free-form reply " +
            "(seam: telegram/owner-question-reply free-form chat-reply path)",
        ).toBe(true);

        const resolved = getOwnerQuestionQueue().get(questionId!);
        expect(resolved?.status).toBe("answered");
        expect(resolved?.resolutionSource).toBe("telegram-reply");
        expect(resolved?.answer).toBe("unblock");

        // The message edit went through the real client wrapper, just stubbed
        // at the HTTP boundary.
        const { callTelegramApi } = await import("#modules/telegram/client.js");
        expect(vi.mocked(callTelegramApi)).toHaveBeenCalledWith(
          "tok",
          "editMessageText",
          expect.objectContaining({
            chat_id: String(chatId),
            message_id: messageId,
            text: expect.stringContaining("✅ Answered"),
          }),
        );

        // (e) The resume run promotes the now-resolved task to ready/ and
        //     leaves the resolved marker in the body. p1 priority sends it
        //     straight to ready/ (per promotionTargetState).
        const promotedPath = join(
          workspaceRoot,
          "data",
          "tasks",
          "ready",
          "task-pick-variant.md",
        );
        const blockedPath = join(
          workspaceRoot,
          "data",
          "tasks",
          "blocked",
          "task-pick-variant.md",
        );
        await waitFor(
          () => existsSync(promotedPath) && !existsSync(blockedPath),
          20_000,
          "blocked task to promote to ready/ after the resume run completes " +
            "(seam: installAwaitResumers resume + blocked-promoter follow-up promotion)",
        );

        const promotedBody = readFileSync(promotedPath, "utf-8");
        expect(
          promotedBody,
          "the task body must carry the blocked-promoter-resolved marker",
        ).toContain("blocked-promoter-resolved: slot=pick-variant");
        expect(
          existsSync(blockedPath),
          "the task must have moved out of blocked/",
        ).toBe(false);
      } finally {
        // Task-state commits are live data, so the resumed daemon remains
        // running until the test stops it explicitly.
        await secondDaemon.stop(100);
        await secondStart;
      }
    },
    50_000,
  );
});
