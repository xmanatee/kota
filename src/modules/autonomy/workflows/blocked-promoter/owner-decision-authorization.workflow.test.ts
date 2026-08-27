import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import blockedPromoterOwnerDecisionWorkflow from "../blocked-promoter-owner-decision/workflow.js";
import {
  BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
  BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
  type BlockedOwnerDecisionRequest,
  type BlockedOwnerDecisionResolution,
} from "./owner-decision-follow-up.js";
import blockedPromoterWorkflow from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(),
}));

vi.mock("#core/daemon/owner-question-queue.js", () => ({
  getOwnerQuestionQueue: vi.fn(),
}));

function ownerQuestionQueue(answer: string) {
  let stored: PendingOwnerQuestion | null = null;
  return {
    list: () => [],
    enqueue: (input: Omit<PendingOwnerQuestion, "id" | "seq" | "createdAt" | "status">) => {
      stored = {
        ...input,
        id: "q-owner-decision",
        seq: 1,
        createdAt: "2026-08-06T09:00:00.000Z",
        status: "pending",
      };
      return stored;
    },
    get: (id: string): PendingOwnerQuestion | null =>
      stored && stored.id === id ? { ...stored, status: "answered", answer } : null,
  };
}

function taskBody(question: string): string {
  return [
    "---",
    "status: blocked",
    "priority: p2",
    "---",
    "",
    "# Owner decision",
    "",
    "## Problem",
    "Owner input is required.",
    "",
    "## Blocked on",
    "",
    "```",
    "kind: owner-decision",
    "slot: remain-blocked",
    `question: ${question}`,
    "context: An affirmative free-form reply means keep the blocker in place.",
    "proposed_answers: keep-blocked, unblock",
    "```",
    "",
  ].join("\n");
}

function projectFixture(): { workspaceRoot: string; taskPath: string } {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "blocked-promoter-auth-"));
  writeFileSync(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ scripts: { "validate-tasks": "true" } }),
  );
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
  mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
  writeFileSync(join(workspaceRoot, "data", "tasks", "AGENTS.md"), "# tasks\n");
  writeFileSync(
    join(workspaceRoot, "data", "tasks", "archive", "AGENTS.md"),
    "# archive\n",
  );
  const taskPath = join(
    workspaceRoot,
    "data",
    "tasks",
    "task-owner-decision.md",
  );
  writeFileSync(taskPath, taskBody("Should this task remain blocked?"));
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["config", "user.name", "test"], { cwd: workspaceRoot });
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "-m", "initial", "--quiet"], {
    cwd: workspaceRoot,
  });
  return { workspaceRoot, taskPath };
}

async function useOwnerAnswer(answer: string): Promise<void> {
  const { getOwnerQuestionQueue } = await import(
    "#core/daemon/owner-question-queue.js"
  );
  vi.mocked(getOwnerQuestionQueue).mockReturnValue(
    ownerQuestionQueue(answer) as unknown as ReturnType<
      typeof getOwnerQuestionQueue
    >,
  );
}

async function resolveOwnerDecision(
  workspaceRoot: string,
  answer: string,
): Promise<BlockedOwnerDecisionResolution> {
  await useOwnerAnswer(answer);
  const requestRun = await new WorkflowScenarioDriver(blockedPromoterWorkflow, {
    trigger: { event: "autonomy.queue.available", payload: {} },
    workspaceRoot,
    ports: { runCommand: successfulWorkflowCommandRun },
  }).run();
  const request = requestRun.emitted.find(
    (event) => event.event === BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
  )?.payload as BlockedOwnerDecisionRequest | undefined;
  if (!request) throw new Error("blocked promoter did not emit an owner request");
  const followUp = await new WorkflowScenarioDriver(
    blockedPromoterOwnerDecisionWorkflow,
    {
      trigger: {
        event: BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
        payload: request,
      },
      workspaceRoot,
      events: [{
        afterStep: "blocked-promoter-owner-decision-wait",
        event: "owner.question.resolved",
        payload: { id: "q-owner-decision", answered: true, answer },
      }],
    },
  ).run();
  const resolution = followUp.emitted.find(
    (event) => event.event === BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
  )?.payload as BlockedOwnerDecisionResolution | undefined;
  if (!resolution) throw new Error("owner follow-up did not emit a resolution");
  return resolution;
}

describe("blocked-promoter owner-decision authorization", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValue({
      available: true,
      dirty: false,
      trackedDirty: false,
      entries: [],
      fingerprint: "",
      summary: "clean",
      headSha: "abc1234",
    });
  });

  it.each(["yes", "approve"])(
    "keeps a negatively phrased task blocked after ambiguous '%s'",
    async (answer) => {
      const { workspaceRoot } = projectFixture();
      const resolution = await resolveOwnerDecision(workspaceRoot, answer);
      const result = await new WorkflowScenarioDriver(blockedPromoterWorkflow, {
        trigger: {
          event: BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
          payload: resolution,
        },
        workspaceRoot,
        ports: { runCommand: successfulWorkflowCommandRun },
      }).run();

      expect(result.status).toBe("success");
      expect(result.steps["promote-after-approval"].status).toBe("skipped");
      const after = readFileSync(
        join(result.workspaceDir, "data", "tasks", "task-owner-decision.md"),
        "utf-8",
      );
      expect(after).toContain("blocked-promoter-asked: slot=remain-blocked");
      expect(after).not.toContain("blocked-promoter-resolved");
      expect(existsSync(join(
        result.workspaceDir,
        "data",
        "tasks",
        "task-owner-decision.md",
      ))).toBe(true);
    },
  );

  it("fails closed when the precondition changes during the owner wait", async () => {
    const { workspaceRoot, taskPath } = projectFixture();
    const resolution = await resolveOwnerDecision(workspaceRoot, "unblock");
    writeFileSync(taskPath, taskBody("Which variant should we pick?"));
    execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "change precondition"], {
      cwd: workspaceRoot,
    });
    const result = await new WorkflowScenarioDriver(blockedPromoterWorkflow, {
      trigger: {
        event: BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
        payload: resolution,
      },
      workspaceRoot,
      ports: { runCommand: successfulWorkflowCommandRun },
    }).run();

    expect(result.status).toBe("failed");
    expect(result.steps["apply-ask-outcome"].error).toContain(
      "precondition changed while awaiting an answer",
    );
    const after = readFileSync(
      join(result.workspaceDir, "data", "tasks", "task-owner-decision.md"),
      "utf-8",
    );
    expect(after).not.toContain("blocked-promoter-asked");
    expect(after).not.toContain("blocked-promoter-resolved");
  });
});
