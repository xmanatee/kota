import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import workflowFailureEscalator from "./workflow.js";

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

const NOW = Date.parse("2026-05-29T12:00:00.000Z");

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
  const dir = mkdtempSync(join(tmpdir(), "workflow-failure-workflow-"));
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

function seedFailedRun(
  projectDir: string,
  id: string,
  hoursAgo: number,
): void {
  const completedAt = new Date(NOW - hoursAgo * 60 * 60 * 1000).toISOString();
  const metadata: WorkflowRunMetadata = {
    id,
    workflow: "decomposer",
    definitionPath: "src/modules/autonomy/workflows/decomposer/workflow.ts",
    trigger: { event: "workflow.completed", schemaRef: null, payload: {} },
    startedAt: new Date(NOW - hoursAgo * 60 * 60 * 1000 - 1000).toISOString(),
    completedAt,
    status: "failed",
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [
      {
        id: "decompose",
        type: "agent",
        status: "failed",
        startedAt: completedAt,
        completedAt,
        durationMs: 1000,
        output: {
          repairIterations: [
            {
              failures: [{ id: "task-queue-valid" }],
            },
          ],
        },
      },
    ],
  };
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
}

describe("workflow-failure-escalator workflow", () => {
  let projectDir: string;
  const originalConsecutive = process.env.KOTA_WORKFLOW_FAILURE_CONSECUTIVE_RUNS;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    await mockCleanWorktree();
    projectDir = makeProjectDir();
    process.env.KOTA_WORKFLOW_FAILURE_CONSECUTIVE_RUNS = "3";
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(projectDir, { recursive: true, force: true });
    if (originalConsecutive === undefined) {
      delete process.env.KOTA_WORKFLOW_FAILURE_CONSECUTIVE_RUNS;
    } else {
      process.env.KOTA_WORKFLOW_FAILURE_CONSECUTIVE_RUNS = originalConsecutive;
    }
  });

  it("registers on monitored workflow completion and recovery without tagging itself as monitored", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/workflow-failure-escalator/workflow.ts",
      workflowFailureEscalator,
    );
    expect(registered.name).toBe("workflow-failure-escalator");
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
    seedFailedRun(projectDir, "2026-05-29T09-00-00-000Z-decomposer-a", 3);
    seedFailedRun(projectDir, "2026-05-29T10-00-00-000Z-decomposer-b", 2);
    seedFailedRun(projectDir, "2026-05-29T11-00-00-000Z-decomposer-c", 1);

    const harness = new WorkflowTestHarness(workflowFailureEscalator, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        schemaRef: null, payload: { workflow: "decomposer", tags: ["monitored"] },
      },
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    const readyDir = join(projectDir, "data", "tasks", "ready");
    const readyTasks = execFileSync("find", [readyDir, "-name", "*.md"], {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(readyTasks).toHaveLength(1);
    const taskContent = readFileSync(readyTasks[0], "utf-8");
    expect(taskContent).toContain("status: ready");
    expect(taskContent).toContain("task-queue-valid");
    expect(taskContent).toContain("2026-05-29T09-00-00-000Z-decomposer-a");

    const artifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "harness",
      "workflow-failure-escalation.json",
    );
    expect(existsSync(artifactPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(artifact.applied[0].kind).toBe("created");

    const attentionEvents = result.emitted.filter(
      (event) => event.event === "workflow.attention.digest",
    );
    expect(attentionEvents).toHaveLength(1);
    const attentionJson = JSON.stringify(attentionEvents[0].payload);
    expect(attentionJson).toContain("Workflow failure escalated");
    expect(attentionJson).toContain("task-repair-workflow-failure-pattern");
    expect(attentionJson).not.toMatch(/cost|throughput/i);
  });

  it("skips detection and mutation on recovery triggers after the reset step", async () => {
    const harness = new WorkflowTestHarness(workflowFailureEscalator, {
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
