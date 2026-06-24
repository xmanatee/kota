import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import reviewScrutinyEscalator from "./workflow.js";

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
    commitWorkflowChanges: vi.fn(() => ({ committed: true })),
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

const NOW = Date.parse("2026-06-23T12:00:00.000Z");

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

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "review-scrutiny-workflow-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial", "--quiet"], {
    cwd: dir,
  });
  return dir;
}

function writeTask(
  projectDir: string,
  id: string,
  options: { area?: string; taskClass?: string } = {},
): void {
  const updatedAt = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
  writeFileSync(
    join(projectDir, "data", "tasks", "done", `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `title: ${id}`,
      "status: done",
      "priority: p2",
      `area: ${options.area ?? "autonomy"}`,
      `task_class: ${options.taskClass ?? "Meta"}`,
      "summary: test",
      `created_at: ${updatedAt}`,
      `updated_at: ${updatedAt}`,
      "---",
      "",
      "## Problem",
      "",
      "Test task.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function seedCriticRun(projectDir: string, id: string, minutesAgo: number, taskId: string): void {
  const completedAt = new Date(NOW - minutesAgo * 60 * 1000).toISOString();
  const metadata: WorkflowRunMetadata = {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "workflow.completed", schemaRef: null, payload: {} },
    startedAt: new Date(NOW - minutesAgo * 60 * 1000 - 1000).toISOString(),
    completedAt,
    status: "success",
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [],
  };
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  writeFileSync(
    join(runDir, "run-summary.json"),
    JSON.stringify({ taskId }, null, 2),
  );
  writeFileSync(
    join(runDir, "critic-review.json"),
    JSON.stringify({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Accepted.",
      reviewerPromptHash: getCriticPromptHash(),
    }, null, 2),
  );
}

function seedWarningBackedCriticRun(
  projectDir: string,
  id: string,
  minutesAgo: number,
  taskId: string,
): void {
  const completedAt = new Date(NOW - minutesAgo * 60 * 1000).toISOString();
  const metadata: WorkflowRunMetadata = {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "workflow.completed", schemaRef: null, payload: {} },
    startedAt: new Date(NOW - minutesAgo * 60 * 1000 - 1000).toISOString(),
    completedAt,
    status: "success",
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [],
  };
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  writeFileSync(
    join(runDir, "run-summary.json"),
    JSON.stringify({ taskId }, null, 2),
  );
  writeFileSync(
    join(runDir, "critic-review.json"),
    JSON.stringify({
      verdict: "pass_with_warnings",
      critical_issues: [],
      warnings: [
        "Accepted reviewer verdict omitted warnings, critical issues, and file-line citations; review-scrutiny recorded this reviewer-evidence gap.",
      ],
      summary: "Accepted.",
      reviewerPromptHash: getCriticPromptHash(),
    }, null, 2),
  );
}

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
    const readyTasks = execFileSync(
      "find",
      [join(projectDir, "data", "tasks", "ready"), "-name", "*.md"],
      { encoding: "utf-8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(readyTasks).toHaveLength(1);
    const task = readFileSync(readyTasks[0], "utf-8");
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
    expect(existsSync(artifactPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
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
    const readyTasks = execFileSync(
      "find",
      [join(projectDir, "data", "tasks", "ready"), "-name", "*.md"],
      { encoding: "utf-8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(readyTasks).toEqual([]);
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
    const readyTasks = execFileSync(
      "find",
      [join(projectDir, "data", "tasks", "ready"), "-name", "*.md"],
      { encoding: "utf-8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(readyTasks).toEqual([]);
    const artifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "harness",
      "review-scrutiny-escalation.json",
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
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
