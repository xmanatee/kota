import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import explorerWorkflow from "./workflow.js";

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

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

vi.mock("#modules/repo-tasks/task-queue-validation.js", () => ({
  assertArchitectureReadyCoverage: vi.fn(),
  assertStrategicReadyCoverage: vi.fn(),
  hasStrategicReadyCoverageGap: vi.fn(() => false),
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

describe("explorer workflow queue gating", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "explorer-test-"));
    mkdirSync(join(tempDir, ".kota"), { recursive: true });
  });

  it("skips explore when inbox is non-empty", async () => {
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
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
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
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
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
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
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({
        inboxCount: 0,
        ready: 0,
        backlog: 5,
        doing: 0,
        promotableBacklogCount: 0,
      }),
    );

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({
      committed: true,
      committedPaths: ["src/change.ts"],
      daemonRestartRequired: true,
    } as never);

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
});
