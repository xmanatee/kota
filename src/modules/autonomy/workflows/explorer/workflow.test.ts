import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { EXPLORATION_RATIONALE_FILENAME } from "./exploration-rationale.js";
import { readLastExplorationAt, writeLastExplorationAt } from "./explorer-state.js";
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
  getRepoTaskQueueSnapshot: vi.fn(),
  isRepoTaskQueueSnapshot: vi.fn(() => true),
  isThinPullQueue: vi.fn((snapshot) => {
    const waitingCount = snapshot.counts.ready + snapshot.counts.backlog;
    return snapshot.inboxCount === 0 && waitingCount > 0 && waitingCount <= 2;
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
} = {}) {
  const counts = { backlog, ready, doing, blocked, done, dropped };
  return {
    counts,
    inboxCount,
    openCount: inboxCount + backlog + ready + doing + blocked,
    pullableCount: backlog + ready + doing,
    actionableCount: ready + doing,
    dependencyBlockedTasks: [],
    headSha: "abc1234",
  };
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

  it("runs explore when only a one-item backlog tail remains and refresh is due", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 0, backlog: 1, doing: 0 }),
    );

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

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

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

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

  it("skips explore when doing already contains work", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 0, backlog: 0, doing: 1 }),
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

  it("skips explore when the queue is empty but the refresh window is not due", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    // Write a recent exploration timestamp
    writeLastExplorationAt(tempDir);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
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

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    // No exploration state file → refresh is due
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
    expect(result.steps.commit.status).toBe("success");
  });

  it("writes lastExplorationAt only when explore step runs", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    // No state file → refresh is due, explore will run
    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepMocks: { explore: { turns: [], totalCostUsd: 0.02 } },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    expect(readLastExplorationAt(tempDir)).toBeUndefined();
    await harness.run();
    expect(readLastExplorationAt(tempDir)).toBeDefined();
  });

  it("does not write lastExplorationAt when explore step is skipped", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    // Write recent exploration → refresh not due, explore will skip
    writeLastExplorationAt(tempDir);
    const before = readLastExplorationAt(tempDir);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });
    await harness.run();

    // Timestamp unchanged — no new write happened
    expect(readLastExplorationAt(tempDir)).toBe(before);
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

  it("surfaces strategicReadyCoverageGap=true so the agent can plan before repair trips", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 1, backlog: 0 }),
    );
    const { hasStrategicReadyCoverageGap } = await import(
      "#modules/repo-tasks/task-queue-validation.js"
    );
    vi.mocked(hasStrategicReadyCoverageGap).mockReturnValue(true);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepMocks: { explore: { turns: [], totalCostUsd: 0.02 } },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.steps["inspect-queue"].output).toMatchObject({
      strategicReadyCoverageGap: true,
      needsAttention: true,
    });
  });

  it("trigger cooldowns match the exploration refresh window to prevent no-op churn", () => {
    for (const trigger of explorerWorkflow.triggers) {
      // runtime.recovered is a crash-recovery path; the runtime dispatches it
      // at most once per recovery event so it does not need a cooldown.
      if (trigger.event === "runtime.recovered") continue;
      expect(trigger.cooldownMs).toBe(EXPLORATION_REFRESH_MS);
    }
  });

  it("does not starve exploration when skipped runs repeatedly complete", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    // Simulate: last real exploration was 35 minutes ago.
    // Under the old logic, repeated skipped workflow completions would keep
    // resetting lastCompletedAt, preventing explorationRefreshDue from ever
    // becoming true. With the new logic, the refresh is measured from the
    // file-based lastExplorationAt, which only updates on real explorations.
    const thirtyFiveMinutesAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(tempDir, ".kota", "explorer-state.json"),
      JSON.stringify({ lastExplorationAt: thirtyFiveMinutesAgo }),
      "utf-8",
    );

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
    });

    const result = await harness.run();

    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });
});

describe("explorer exploration-rationale repair check", () => {
  let projectDir: string;
  let runDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    projectDir = mkdtempSync(join(tmpdir(), "explorer-rationale-check-"));
    for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
      mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
    }
    execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
    runDir = mkdtempSync(join(tmpdir(), "explorer-rationale-run-"));
  });

  function findExplorationRationaleCheck() {
    const exploreStep = explorerWorkflow.steps.find(
      (step): step is WorkflowAgentStepInput =>
        "id" in step && step.id === "explore" && step.type === "agent",
    );
    if (!exploreStep || !exploreStep.repairLoop) {
      throw new Error("explore agent step or its repairLoop is missing");
    }
    const check = exploreStep.repairLoop.checks.find(
      (entry) => entry.id === "exploration-rationale",
    );
    if (!check || check.type !== "code") {
      throw new Error("exploration-rationale code check not found");
    }
    return check;
  }

  function makeAssessment(actionableCount: number) {
    return {
      counts: { backlog: 0, ready: actionableCount, doing: 0, blocked: 1, done: 0, dropped: 0 },
      inboxCount: 0,
      openCount: 1 + actionableCount,
      pullableCount: actionableCount,
      actionableCount,
      dirty: false,
      needsAttention: actionableCount === 0,
      explorationRefreshDue: true,
      strategicReadyCoverageGap: false,
      strategicBlockedAlternatives: [],
    };
  }

  function makeCtx(actionableCount: number): WorkflowStepContext {
    return {
      projectDir,
      workflow: { runDirPath: runDir, runId: "test-run", workflowName: "explorer" },
      trigger: { event: "autonomy.queue.empty", payload: {} },
      previousOutput: undefined,
      stepOutputs: { "inspect-queue": makeAssessment(actionableCount) },
      stepResults: {},
      stepOutputList: [],
      runTool: vi.fn(),
      emit: vi.fn(),
      requestRestart: vi.fn(),
      readPrompt: vi.fn(() => ""),
      readRuntimeState: vi.fn(() => ({ workflows: {} })),
      triggerWorkflow: vi.fn(),
    } as unknown as WorkflowStepContext;
  }

  function writeStrategicBlockedAlternative(opts: { resolved: boolean }) {
    const id = "task-strategic-block";
    const resolvedMarker = opts.resolved
      ? "\n<!-- blocked-promoter-resolved: slot=arch resolved_at=2026-05-08T05:00:00.000Z -->\n"
      : "";
    const body =
      "## Problem\n\nA strategic architecture problem.\n\n" +
      "## Unblock Precondition\n\nkind: owner-decision\nslot: arch\nquestion: Approve the new wire?\n" +
      resolvedMarker;
    const file = [
      "---",
      `id: ${id}`,
      "title: Distribute KotaClient namespace types and daemon-side wire",
      "status: blocked",
      "priority: p1",
      "area: architecture",
      "summary: A strategic architecture problem requiring a daemon-side wire.",
      "created_at: 2026-04-01T00:00:00.000Z",
      "updated_at: 2026-04-01T00:00:00.000Z",
      "---",
      "",
      body,
    ].join("\n");
    writeFileSync(join(projectDir, "data", "tasks", "blocked", `${id}.md`), file);
    return { id, body };
  }

  it("accepts a noop rationale when no movable strategic alternative exists", async () => {
    const { listFullRepoTasks } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    const blocked = writeStrategicBlockedAlternative({ resolved: false });
    vi.mocked(listFullRepoTasks).mockReturnValue([
      {
        id: blocked.id,
        title: "Distribute KotaClient namespace types and daemon-side wire",
        state: "blocked",
        priority: "p1",
        area: "architecture",
        summary: "A strategic architecture problem requiring a daemon-side wire.",
        updatedAt: "2026-04-01T00:00:00.000Z",
        body: blocked.body,
        dependsOn: [],
        anchor: false,
      },
    ]);

    writeFileSync(
      join(runDir, EXPLORATION_RATIONALE_FILENAME),
      JSON.stringify({
        decision: "noop",
        summary: "Every strategic blocked alternative is gated on owner approval; queue is paused.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      }),
    );

    const check = findExplorationRationaleCheck();
    if (check.type !== "code") throw new Error("expected code check");
    const result = await check.run(makeCtx(0), {} as never);
    expect(result).toContain("decision=noop");
  });

  it("rejects a noop rationale when a movable strategic alternative is uncited", async () => {
    const { listFullRepoTasks } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    const blocked = writeStrategicBlockedAlternative({ resolved: true });
    vi.mocked(listFullRepoTasks).mockReturnValue([
      {
        id: blocked.id,
        title: "Distribute KotaClient namespace types and daemon-side wire",
        state: "blocked",
        priority: "p1",
        area: "architecture",
        summary: "A strategic architecture problem requiring a daemon-side wire.",
        updatedAt: "2026-04-01T00:00:00.000Z",
        body: blocked.body,
        dependsOn: [],
        anchor: false,
      },
    ]);

    writeFileSync(
      join(runDir, EXPLORATION_RATIONALE_FILENAME),
      JSON.stringify({
        decision: "noop",
        summary: "Queue looked quiet so I left things alone without addressing the resolved block.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      }),
    );

    const check = findExplorationRationaleCheck();
    if (check.type !== "code") throw new Error("expected code check");
    expect(() => check.run(makeCtx(0), {} as never)).toThrow(
      /movable strategic-area blocked alternative uncited/,
    );
  });

  it("does not pass --min-ready 1 to validate-tasks anymore", () => {
    const exploreStep = explorerWorkflow.steps.find(
      (step): step is WorkflowAgentStepInput =>
        "id" in step && step.id === "explore" && step.type === "agent",
    );
    if (!exploreStep || !exploreStep.repairLoop) throw new Error("explore step missing");
    const queueValid = exploreStep.repairLoop.checks.find((c) => c.id === "task-queue-valid");
    if (!queueValid || queueValid.type !== "code") throw new Error("task-queue-valid missing");
    const source = queueValid.run.toString();
    expect(source).not.toMatch(/--min-ready/);
    expect(source).toMatch(/validate-tasks/);
  });
});
