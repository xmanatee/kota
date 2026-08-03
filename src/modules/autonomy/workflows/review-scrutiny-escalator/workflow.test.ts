import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import reviewScrutinyEscalator from "./workflow.js";
import {
  listReadyTaskPaths,
  makeProjectDir,
  mockCleanWorktree,
  NOW,
  readJsonFile,
  readTextFile,
  seedCriticRun,
  seedWarningBackedCriticRun,
  writeTask,
} from "./workflow.test-helpers.js";

vi.mock("#core/util/repo-worktree.js", async () => {
  const actual = await vi.importActual<typeof import("#core/util/repo-worktree.js")>(
    "#core/util/repo-worktree.js",
  );
  return {
    ...actual,
    getRepoWorktreeStatus: vi.fn(),
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
      committedPaths: ["data/tasks/ready/task-review.md"],
      daemonRestartRequired: false,
    })),
    checkCommitStageable: vi.fn(() => "ok"),
  };
});

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

describe("review-scrutiny-escalator workflow", () => {
  let projectDir: string;
  const originalMinApprovals = process.env.KOTA_REVIEW_SCRUTINY_MIN_APPROVALS;
  const originalMinThin = process.env.KOTA_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES;
  const originalMinRatio = process.env.KOTA_REVIEW_SCRUTINY_MIN_RATIO;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    await mockCleanWorktree();
    projectDir = makeProjectDir();
    writeTask(projectDir, "task-reviewed");
    process.env.KOTA_REVIEW_SCRUTINY_MIN_APPROVALS = "3";
    process.env.KOTA_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES = "3";
    process.env.KOTA_REVIEW_SCRUTINY_MIN_RATIO = "0.75";
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(projectDir, { recursive: true, force: true });
    if (originalMinApprovals === undefined) delete process.env.KOTA_REVIEW_SCRUTINY_MIN_APPROVALS;
    else process.env.KOTA_REVIEW_SCRUTINY_MIN_APPROVALS = originalMinApprovals;
    if (originalMinThin === undefined) delete process.env.KOTA_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES;
    else process.env.KOTA_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES = originalMinThin;
    if (originalMinRatio === undefined) delete process.env.KOTA_REVIEW_SCRUTINY_MIN_RATIO;
    else process.env.KOTA_REVIEW_SCRUTINY_MIN_RATIO = originalMinRatio;
  });

  it("registers on monitored workflow completion and recovery without tagging itself as monitored", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.ts",
      reviewScrutinyEscalator,
    );
    expect(registered.name).toBe("review-scrutiny-escalator");
    expect(registered.recoveryCapable).toBe(true);
    expect(registered.tags ?? []).not.toContain("monitored");
    expect(registered.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "workflow.completed",
          filter: { tags: ["monitored"] },
        }),
        expect.objectContaining({ event: "runtime.recovered" }),
      ]),
    );
  });

  it("opens one repair task, writes an artifact, and emits attention without cost fields", async () => {
    seedCriticRun(projectDir, "2026-06-23T11-57-00-000Z-builder-a", 3, "task-reviewed");
    seedCriticRun(projectDir, "2026-06-23T11-58-00-000Z-builder-b", 2, "task-reviewed");
    seedCriticRun(projectDir, "2026-06-23T11-59-00-000Z-builder-c", 1, "task-reviewed");

    const harness = new WorkflowTestHarness(reviewScrutinyEscalator, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: { workflow: "builder", tags: ["monitored"] },
      },
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    const readyTasks = listReadyTaskPaths(projectDir);
    expect(readyTasks).toHaveLength(1);
    const task = readTextFile(readyTasks[0]);
    expect(task).toContain("status: ready");
    expect(task).toContain("review-scrutiny-pattern-fingerprint");
    expect(task).toContain("## Product / Safety Link");

    const artifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "harness",
      "review-scrutiny-escalation.json",
    );
    const artifact = readJsonFile<{ applied: { kind: string }[] }>(artifactPath);
    expect(artifact.applied[0].kind).toBe("created");

    const attentionEvents = result.emitted.filter(
      (event) => event.event === "workflow.attention.digest",
    );
    expect(attentionEvents).toHaveLength(1);
    const attentionJson = JSON.stringify(attentionEvents[0].payload);
    expect(attentionJson).toContain("Review scrutiny escalated");
    expect(attentionJson).toContain("task-repair-review-scrutiny-pattern");
    expect(attentionJson).not.toMatch(/cost|throughput/i);
  });

  it("does not escalate fresh warning-backed no-citation critic acceptances", async () => {
    writeTask(projectDir, "task-modules-platform", {
      area: "modules",
      taskClass: "Platform",
    });
    seedWarningBackedCriticRun(
      projectDir,
      "2026-06-23T11-57-00-000Z-builder-a",
      3,
      "task-modules-platform",
    );
    seedWarningBackedCriticRun(
      projectDir,
      "2026-06-23T11-58-00-000Z-builder-b",
      2,
      "task-modules-platform",
    );
    seedWarningBackedCriticRun(
      projectDir,
      "2026-06-23T11-59-00-000Z-builder-c",
      1,
      "task-modules-platform",
    );

    const harness = new WorkflowTestHarness(reviewScrutinyEscalator, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: { workflow: "builder", tags: ["monitored"] },
      },
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-patterns"].output).toMatchObject({
      status: "none",
      detection: { patterns: [] },
    });
    expect(result.steps["emit-attention"].status).toBe("skipped");
    expect(listReadyTaskPaths(projectDir)).toEqual([]);
  });

  it("writes a no-op artifact for below-threshold windows without creating tasks", async () => {
    seedCriticRun(projectDir, "2026-06-23T11-59-00-000Z-builder-a", 1, "task-reviewed");

    const harness = new WorkflowTestHarness(reviewScrutinyEscalator, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: { workflow: "builder", tags: ["monitored"] },
      },
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-patterns"].output).toMatchObject({
      status: "none",
    });
    expect(result.steps["emit-attention"].status).toBe("skipped");
    expect(listReadyTaskPaths(projectDir)).toEqual([]);
    const artifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "harness",
      "review-scrutiny-escalation.json",
    );
    const artifact = readJsonFile<{ detection: { belowThreshold: unknown[] } }>(
      artifactPath,
    );
    expect(artifact.detection.belowThreshold).toHaveLength(1);
  });

  it("skips detection and mutation on recovery triggers after the reset step", async () => {
    const harness = new WorkflowTestHarness(reviewScrutinyEscalator, {
      projectDir,
      trigger: { event: "runtime.recovered", schemaRef: null, payload: {} },
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-patterns"].status).toBe("skipped");
    expect(result.steps["apply-tasks"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });
});
