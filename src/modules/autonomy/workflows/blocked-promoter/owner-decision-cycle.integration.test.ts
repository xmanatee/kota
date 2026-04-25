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

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Daemon, resetScheduler } from "#core/daemon/index.js";
import {
  getOwnerQuestionQueue,
  resetOwnerQuestionQueue,
} from "#core/daemon/owner-question-queue.js";
import { getEventBus, resetEventBus } from "#core/events/event-bus.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { tryHandleOwnerQuestionReply } from "#modules/telegram/owner-question-reply.js";
import blockedPromoterWorkflow from "./workflow.js";

// The cycle's components must be real. The mocks below cover infrastructure
// adjacent to (not inside) the cycle: validation gates, the git commit, the
// task store init, and the Telegram HTTP client. None of these belong to the
// four seams the test pins.

vi.mock("#modules/telegram/client.js", () => ({
  callTelegramApi: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#modules/autonomy/shared.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/autonomy/shared.js")>(
    "#modules/autonomy/shared.js",
  );
  return {
    ...actual,
    runCheck: vi.fn(() => "ok"),
    checkNoScratchArtifacts: vi.fn(() => "ok"),
    checkCommitMessageExists: vi.fn(() => "ok"),
  };
});

vi.mock("#modules/autonomy/commit.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/autonomy/commit.js")>(
    "#modules/autonomy/commit.js",
  );
  return {
    ...actual,
    commitWorkflowChanges: vi.fn(() => ({ committed: true })),
    checkCommitStageable: vi.fn(() => "ok"),
  };
});

vi.mock("#core/daemon/task-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/daemon/task-store.js")>();
  return { ...actual, initTaskStore: vi.fn() };
});

async function waitFor<T>(
  predicate: () => T | null | undefined | false,
  timeoutMs: number,
  description: string,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value as T;
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

function blockedTaskBody(): string {
  const now = "2026-04-25T00:00:00.000Z";
  return [
    "---",
    "id: task-pick-variant",
    "title: Pick variant",
    "status: blocked",
    "priority: p1",
    "area: autonomy",
    "summary: pick variant",
    `created_at: ${now}`,
    `updated_at: ${now}`,
    "---",
    "",
    "## Problem",
    "Pick a variant for the cycle test.",
    "",
    "## Desired Outcome",
    "A variant is chosen.",
    "",
    "## Constraints",
    "None.",
    "",
    "## Done When",
    "- variant is chosen",
    "",
    "## Unblock Precondition",
    "",
    "```",
    "kind: owner-decision",
    "slot: pick-variant",
    "question: Which variant should we pick?",
    "context: Variants A, B, hybrid sketched in body.",
    "proposed_answers: variant-a, variant-b, hybrid, unblock",
    "```",
    "",
    "## Source / Intent",
    "Cycle integration test fixture.",
    "",
    "## Initiative",
    "Owner-in-the-loop reliability.",
    "",
    "## Acceptance Evidence",
    "- this test",
    "",
  ].join("\n");
}

function setupProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "owner-decision-cycle-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  writeFileSync(
    join(dir, "data", "tasks", "blocked", "task-pick-variant.md"),
    blockedTaskBody(),
  );
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

function makeDaemon(projectDir: string): Daemon {
  const stateDir = join(projectDir, ".kota");
  return new Daemon({
    projectDir,
    stateDir,
    idleIntervalMs: 5_000,
    pollIntervalMs: 60_000,
    shutdownGracePeriodMs: 10_000,
    workflows: [
      registerWorkflowDefinition(
        "src/modules/autonomy/workflows/blocked-promoter/workflow.ts",
        {
          ...blockedPromoterWorkflow,
          // blocked-promoter has no agent step, so any absolute moduleRoot
          // satisfies validation; pin it to the scratch project to keep
          // any future prompt resolution inside the test fixture.
          moduleRoot: projectDir,
        },
      ),
    ],
  });
}

describe("owner-decision blocked-task unblock cycle", () => {
  let projectDir: string;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    resetEventBus();
    resetScheduler();
    resetOwnerQuestionQueue();
    originalExitCode = process.exitCode;
    projectDir = setupProjectDir();
    // Pin the OwnerQuestionQueue singleton to the scratch project before any
    // production code reads it. Both the workflow's askOwnerSteps recipe and
    // the Telegram chat-reply path resolve through this same singleton.
    getOwnerQuestionQueue(join(projectDir, ".kota", "owner-questions"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    resetOwnerQuestionQueue();
    process.exitCode = originalExitCode;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    "ask -> daemon-restart -> free-form Telegram reply -> resolved-marker -> auto-promote",
    async () => {
      const runsDir = join(projectDir, ".kota", "runs");
      let questionId: string;

      // ---- Phase 1: ask + suspend, then stop the daemon ---------------------
      const firstDaemon = makeDaemon(projectDir);
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
                join(runsDir, dir, "awaits", "blocked-promoter-ask-wait.json"),
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
          "blocked-promoter-ask-wait.json",
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
        existsSync(join(runsDir, dir, "awaits", "blocked-promoter-ask-wait.json")),
      );
      expect(
        persistedSuspensionRunId,
        "suspension file must persist across daemon stop " +
          "(seam: installAwaitResumers crash-window contract)",
      ).toBeTruthy();
      // The OwnerQuestionQueue file persists too — independent of the bus.
      expect(getOwnerQuestionQueue().get(questionId!)?.status).toBe("pending");

      // ---- Phase 2: restart daemon, deliver free-form chat reply ------------
      const secondDaemon = makeDaemon(projectDir);
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
        const pending = new Map<string, { chatId: string; messageId: number }>(
          [[questionId!, { chatId: String(chatId), messageId }]],
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
          projectDir,
          "data",
          "tasks",
          "ready",
          "task-pick-variant.md",
        );
        await waitFor(
          () => existsSync(promotedPath),
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
          existsSync(
            join(projectDir, "data", "tasks", "blocked", "task-pick-variant.md"),
          ),
          "the task must have moved out of blocked/",
        ).toBe(false);
      } finally {
        // The resume run's `request-restart` step normally triggers daemon
        // self-shutdown; we still call stop with a short grace as a safety
        // net for cases where the test ends before the workflow's restart
        // step has fired.
        await secondDaemon.stop(100);
        await secondStart;
      }
    },
    50_000,
  );
});
