import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { Daemon } from "#core/daemon/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import blockedPromoterWorkflow from "./workflow.js";

// The cycle's components remain real. These mocks cover only adjacent
// validation, commit, task-store initialization, and Telegram HTTP transport.
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
    commitWorkflowChanges: vi.fn(() => ({
      committed: true,
      committedPaths: ["data/tasks/ready/task-pick-variant.md"],
      daemonRestartRequired: false,
    })),
    checkCommitStageable: vi.fn(() => "ok"),
  };
});

vi.mock("#core/daemon/task-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/daemon/task-store.js")>();
  return { ...actual, initTaskStore: vi.fn() };
});

export async function tryHandleOwnerQuestionReply(
  input: Parameters<
    (typeof import("#modules/telegram/owner-question-reply.js"))["tryHandleOwnerQuestionReply"]
  >[0],
): Promise<boolean> {
  const reply = await import("#modules/telegram/owner-question-reply.js");
  return await reply.tryHandleOwnerQuestionReply(input);
}

export async function waitFor<T>(
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
    await new Promise((resolve) => setTimeout(resolve, 25));
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

export function setupProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "owner-decision-cycle-"));
  writeFileSync(join(dir, ".gitignore"), ".kota/\n");
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  writeFileSync(
    join(dir, "data", "tasks", "blocked", "task-pick-variant.md"),
    blockedTaskBody(),
  );
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

export function makeDaemon(projectDir: string): Daemon {
  const stateDir = join(projectDir, ".kota");
  return new Daemon({
    projectDir,
    stateDir,
    idleIntervalMs: 5_000,
    pollIntervalMs: 60_000,
    shutdownGracePeriodMs: 10_000,
    restartExit: vi.fn(),
    workflows: [
      registerWorkflowDefinition(
        "src/modules/autonomy/workflows/blocked-promoter/workflow.ts",
        {
          ...blockedPromoterWorkflow,
          moduleRoot: projectDir,
        },
      ),
    ],
  });
}
