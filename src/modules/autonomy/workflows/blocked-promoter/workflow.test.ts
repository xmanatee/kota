import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { AwaitEventStepOutput } from "#core/workflow/steps/step-executor-await-event.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import {
  readOperatorCaptureInstructedMarker,
  renderOperatorCaptureInstructedMarker,
  renderOwnerAskMarker,
  renderOwnerResolvedMarker,
} from "#modules/repo-tasks/blocked-precondition.js";
import blockedPromoterWorkflow from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(),
}));

vi.mock("#modules/autonomy/commit.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/commit.js")>(
      "#modules/autonomy/commit.js",
    );
  return {
    ...actual,
    commitWorkflowChanges: vi.fn(() => ({ committed: true })),
    checkCommitStageable: vi.fn(() => "ok"),
  };
});

vi.mock("#modules/autonomy/shared.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/shared.js")>(
      "#modules/autonomy/shared.js",
    );
  return {
    ...actual,
    runCheck: vi.fn(() => "ok"),
    checkNoScratchArtifacts: vi.fn(() => "ok"),
    checkCommitMessageExists: vi.fn(() => "ok"),
  };
});

vi.mock("#core/daemon/owner-question-queue.js", () => ({
  getOwnerQuestionQueue: vi.fn(),
}));

async function mockCleanWorktree() {
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
}

type StubQueueState = {
  status: "answered" | "dismissed" | "expired";
  answer?: string;
};

function makeStubQueue(state: StubQueueState) {
  let stored: PendingOwnerQuestion | null = null;
  return {
    list: () => [],
    enqueue: (input: {
      context: string;
      question: string;
      reason: string;
      source: string;
      proposedAnswers?: string[];
      timeoutMs?: number;
      defaultResolution?: "dismiss" | "answer";
    }): PendingOwnerQuestion => {
      stored = {
        id: "q-stub-blocked-1",
        seq: 1,
        context: input.context,
        question: input.question,
        reason: input.reason,
        source: input.source,
        createdAt: "2026-04-25T00:00:00Z",
        status: "pending",
        ...(input.proposedAnswers && { proposedAnswers: input.proposedAnswers }),
        ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
        ...(input.defaultResolution && { defaultResolution: input.defaultResolution }),
      };
      return stored;
    },
    get: (id: string): PendingOwnerQuestion | null => {
      if (!stored || stored.id !== id) return null;
      const resolved: PendingOwnerQuestion = { ...stored, status: state.status };
      if (state.answer !== undefined) resolved.answer = state.answer;
      return resolved;
    },
  };
}

function awaitAnsweredOutput(): AwaitEventStepOutput {
  return {
    kind: "event",
    event: "owner.question.resolved",
    matchField: "id",
    matchValue: "q-stub-blocked-1",
    payload: { id: "q-stub-blocked-1", answered: true },
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TASK_TEMPLATE = (
  id: string,
  preconditionSection: string,
  extras = "",
  updatedAt = "2026-04-25T00:00:00.000Z",
): string => {
  const now = updatedAt;
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    "status: blocked",
    "priority: p2",
    "area: autonomy",
    `summary: ${id}`,
    `created_at: ${now}`,
    `updated_at: ${now}`,
    "---",
    "",
    "## Problem",
    "Body.",
    "",
    "## Desired Outcome",
    "Outcome.",
    "",
    "## Constraints",
    "Constraints.",
    "",
    "## Done When",
    "- when",
    "",
    preconditionSection,
    "",
    "## Source / Intent",
    "Source.",
    "",
    "## Initiative",
    "Initiative paragraph.",
    "",
    "## Acceptance Evidence",
    "- Tests.",
    extras,
    "",
  ].join("\n");
};

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "blocked-promoter-wf-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  // Init a git repo so the moveTaskById helper's `git mv` calls succeed.
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function commitInitial(dir: string) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial", "--quiet"], { cwd: dir });
}

describe("blocked-promoter workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-promotes tasks whose deterministic preconditions are satisfied", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();

    // Enabler in done/
    writeFileSync(
      join(projectDir, "data", "tasks", "done", "task-enabler.md"),
      "---\nid: task-enabler\nstatus: done\n---\n# done\n",
    );
    // task-done precondition referencing the enabler
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-depends-on-enabler.md"),
      TASK_TEMPLATE(
        "task-depends-on-enabler",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: task-done",
          "ref: task-enabler",
          "```",
        ].join("\n"),
      ),
    );
    // operator-capture precondition that exists
    mkdirSync(join(projectDir, ".kota", "runs", "harness-parity-x"), { recursive: true });
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-needs-capture.md"),
      TASK_TEMPLATE(
        "task-needs-capture",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/harness-parity-*",
          "description: live captures",
          "```",
        ].join("\n"),
      ),
    );
    // capability-installed (storageState) precondition that does NOT match yet
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-needs-storage.md"),
      TASK_TEMPLATE(
        "task-needs-storage",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: capability-installed",
          "probe: storageState:.kota/auth.json",
          "```",
        ].join("\n"),
      ),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(blockedPromoterWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      projectDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    const promotion = result.steps["promote-deterministic"].output as {
      promotions: Array<{ id: string; toState: string }>;
    };
    const promotedIds = promotion.promotions.map((p) => p.id).sort();
    expect(promotedIds).toEqual([
      "task-depends-on-enabler",
      "task-needs-capture",
    ]);
    // The task-needs-storage one stayed blocked (capability not present).
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "blocked", "task-needs-storage.md"),
      ),
    ).toBe(true);
    // Promoted tasks landed in backlog (p2 → backlog).
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "backlog", "task-depends-on-enabler.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "backlog", "task-needs-capture.md"),
      ),
    ).toBe(true);
  });

  it("re-asks the owner for a due owner-decision and promotes on approval", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant should we pick?",
          "context: Variants A, B, hybrid sketched in body.",
          "proposed_answers: variant-a, variant-b, hybrid, unblock",
          "```",
        ].join("\n"),
      ),
    );
    commitInitial(projectDir);

    const queue = makeStubQueue({ status: "answered", answer: "unblock" });
    const { getOwnerQuestionQueue } = await import(
      "#core/daemon/owner-question-queue.js"
    );
    vi.mocked(getOwnerQuestionQueue).mockReturnValue(
      queue as unknown as ReturnType<typeof getOwnerQuestionQueue>,
    );

    const harness = new WorkflowTestHarness(blockedPromoterWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      projectDir,
      stepMocks: {
        "blocked-promoter-ask-wait": awaitAnsweredOutput(),
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["blocked-promoter-ask-ask"].status).toBe("success");
    expect(result.steps["blocked-promoter-ask-consume"].status).toBe("success");
    expect(result.steps["apply-ask-outcome"].status).toBe("success");
    expect(result.steps["promote-after-approval"].status).toBe("success");
    const followups = (
      result.steps["promote-after-approval"].output as {
        promotions: Array<{ id: string }>;
      }
    ).promotions;
    expect(followups.map((p) => p.id)).toContain("task-pick-variant");
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "backlog", "task-pick-variant.md"),
      ),
    ).toBe(true);
  });

  it("refreshes the asked marker on a non-approval answer without promoting", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: Variants A, B, hybrid sketched in body.",
          "proposed_answers: variant-a, variant-b, hybrid, unblock",
          "```",
        ].join("\n"),
      ),
    );
    commitInitial(projectDir);

    const queue = makeStubQueue({ status: "answered", answer: "still thinking" });
    const { getOwnerQuestionQueue } = await import(
      "#core/daemon/owner-question-queue.js"
    );
    vi.mocked(getOwnerQuestionQueue).mockReturnValue(
      queue as unknown as ReturnType<typeof getOwnerQuestionQueue>,
    );

    const harness = new WorkflowTestHarness(blockedPromoterWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      projectDir,
      stepMocks: {
        "blocked-promoter-ask-wait": awaitAnsweredOutput(),
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["promote-after-approval"].status).toBe("skipped");
    const taskBody = readFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-pick-variant.md"),
      "utf-8",
    );
    expect(taskBody).toContain("blocked-promoter-asked: slot=pick-variant");
    expect(taskBody).not.toContain("blocked-promoter-resolved");
  });

  it("skips owner ask when the marker is fresher than 14 days", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    const recentMarker = renderOwnerAskMarker({
      slot: "pick-variant",
      lastAskedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: ctx.",
          "proposed_answers: variant-a",
          "```",
        ].join("\n"),
        recentMarker,
      ),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(blockedPromoterWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      projectDir,
    });

    const result = await harness.run();

    expect(result.steps["blocked-promoter-ask-ask"].status).toBe("skipped");
    expect(result.steps["promote-after-approval"].status).toBe("skipped");
  });

  it("skips all work on runtime.recovered triggers", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    const harness = new WorkflowTestHarness(blockedPromoterWorkflow, {
      trigger: { event: "runtime.recovered", payload: {} },
      projectDir,
    });
    const result = await harness.run();
    expect(result.steps["inspect-blocked"].status).toBe("skipped");
    expect(result.steps["promote-deterministic"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("instructs an aged operator-capture blocker and writes the run artifact", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    const oldUpdatedAt = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-aged-capture.md"),
      TASK_TEMPLATE(
        "task-aged-capture",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/peer-cli-comparison",
          "description: peer-CLI captures",
          "```",
        ].join("\n"),
        "",
        oldUpdatedAt,
      ),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(blockedPromoterWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["instruct-operator-capture"].status).toBe("success");
    const instructions = (
      result.steps["instruct-operator-capture"].output as {
        instructions: Array<{ taskId: string; capturePath: string }>;
      }
    ).instructions;
    expect(instructions.map((i) => i.taskId)).toEqual(["task-aged-capture"]);
    // The marker is written to the task body.
    const body = readFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-aged-capture.md"),
      "utf-8",
    );
    expect(readOperatorCaptureInstructedMarker(body)).not.toBeNull();
    // The blocker-actions artifact is present in the run dir.
    expect(result.steps["write-blocker-actions"].status).toBe("success");
    const artifactPath = (
      result.steps["write-blocker-actions"].output as {
        path: string;
      }
    ).path;
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      actions: Array<{ kind: string; taskId: string }>;
      operatorCaptureInstructionsEmitted: Array<{ taskId: string; capturePath: string }>;
    };
    expect(artifact.actions[0].kind).toBe("operator-capture-due");
    expect(artifact.operatorCaptureInstructionsEmitted[0].capturePath).toBe(
      ".kota/runs/peer-cli-comparison",
    );
  });

  it("does not re-instruct an aged operator-capture within the cadence", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    const oldUpdatedAt = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
    const recentMarker = renderOperatorCaptureInstructedMarker({
      lastInstructedAt: new Date(Date.now() - 1 * MS_PER_DAY).toISOString(),
    });
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-aged-capture.md"),
      TASK_TEMPLATE(
        "task-aged-capture",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/peer-cli-comparison",
          "description: peer-CLI captures",
          "```",
        ].join("\n"),
        recentMarker,
        oldUpdatedAt,
      ),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(blockedPromoterWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      projectDir,
    });
    const result = await harness.run();

    expect(result.steps["instruct-operator-capture"].status).toBe("skipped");
    // The artifact still records the recent classification but no new instruction.
    expect(result.steps["write-blocker-actions"].status).toBe("success");
    const artifactPath = (
      result.steps["write-blocker-actions"].output as { path: string }
    ).path;
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      actions: Array<{ kind: string }>;
      operatorCaptureInstructionsEmitted: unknown[];
    };
    expect(artifact.actions[0].kind).toBe("operator-capture-recent");
    expect(artifact.operatorCaptureInstructionsEmitted).toHaveLength(0);
  });

  it("surfaces the recommended option in the owner-ask question", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: Recommended: variant-a. Rationale: x.",
          "proposed_answers: variant-a, variant-b, hybrid, unblock",
          "```",
        ].join("\n"),
      ),
    );
    commitInitial(projectDir);

    const recordedEnqueueArgs: Array<{
      proposedAnswers?: string[];
      reason: string;
      context: string;
    }> = [];
    const queue = makeStubQueue({ status: "answered", answer: "variant-a" });
    const baseEnqueue = queue.enqueue;
    queue.enqueue = (input) => {
      recordedEnqueueArgs.push({
        ...(input.proposedAnswers && { proposedAnswers: input.proposedAnswers }),
        reason: input.reason,
        context: input.context,
      });
      return baseEnqueue(input);
    };
    const { getOwnerQuestionQueue } = await import(
      "#core/daemon/owner-question-queue.js"
    );
    vi.mocked(getOwnerQuestionQueue).mockReturnValue(
      queue as unknown as ReturnType<typeof getOwnerQuestionQueue>,
    );

    const harness = new WorkflowTestHarness(blockedPromoterWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      projectDir,
      stepMocks: {
        "blocked-promoter-ask-wait": awaitAnsweredOutput(),
      },
    });
    await harness.run();

    expect(recordedEnqueueArgs).toHaveLength(1);
    expect(recordedEnqueueArgs[0].proposedAnswers?.[0]).toBe("variant-a");
    expect(recordedEnqueueArgs[0].reason).toContain("variant-a");
    expect(recordedEnqueueArgs[0].context).toContain("Recommended option: variant-a");
  });

  it("promotes already-resolved owner-decision tasks deterministically", async () => {
    await mockCleanWorktree();
    const projectDir = makeProjectDir();
    const resolvedMarker = renderOwnerResolvedMarker({
      slot: "pick-variant",
      resolvedAt: "2026-04-24T00:00:00.000Z",
    });
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Unblock Precondition",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: ctx.",
          "proposed_answers: variant-a",
          "```",
        ].join("\n"),
        resolvedMarker,
      ),
    );
    commitInitial(projectDir);

    const harness = new WorkflowTestHarness(blockedPromoterWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      projectDir,
    });
    const result = await harness.run();
    const promotion = result.steps["promote-deterministic"].output as {
      promotions: Array<{ id: string }>;
    };
    expect(promotion.promotions.map((p) => p.id)).toContain("task-pick-variant");
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "backlog", "task-pick-variant.md"),
      ),
    ).toBe(true);
  });
});
