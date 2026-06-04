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
import type { TrajectoryDiagnosticsArtifact } from "#core/agent-harness/index.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import trajectoryDiagnosticEscalator from "./workflow.js";

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
  const dir = mkdtempSync(join(tmpdir(), "trajectory-diagnostic-workflow-"));
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

function diagnosticArtifact(): TrajectoryDiagnosticsArtifact {
  return {
    version: 1,
    status: "supported",
    emitsAgentMessageStream: true,
    counts: {
      warningCount: 1,
      unsupportedTrajectoryCount: 0,
      missingStreamingFramesCount: 0,
      missingFinalVerificationAfterEditCount: 1,
      repeatedIdenticalFailingCommandCount: 0,
      editAfterSuccessfulVerificationCount: 0,
      longPreambleWithoutTaskTouchCount: 0,
    },
    diagnostics: [
      {
        code: "missing_final_verification_after_edit",
        severity: "warning",
        summary:
          "A file-editing action was not followed by a verification-like command.",
        frameIndexes: [8],
        details: ["lastEditFrame=8", "lastEditTool=apply_patch"],
      },
    ],
  };
}

function unsupportedDiagnosticArtifact(): TrajectoryDiagnosticsArtifact {
  return {
    version: 1,
    status: "unsupported",
    emitsAgentMessageStream: false,
    counts: {
      warningCount: 1,
      unsupportedTrajectoryCount: 1,
      missingStreamingFramesCount: 0,
      missingFinalVerificationAfterEditCount: 0,
      repeatedIdenticalFailingCommandCount: 0,
      editAfterSuccessfulVerificationCount: 0,
      longPreambleWithoutTaskTouchCount: 0,
    },
    diagnostics: [
      {
        code: "unsupported_trajectory",
        severity: "warning",
        summary:
          "Harness does not emit KOTA-native message frames, so trajectory-quality checks are unsupported.",
        frameIndexes: [],
        details: ["capability.emitsAgentMessageStream=false"],
      },
    ],
  };
}

function seedRun(
  projectDir: string,
  id: string,
  hoursAgo: number,
  artifact = diagnosticArtifact(),
): void {
  const completedAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  const metadata: WorkflowRunMetadata = {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "workflow.completed", schemaRef: null, payload: {} },
    startedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000 - 1000).toISOString(),
    completedAt,
    status: "success",
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [
      {
        id: "build",
        type: "agent",
        status: "success",
        startedAt: completedAt,
        completedAt,
        durationMs: 1000,
      },
    ],
  };
  const runDir = join(projectDir, ".kota", "runs", id);
  const stepsDir = join(runDir, "steps");
  mkdirSync(stepsDir, { recursive: true });
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  writeFileSync(
    join(stepsDir, "build.trajectory-diagnostics.json"),
    JSON.stringify(artifact, null, 2),
  );
}

describe("trajectory-diagnostic-escalator workflow", () => {
  let projectDir: string;
  const originalThreshold = process.env.KOTA_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS;

  beforeEach(async () => {
    vi.clearAllMocks();
    await mockCleanWorktree();
    projectDir = makeProjectDir();
    process.env.KOTA_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS = "3";
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (originalThreshold === undefined) {
      delete process.env.KOTA_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS;
    } else {
      process.env.KOTA_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS = originalThreshold;
    }
  });

  it("registers on monitored workflow completion and recovery without tagging itself as monitored", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/trajectory-diagnostic-escalator/workflow.ts",
      trajectoryDiagnosticEscalator,
    );
    expect(registered.name).toBe("trajectory-diagnostic-escalator");
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
    seedRun(projectDir, "2026-05-29T09-00-00-000Z-builder-a", 3);
    seedRun(projectDir, "2026-05-29T10-00-00-000Z-builder-b", 2);
    seedRun(projectDir, "2026-05-29T11-00-00-000Z-builder-c", 1);

    const harness = new WorkflowTestHarness(trajectoryDiagnosticEscalator, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        schemaRef: null, payload: { workflow: "builder", tags: ["monitored"] },
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
    expect(taskContent).toContain("missing_final_verification_after_edit");
    expect(taskContent).toContain("steps/build.trajectory-diagnostics.json");

    const artifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "harness",
      "trajectory-diagnostic-escalation.json",
    );
    expect(existsSync(artifactPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(artifact.applied[0].kind).toBe("created");

    const attentionEvents = result.emitted.filter(
      (event) => event.event === "workflow.attention.digest",
    );
    expect(attentionEvents).toHaveLength(1);
    const attentionJson = JSON.stringify(attentionEvents[0].payload);
    expect(attentionJson).toContain("Trajectory diagnostic escalated");
    expect(attentionJson).toContain("task-repair-trajectory-diagnostic-pattern");
    expect(attentionJson).not.toMatch(/cost|throughput/i);
  });

  it("does not open repair work for repeated unsupported harness artifacts", async () => {
    const artifact = unsupportedDiagnosticArtifact();
    seedRun(projectDir, "2026-05-29T09-00-00-000Z-builder-unsupported-a", 3, artifact);
    seedRun(projectDir, "2026-05-29T10-00-00-000Z-builder-unsupported-b", 2, artifact);
    seedRun(projectDir, "2026-05-29T11-00-00-000Z-builder-unsupported-c", 1, artifact);

    const harness = new WorkflowTestHarness(trajectoryDiagnosticEscalator, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        schemaRef: null, payload: { workflow: "builder", tags: ["monitored"] },
      },
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-patterns"].output).toMatchObject({
      status: "none",
      patterns: [],
    });
    expect(result.steps["write-artifact"].status).toBe("skipped");
    expect(result.steps["emit-attention"].status).toBe("skipped");
    const readyDir = join(projectDir, "data", "tasks", "ready");
    const readyTasks = execFileSync("find", [readyDir, "-name", "*.md"], {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(readyTasks).toEqual([]);
  });

  it("skips detection and mutation on recovery triggers after the reset step", async () => {
    const harness = new WorkflowTestHarness(trajectoryDiagnosticEscalator, {
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
