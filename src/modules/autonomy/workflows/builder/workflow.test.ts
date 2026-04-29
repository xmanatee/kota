import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import {
  checkModuleBoundary,
  checkSuccessCriteriaDeclared,
  checkSuccessCriteriaVerified,
  ROOT_PRODUCTION_ALLOWLIST,
} from "./repair-checks.js";
import builderWorkflow from "./workflow.js";

const promptPath = fileURLToPath(new URL("./prompt.md", import.meta.url));
const promptContent = readFileSync(promptPath, "utf-8");
const builderAgentsPath = fileURLToPath(new URL("./AGENTS.md", import.meta.url));
const builderAgentsContent = readFileSync(builderAgentsPath, "utf-8");
const taskAgentsPath = fileURLToPath(new URL("../../../../../data/tasks/AGENTS.md", import.meta.url));
const taskAgentsContent = readFileSync(taskAgentsPath, "utf-8");

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(() => ({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc1234",
  })),
  getRepoHeadSha: vi.fn(() => "abc1234"),
}));

vi.mock("#modules/repo-tasks/repo-tasks-domain.js", () => ({
  getRepoTaskQueueSnapshot: vi.fn(),
  isRepoTaskQueueSnapshot: vi.fn(() => true),
  REPO_TASK_STATES: ["backlog", "ready", "doing", "blocked", "done", "dropped"],
  REPO_TASKS_DIR: "data/tasks",
}));

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

vi.mock("./run-summary.js", () => ({
  writeBuilderRunSummary: vi.fn(() => ({
    runs: [],
    costByWorkflow: {},
  })),
}));

vi.mock("./branch-per-task.js", () => ({
  createTaskBranch: vi.fn(() => ({
    branchPerTask: false,
    branch: null,
    baseBranch: null,
    taskId: null,
  })),
  createPullRequest: vi.fn(() => ({ prUrl: "https://github.com/example/repo/pull/1" })),
  cleanupMergedBranches: vi.fn(() => ({ cleaned: [], warnings: [] })),
}));

vi.mock("#modules/autonomy/recovery.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/recovery.js")>(
      "#modules/autonomy/recovery.js",
    );
  return {
    ...actual,
    resetWorktreeForRecovery: vi.fn(() => ({
      stashed: false,
      stashSummary: "clean",
      branchRestored: false,
      previousBranch: null,
      currentBranch: "main",
    })),
  };
});

function makeEmptySnapshot() {
  return {
    counts: {
      backlog: 0,
      ready: 0,
      doing: 0,
      blocked: 0,
      done: 0,
      dropped: 0,
    },
    inboxCount: 0,
    openCount: 0,
    pullableCount: 0,
    actionableCount: 0,
    headSha: "abc1234",
  };
}

function makeSnapshot(ready: number, doing: number, backlog = 4) {
  const counts = {
    backlog,
    ready,
    doing,
    blocked: 0,
    done: 0,
    dropped: 0,
  };
  return {
    counts,
    inboxCount: 0,
    openCount: counts.backlog + counts.ready + counts.doing + counts.blocked,
    pullableCount: counts.backlog + counts.ready + counts.doing,
    actionableCount: ready + doing,
    headSha: "abc1234",
  };
}

describe("builder workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips build when worktree is dirty", async () => {
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValueOnce({
      available: true,
      dirty: true,
      trackedDirty: true,
      entries: ["M src/foo.ts"],
      fingerprint: "M src/foo.ts",
      summary: "src/foo.ts",
      headSha: "abc1234",
    });

    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(2, 1));

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 7, actionableCount: 3, counts: makeSnapshot(2, 1).counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0 } },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-ready-queue"].output).toMatchObject({ dirty: true });
    expect(result.steps.build.status).toBe("skipped");
  });

  it("resets worktree and skips build on runtime.recovered trigger", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(2, 1));

    const { resetWorktreeForRecovery } = await import("#modules/autonomy/recovery.js");
    vi.mocked(resetWorktreeForRecovery).mockReturnValue({
      stashed: true,
      stashSummary: "1 file stashed",
      branchRestored: true,
      previousBranch: "kota/task/task-foo",
      currentBranch: "main",
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "runtime.recovered",
        payload: { reason: "dirty-worktree-after-crash" },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0 } },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["reset-for-recovery"].status).toBe("success");
    expect(result.steps["reset-for-recovery"].output).toMatchObject({
      stashed: true,
      branchRestored: true,
      previousBranch: "kota/task/task-foo",
      currentBranch: "main",
    });
    expect(vi.mocked(resetWorktreeForRecovery)).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: "builder", restoreBaseBranch: true }),
    );
    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    expect(result.steps["write-run-summary"].status).toBe("skipped");
    expect(result.steps["emit-build-committed"].status).toBe("skipped");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });

  it("skips build and commit when no pullable queue work exists", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeEmptySnapshot());

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 0, actionableCount: 0, counts: makeEmptySnapshot().counts },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-ready-queue"].status).toBe("success");
    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    expect(result.steps["write-run-summary"].status).toBe("skipped");
    expect(result.steps["emit-build-committed"].status).toBe("skipped");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });

  it("runs build and commit when ready or doing work exists", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(2, 1));

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 3, actionableCount: 3, counts: makeSnapshot(2, 1).counts },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.05 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-ready-queue"].status).toBe("success");
    expect(result.steps.build.status).toBe("success");
    expect(result.steps.build.output).toMatchObject({ totalCostUsd: 0.05 });
    expect(result.steps.commit.status).toBe("success");
  });

  it("runs build when backlog exists even if ready is empty", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(0, 0, 2));

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 2,
          actionableCount: 0,
          counts: {
            backlog: 2,
            ready: 0,
            doing: 0,
            blocked: 0,
            done: 0,
            dropped: 0,
          },
        },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.03 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.build.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });

  it("skips commit and write-run-summary when build fails", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: makeSnapshot(1, 0).counts },
      },
      // build step mock missing — harness will throw for agent step
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.build.status).toBe("failed");
    expect(result.steps.build.error).toMatch(/requires a mock/);
    expect(result.steps.commit).toBeUndefined();
  });

  it("emits workflow.build.committed after a successful commit with run-summary payload", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { writeBuilderRunSummary } = await import("./run-summary.js");
    vi.mocked(writeBuilderRunSummary).mockReturnValue({
      runId: "run-abc",
      workflow: "builder",
      taskId: "task-foo-bar",
      taskTitle: "Add foo bar support",
      outcome: "success",
      commitSha: "abc123",
      commitMessage: "Add foo bar support",
      filesChanged: ["src/foo.ts"],
      costUsd: 0.42,
      durationMs: 480000,
      completedAt: "2026-04-02T10:00:00Z",
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: makeSnapshot(1, 0).counts },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.42 },
      },
    });

    const result = await harness.run();

    expect(result.steps["emit-build-committed"].status).toBe("success");
    const committed = result.emitted.find((e) => e.event === "workflow.build.committed");
    expect(committed).toBeDefined();
    expect(committed?.payload).toMatchObject({
      taskId: "task-foo-bar",
      commitMessage: "Add foo bar support",
      costUsd: 0.42,
      durationMs: 480000,
    });
  });

  it("keeps task-selection detail in task docs instead of bloating the prompt", () => {
    // The prompt points at data/tasks/ but does not enumerate state-specific
    // paths — state lifecycle detail belongs in the task queue docs.
    expect(promptContent).toMatch(/data\/tasks\//);
    expect(promptContent).not.toMatch(/data\/tasks\/doing\//);
    expect(promptContent).not.toMatch(/data\/tasks\/ready\//);
    expect(promptContent).not.toMatch(/data\/tasks\/blocked\//);
    expect(taskAgentsContent).toMatch(/State directories define their own lifecycle/i);
  });

  it("keeps success-criteria protocol in local builder instructions, not repeated in the prompt", () => {
    expect(promptContent).toMatch(/Declare and verify success criteria in the run directory/);
    expect(promptContent).toMatch(/Done When/);
    expect(promptContent).not.toMatch(/success-criteria\.txt/);
    expect(promptContent).not.toMatch(/success-criteria-verified\.txt/);
    expect(builderAgentsContent).toMatch(/success-criteria\.txt/);
    expect(builderAgentsContent).toMatch(/success-criteria-verified\.txt/);
  });

  it("includes inspect-ready-queue snapshot in step output", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    const snapshot = makeSnapshot(3, 0);
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(snapshot);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 7, actionableCount: 3, counts: snapshot.counts },
      },
      stepMocks: { build: { turns: [] } },
    });

    const result = await harness.run();

    expect(result.steps["inspect-ready-queue"].status).toBe("success");
    expect(result.steps["inspect-ready-queue"].output).toMatchObject({
      actionableCount: 3,
      pullableCount: 7,
      counts: expect.objectContaining({ ready: 3 }),
    });
  });

  it("create-task-branch runs after successful build check, create-pr skipped when branchPerTask=false", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { getRepoHeadSha } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoHeadSha).mockReturnValue("abc1234");

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { createTaskBranch } = await import("./branch-per-task.js");
    vi.mocked(createTaskBranch).mockReturnValue({
      branchPerTask: false,
      branch: null,
      baseBranch: null,
      taskId: null,
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: makeSnapshot(1, 0).counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.01 } },
    });

    const result = await harness.run();

    expect(result.steps["create-task-branch"].status).toBe("success");
    expect(result.steps["create-task-branch"].output).toMatchObject({ branchPerTask: false });
    expect(result.steps.commit.status).toBe("success");
    expect(result.steps["create-pr"].status).toBe("skipped");
  });

  it("create-pr runs and returns PR URL when branchPerTask=true", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { getRepoHeadSha } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoHeadSha).mockReturnValue("abc1234");

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { createTaskBranch, createPullRequest } = await import("./branch-per-task.js");
    vi.mocked(createTaskBranch).mockReturnValue({
      branchPerTask: true,
      branch: "kota/task/task-foo",
      baseBranch: "main",
      taskId: "task-foo",
    });
    vi.mocked(createPullRequest).mockReturnValue({ prUrl: "https://github.com/org/repo/pull/42" });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: makeSnapshot(1, 0).counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.05 } },
    });

    const result = await harness.run();

    expect(result.steps["create-task-branch"].status).toBe("success");
    expect(result.steps["create-task-branch"].output).toMatchObject({
      branchPerTask: true,
      branch: "kota/task/task-foo",
    });
    expect(result.steps["create-pr"].status).toBe("success");
    expect(result.steps["create-pr"].output).toMatchObject({
      prUrl: "https://github.com/org/repo/pull/42",
    });
  });

  it("create-pr failure propagates as run failure", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { getRepoHeadSha } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoHeadSha).mockReturnValue("abc1234");

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { createTaskBranch, createPullRequest } = await import("./branch-per-task.js");
    vi.mocked(createTaskBranch).mockReturnValue({
      branchPerTask: true,
      branch: "kota/task/task-foo",
      baseBranch: "main",
      taskId: "task-foo",
    });
    vi.mocked(createPullRequest).mockImplementation(() => {
      throw new Error("gh CLI is not available or not authenticated.");
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: makeSnapshot(1, 0).counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.05 } },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps["create-pr"].status).toBe("failed");
    expect(result.steps["create-pr"].error).toMatch(/gh CLI is not available/);
  });

  it("create-task-branch and create-pr are skipped when build is skipped", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeEmptySnapshot());

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: makeSnapshot(1, 0).counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0 } },
    });

    const result = await harness.run();

    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps["create-task-branch"].status).toBe("skipped");
    expect(result.steps["create-pr"].status).toBe("skipped");
    expect(result.steps["cleanup-merged-branches"].status).toBe("skipped");
  });

  it("cleanup-merged-branches runs after create-pr when branchPerTask=true and returns cleaned branches", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { getRepoHeadSha } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoHeadSha).mockReturnValue("abc1234");

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { createTaskBranch, createPullRequest, cleanupMergedBranches } = await import(
      "./branch-per-task.js"
    );
    vi.mocked(createTaskBranch).mockReturnValue({
      branchPerTask: true,
      branch: "kota/task/task-foo",
      baseBranch: "main",
      taskId: "task-foo",
    });
    vi.mocked(createPullRequest).mockReturnValue({ prUrl: "https://github.com/org/repo/pull/42" });
    vi.mocked(cleanupMergedBranches).mockReturnValue({
      cleaned: ["kota/task/task-old"],
      warnings: [],
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: makeSnapshot(1, 0).counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.05 } },
    });

    const result = await harness.run();

    expect(result.steps["create-pr"].status).toBe("success");
    expect(result.steps["cleanup-merged-branches"].status).toBe("success");
    expect(result.steps["cleanup-merged-branches"].output).toMatchObject({
      cleaned: ["kota/task/task-old"],
      warnings: [],
    });
  });

  it("cleanup-merged-branches is skipped when branchPerTask=false", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { getRepoHeadSha } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoHeadSha).mockReturnValue("abc1234");

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { createTaskBranch } = await import("./branch-per-task.js");
    vi.mocked(createTaskBranch).mockReturnValue({
      branchPerTask: false,
      branch: null,
      baseBranch: null,
      taskId: null,
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: makeSnapshot(1, 0).counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.01 } },
    });

    const result = await harness.run();

    expect(result.steps["create-pr"].status).toBe("skipped");
    expect(result.steps["cleanup-merged-branches"].status).toBe("skipped");
  });

  it("cleanup-merged-branches failure with warnings does not fail the run", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { getRepoHeadSha } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoHeadSha).mockReturnValue("abc1234");

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { createTaskBranch, createPullRequest, cleanupMergedBranches } = await import(
      "./branch-per-task.js"
    );
    vi.mocked(createTaskBranch).mockReturnValue({
      branchPerTask: true,
      branch: "kota/task/task-bar",
      baseBranch: "main",
      taskId: "task-bar",
    });
    vi.mocked(createPullRequest).mockReturnValue({ prUrl: "https://github.com/org/repo/pull/7" });
    vi.mocked(cleanupMergedBranches).mockReturnValue({
      cleaned: [],
      warnings: ["Failed to delete branch kota/task/task-old: remote error"],
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: makeSnapshot(1, 0).counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.02 } },
    });

    const result = await harness.run();

    // Cleanup warnings do not fail the run
    expect(result.steps["cleanup-merged-branches"].status).toBe("success");
    expect(result.steps["cleanup-merged-branches"].output).toMatchObject({
      cleaned: [],
      warnings: ["Failed to delete branch kota/task/task-old: remote error"],
    });
    expect(result.status).toBe("success");
  });
});

function makeTmpProject(): string {
  const dir = join(tmpdir(), `kota-boundary-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

describe("checkModuleBoundary", () => {
  it("passes when src/ has no production files", () => {
    const dir = makeTmpProject();
    expect(checkModuleBoundary(dir)).toBe("OK: no root helper drift detected");
  });

  it("passes when src/ has only allowlisted files", () => {
    const dir = makeTmpProject();
    writeFileSync(join(dir, "src/cli.ts"), "export {};");
    writeFileSync(join(dir, "src/init.ts"), "export {};");
    expect(checkModuleBoundary(dir)).toBe("OK: no root helper drift detected");
  });

  it("passes when src/ has test and integration test files", () => {
    const dir = makeTmpProject();
    writeFileSync(join(dir, "src/capability.test.ts"), "// test");
    writeFileSync(join(dir, "src/feature.integration.test.ts"), "// integration test");
    expect(checkModuleBoundary(dir)).toBe("OK: no root helper drift detected");
  });

  it("passes when src/ has .d.ts declaration files", () => {
    const dir = makeTmpProject();
    writeFileSync(join(dir, "src/env.d.ts"), "declare module 'x';");
    expect(checkModuleBoundary(dir)).toBe("OK: no root helper drift detected");
  });

  it("passes when src/ has whitelisted cross-cutting fixtures", () => {
    const dir = makeTmpProject();
    writeFileSync(
      join(dir, "src/conversational-cross-store-fixture.integration.ts"),
      "export {};",
    );
    expect(checkModuleBoundary(dir)).toBe("OK: no root helper drift detected");
  });

  it("fails when a non-allowlisted production file exists in src/ root", () => {
    const dir = makeTmpProject();
    writeFileSync(join(dir, "src/new-capability.ts"), "export {};");
    expect(() => checkModuleBoundary(dir)).toThrow(/Unexpected production files in src\/ root/);
    expect(() => checkModuleBoundary(dir)).toThrow("new-capability.ts");
    expect(() => checkModuleBoundary(dir)).toThrow(/src\/core\/ or src\/modules\//);
  });

  it("fails and lists all non-allowlisted files", () => {
    const dir = makeTmpProject();
    writeFileSync(join(dir, "src/feature-a.ts"), "export {};");
    writeFileSync(join(dir, "src/feature-b.ts"), "export {};");
    expect(() => checkModuleBoundary(dir)).toThrow("feature-a.ts");
    expect(() => checkModuleBoundary(dir)).toThrow("feature-b.ts");
  });

  it("passes when src/ directory does not exist", () => {
    const dir = join(tmpdir(), `kota-nosrc-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    expect(checkModuleBoundary(dir)).toBe("OK: no src/ directory");
  });

  it("passes when #root/* imports target allowlisted modules", () => {
    const dir = makeTmpProject();
    mkdirSync(join(dir, "src/core/loop"), { recursive: true });
    writeFileSync(
      join(dir, "src/core/loop/context.ts"),
      'import { something } from "#root/init.js";\n',
    );
    expect(checkModuleBoundary(dir)).toBe("OK: no root helper drift detected");
  });

  it("fails when #root/* import targets a non-allowlisted module", () => {
    const dir = makeTmpProject();
    mkdirSync(join(dir, "src/core/loop"), { recursive: true });
    writeFileSync(
      join(dir, "src/core/loop/context.ts"),
      'import { something } from "#root/new-helper.js";\n',
    );
    expect(() => checkModuleBoundary(dir)).toThrow(/Disallowed #root\/\* imports/);
    expect(() => checkModuleBoundary(dir)).toThrow("#root/new-helper.js");
    expect(() => checkModuleBoundary(dir)).toThrow("core/loop/context.ts");
  });

  it("ignores #root/* imports in test files", () => {
    const dir = makeTmpProject();
    mkdirSync(join(dir, "src/core/tools"), { recursive: true });
    writeFileSync(
      join(dir, "src/core/tools/runner.test.ts"),
      'import { something } from "#root/new-helper.js";\n',
    );
    expect(checkModuleBoundary(dir)).toBe("OK: no root helper drift detected");
  });

  it("detects both file drift and import drift together", () => {
    const dir = makeTmpProject();
    writeFileSync(join(dir, "src/stray-helper.ts"), "export const x = 1;");
    // File drift is checked first, so that error appears
    expect(() => checkModuleBoundary(dir)).toThrow(/Unexpected production files/);
    expect(() => checkModuleBoundary(dir)).toThrow("stray-helper.ts");
  });

  it("the allowlist matches current root production files", () => {
    // Smoke test: the allowlist should contain known entrypoints
    expect(ROOT_PRODUCTION_ALLOWLIST.has("cli.ts")).toBe(true);
    expect(ROOT_PRODUCTION_ALLOWLIST.has("init.ts")).toBe(true);
    expect(ROOT_PRODUCTION_ALLOWLIST.has("module-api.ts")).toBe(true);
    expect(ROOT_PRODUCTION_ALLOWLIST.has("validate-queue.ts")).toBe(true);
  });
});

describe("checkSuccessCriteriaDeclared", () => {
  function makeTmpDir(): string {
    const dir = join(tmpdir(), `kota-criteria-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("fails when success-criteria.txt does not exist", () => {
    const dir = makeTmpDir();
    expect(() => checkSuccessCriteriaDeclared(dir)).toThrow(/Missing success-criteria\.txt/);
  });

  it("fails when success-criteria.txt has fewer than 2 criteria", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "success-criteria.txt"), "Only one criterion\n");
    expect(() => checkSuccessCriteriaDeclared(dir)).toThrow(/at least 2 concrete criteria/);
  });

  it("passes when success-criteria.txt has 2 or more criteria", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "success-criteria.txt"), "Criterion 1\nCriterion 2\n");
    expect(checkSuccessCriteriaDeclared(dir)).toMatch(/OK.*2 criteria/);
  });

  it("ignores blank lines when counting criteria", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "success-criteria.txt"), "Criterion 1\n\n\nCriterion 2\n\n");
    expect(checkSuccessCriteriaDeclared(dir)).toMatch(/OK.*2 criteria/);
  });
});

describe("checkSuccessCriteriaVerified", () => {
  function makeTmpDir(): string {
    const dir = join(tmpdir(), `kota-verified-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("fails when success-criteria.txt does not exist", () => {
    const dir = makeTmpDir();
    expect(() => checkSuccessCriteriaVerified(dir)).toThrow(/success-criteria\.txt does not exist/);
  });

  it("fails when success-criteria-verified.txt does not exist", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "success-criteria.txt"), "Criterion 1\nCriterion 2\n");
    expect(() => checkSuccessCriteriaVerified(dir)).toThrow(/Missing success-criteria-verified\.txt/);
  });

  it("fails when free-form verified file has fewer evidence lines than criteria", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "success-criteria.txt"), "Criterion 1\nCriterion 2\nCriterion 3\n");
    writeFileSync(join(dir, "success-criteria-verified.txt"), "Evidence for criterion 1\nEvidence for criterion 2\n");
    expect(() => checkSuccessCriteriaVerified(dir)).toThrow(/2 evidence line.*3 criteria/);
  });

  it("passes when free-form verified file has at least as many evidence lines as criteria", () => {
    const dir = makeTmpDir();
    const criteria = "Criterion 1: tests pass\nCriterion 2: types check";
    const verified = "Criterion 1: tests pass - verified by running pnpm test\nCriterion 2: types check - verified by running pnpm typecheck";
    writeFileSync(join(dir, "success-criteria.txt"), criteria);
    writeFileSync(join(dir, "success-criteria-verified.txt"), verified);
    expect(checkSuccessCriteriaVerified(dir)).toMatch(/OK.*2 evidence lines for 2 criteria/);
  });

  it("ignores blank lines in both free-form files when counting", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "success-criteria.txt"), "Criterion 1\n\nCriterion 2\n");
    writeFileSync(join(dir, "success-criteria-verified.txt"), "Evidence 1\n\n\nEvidence 2\n");
    expect(checkSuccessCriteriaVerified(dir)).toMatch(/OK/);
  });

  it("counts numbered items — indented sub-bullets under a criterion do not require padding in evidence", () => {
    const dir = makeTmpDir();
    // Two numbered criteria, each with three sub-bullets (8 non-empty lines).
    const criteria =
      "1. Tests pass end to end.\n" +
      "   - unit tests cover the new module\n" +
      "   - integration test covers the new route\n" +
      "2. Docs describe the new endpoint.\n" +
      "   - README updated\n" +
      "   - AGENTS.md updated\n";
    // Two numbered evidence items, condensed.
    const verified =
      "1. Tests pass: pnpm test green with 42 added cases.\n" +
      "2. Docs updated: README and AGENTS.md both reflect the new endpoint.\n";
    writeFileSync(join(dir, "success-criteria.txt"), criteria);
    writeFileSync(join(dir, "success-criteria-verified.txt"), verified);
    expect(checkSuccessCriteriaVerified(dir)).toMatch(
      /OK.*2 numbered evidence items for 2 criteria/,
    );
  });

  it("fails when structured verified file has fewer numbered items than structured criteria", () => {
    const dir = makeTmpDir();
    const criteria = "1. First criterion.\n2. Second criterion.\n3. Third criterion.\n";
    const verified = "1. First criterion verified.\n2. Second criterion verified.\n";
    writeFileSync(join(dir, "success-criteria.txt"), criteria);
    writeFileSync(join(dir, "success-criteria-verified.txt"), verified);
    expect(() => checkSuccessCriteriaVerified(dir)).toThrow(
      /2 numbered evidence item.*3 criteria/,
    );
  });

  it("fails when structured criteria is countered by free-form evidence (no numbered items)", () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, "success-criteria.txt"),
      "1. First criterion.\n2. Second criterion.\n",
    );
    writeFileSync(
      join(dir, "success-criteria-verified.txt"),
      "Everything was verified across the two criteria in one paragraph.\n",
    );
    expect(() => checkSuccessCriteriaVerified(dir)).toThrow(
      /0 numbered evidence item.*2 criteria/,
    );
  });

  it("treats column-0 bullets in a notes section as prose, not criteria", () => {
    // Regression test for the durable 7d pattern (hjpmjs, vxjzg3, qno619):
    // agents draft numbered criteria followed by a `Design notes` or
    // `Known limitations` section with column-0 `- ` bullets. The check
    // must count only the numbered items, not the notes bullets.
    const dir = makeTmpDir();
    const criteria =
      "1. First numbered criterion.\n" +
      "2. Second numbered criterion.\n" +
      "\n" +
      "Known limitations to flag for the critic:\n" +
      "- Fixture coverage is intentionally minimal.\n" +
      "- Cadence schedule is opinionated.\n";
    const verified =
      "1. First criterion — VERIFIED.\n" +
      "2. Second criterion — VERIFIED.\n";
    writeFileSync(join(dir, "success-criteria.txt"), criteria);
    writeFileSync(join(dir, "success-criteria-verified.txt"), verified);
    expect(checkSuccessCriteriaVerified(dir)).toMatch(
      /OK.*2 numbered evidence items for 2 criteria/,
    );
  });
});
