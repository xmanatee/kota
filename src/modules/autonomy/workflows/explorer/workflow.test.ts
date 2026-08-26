import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import {
  EXPLORER_STATE_KEY,
  type ExplorerState,
} from "./explorer-state.js";
import {
  checkWatchlistUpdatesCommitMessage,
  WATCHLIST_UPDATES_FILE,
} from "./watchlist-updates.js";
import explorerWorkflow, { EXPLORATION_REFRESH_MS } from "./workflow.js";

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
}));

vi.mock("#modules/repo-tasks/repo-tasks-domain.js", () => ({
  countRepoPromotableBacklogTasks: vi.fn(() => 0),
  getRepoTaskQueueSnapshot: vi.fn(),
  isRepoTaskQueueSnapshot: vi.fn(() => true),
  isThinDispatchableQueue: vi.fn((snapshot, promotableBacklogCount) => {
    const backlogCount =
      promotableBacklogCount ?? snapshot.promotableBacklogCount ?? 0;
    const waitingCount =
      snapshot.counts.ready + snapshot.counts.doing + backlogCount;
    return (
      snapshot.inboxCount === 0 &&
      waitingCount <= 2 &&
      waitingCount > 0
    );
  }),
  REPO_TASK_STATES: ["backlog", "ready", "doing", "blocked", "done", "dropped"],
  listFullRepoTasks: vi.fn(() => []),
  getRepoTaskStateDir: vi.fn((projectDir: string, state: string) =>
    `${projectDir}/data/tasks/${state}`,
  ),
}));

vi.mock("#modules/repo-tasks/task-queue-validation.js", () => ({
  assertTaskQueueValid: vi.fn(),
}));

function makeSnapshot({
  inboxCount = 0,
  ready = 0,
  backlog = 0,
  doing = 0,
  blocked = 0,
  done = 0,
  dropped = 0,
  promotableBacklogCount,
}: {
  inboxCount?: number;
  ready?: number;
  backlog?: number;
  doing?: number;
  blocked?: number;
  done?: number;
  dropped?: number;
  promotableBacklogCount?: number;
} = {}) {
  const effectivePromotableBacklogCount = promotableBacklogCount ?? backlog;
  const counts = { backlog, ready, doing, blocked, done, dropped };
  const actionableCount = ready + doing;
  const dispatchableCount =
    inboxCount + actionableCount + effectivePromotableBacklogCount;
  return {
    counts,
    inboxCount,
    openCount: inboxCount + backlog + ready + doing + blocked,
    pullableCount: backlog + ready + doing,
    actionableCount,
    promotableBacklogCount: effectivePromotableBacklogCount,
    dispatchableCount,
    hasDispatchableWork: dispatchableCount > 0,
    dependencyBlockedTasks: [],
    headSha: "abc1234",
  };
}

function stateWithLastExplorationAt(lastExplorationAt: string) {
  const state = createTestTransactionalRunState();
  state.compareAndSet(EXPLORER_STATE_KEY, 0, { lastExplorationAt });
  return state;
}

describe("explorer workflow", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "explorer-test-"));
    mkdirSync(join(tempDir, ".kota"), { recursive: true });
  });

  it("skips explore when inbox is non-empty", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 1, ready: 0, backlog: 0 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      inboxCount: 1,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("exposes canonicalized watchlist history without stale aliases as entries", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 1, ready: 0, backlog: 0 }),
    );
    mkdirSync(join(tempDir, "data"), { recursive: true });
    writeFileSync(
      join(tempDir, "data", "watchlist.yaml"),
      [
        "resources:",
        "  - url: https://github.com/FoundationAgents/OpenManus",
        '    added: "2026-04-20"',
        "    canonicalized_from:",
        "      - https://github.com/mannaandpoem/OpenManus",
        "    snapshot:",
        "      fingerprint: sha256:canonical",
        '      summary: "Canonical OpenManus project."',
        '      last_seen_at: "2026-05-18T00:00:00.000Z"',
        "",
      ].join("\n"),
      "utf-8",
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();
    expect(result.steps["inspect-watchlist"].output).toMatchObject({
      entries: [
        {
          url: "https://github.com/FoundationAgents/OpenManus",
          canonicalizedFrom: ["https://github.com/mannaandpoem/OpenManus"],
          status: "seen",
        },
      ],
    });
  });

  it("skips explore when ready or backlog already contains work", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 1, backlog: 2 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("runs explore when open backlog is parked but no task is dispatchable", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({
        inboxCount: 0,
        ready: 0,
        backlog: 5,
        doing: 0,
        promotableBacklogCount: 0,
      }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      pullableCount: 5,
      dispatchableCount: 0,
      hasDispatchableWork: false,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("runs explore when only a one-item backlog tail remains and refresh is due", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 0, backlog: 1, doing: 0 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      pullableCount: 1,
      actionableCount: 0,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("runs explore when a single ready task remains and refresh is due", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 1, backlog: 0, doing: 0 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      pullableCount: 1,
      actionableCount: 1,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("explores when only active doing work remains", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 0, backlog: 0, doing: 1 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("skips explore when the queue is empty but the refresh window is not due", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const state = stateWithLastExplorationAt(new Date().toISOString());

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
      contextOverrides: { state },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: false,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("runs explore when the queue is empty and refresh is due", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    // An absent runtime state row means refresh is due.
    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("does not write lastExplorationAt when explore step is skipped", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const state = stateWithLastExplorationAt(new Date().toISOString());
    const before = state.read<ExplorerState>(EXPLORER_STATE_KEY);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
      contextOverrides: { state },
    });
    await harness.run();

    expect(state.read<ExplorerState>(EXPLORER_STATE_KEY)).toEqual(before);
  });

  it("skips explore when worktree is dirty", async () => {
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
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      dirty: true,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("trigger cooldowns match the exploration refresh window to prevent no-op churn", () => {
    for (const trigger of explorerWorkflow.triggers) {
      expect(trigger.cooldownMs).toBe(EXPLORATION_REFRESH_MS);
    }
  });

  it("does not starve exploration when skipped runs repeatedly complete", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    // A skipped completion must not replace the last successfully published
    // exploration timestamp used for refresh cadence.
    const thirtyFiveMinutesAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    const state = stateWithLastExplorationAt(thirtyFiveMinutesAgo);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: {
        workflows: {
          // Recent completion (2 min ago) from a skipped run — this would
          // have blocked refresh under the old logic
          explorer: {
            lastCompletion: {
              runId: "run-explorer-skipped",
              startedAt: new Date(Date.now() - 2 * 60 * 1000 - 10_000).toISOString(),
              completedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
              status: "success",
            },
          },
        },
      },
      stepMocks: { explore: { turns: [], totalCostUsd: 0.02 } },
      projectDir: tempDir,
      contextOverrides: { state },
    });

    const result = await harness.run();

    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });
});



describe("explorer repair checks", () => {
  it("runs task validation through the supervised command rail", async () => {
    const exploreStep = explorerWorkflow.steps.find(
      (step): step is WorkflowAgentStepInput =>
        "id" in step && step.id === "explore" && step.type === "agent",
    );
    if (!exploreStep?.repairLoop) throw new Error("explore step missing");
    const queueValid = exploreStep.repairLoop.checks.find(
      (check) => check.id === "task-queue-valid",
    );
    if (!queueValid || queueValid.type !== "code") {
      throw new Error("task-queue-valid missing");
    }
    const projectDir = mkdtempSync(join(tmpdir(), "explorer-validation-"));
    const runCommand = vi.fn(successfulWorkflowCommandRun);

    await queueValid.run(
      { projectDir, runCommand } as unknown as WorkflowStepContext,
      {} as never,
    );

    expect(runCommand).toHaveBeenCalledWith({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: projectDir,
    });
  });
});

describe("explorer watchlist update commit-message repair check", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "explorer-watchlist-run-"));
  });

  it("allows no-op runs without planned watchlist updates to omit a commit message", () => {
    expect(checkWatchlistUpdatesCommitMessage(runDir)).toBe(
      "OK: no watchlist updates — commit message not required",
    );
  });

  it("rejects planned watchlist updates without a commit message", () => {
    writeFileSync(
      join(runDir, WATCHLIST_UPDATES_FILE),
      JSON.stringify({
        updates: [{ url: "https://example.test/watch", accessible: false }],
      }),
    );

    expect(() => checkWatchlistUpdatesCommitMessage(runDir)).toThrow(
      /commit-message\.txt is required before apply-watchlist-updates/,
    );
  });

  it("accepts planned watchlist updates when the run has a commit message", () => {
    writeFileSync(
      join(runDir, WATCHLIST_UPDATES_FILE),
      JSON.stringify({
        updates: [{ url: "https://example.test/watch", accessible: false }],
      }),
    );
    writeFileSync(join(runDir, "commit-message.txt"), "Explorer: refresh watchlist");

    expect(checkWatchlistUpdatesCommitMessage(runDir)).toBe(
      "OK: commit-message.txt present for 1 watchlist update(s)",
    );
  });

  it("wires the watchlist commit-message check into the explore repair loop", () => {
    const exploreStep = explorerWorkflow.steps.find(
      (step): step is WorkflowAgentStepInput =>
        "id" in step && step.id === "explore" && step.type === "agent",
    );
    if (!exploreStep || !exploreStep.repairLoop) throw new Error("explore step missing");

    const checkIds = exploreStep.repairLoop.checks.map((check) => check.id);
    expect(checkIds).toContain("watchlist-update-commit-message");
  });
});
