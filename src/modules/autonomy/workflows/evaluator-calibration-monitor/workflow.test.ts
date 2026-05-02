import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { CALIBRATION_REPAIR_TASK_ID } from "#modules/autonomy/calibration-repair.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import evaluatorCalibrationMonitor from "./workflow.js";

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

async function mockDirtyWorktree() {
  const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
  vi.mocked(getRepoWorktreeStatus).mockReturnValue({
    available: true,
    dirty: true,
    trackedDirty: true,
    entries: ["M src/foo.ts"],
    fingerprint: "",
    summary: "src/foo.ts",
    headSha: "abc1234",
  });
}

type SeedOverrides = Partial<
  Pick<
    EvaluatorCalibrationArtifact,
    "verdict" | "sourceFilesChanged" | "finalIterationFailures" | "criticFailureCount"
  >
>;

function seedCalibration(
  runsDir: string,
  runId: string,
  completedAt: string,
  overrides: SeedOverrides,
): void {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const artifact: EvaluatorCalibrationArtifact = {
    runId,
    workflow: "builder",
    completedAt,
    verdict: overrides.verdict ?? "pass",
    warningCount: 0,
    criticalIssueCount: 0,
    repairIterations: 1,
    finalIterationFailures: overrides.finalIterationFailures ?? [],
    criticFailureCount: overrides.criticFailureCount ?? 0,
    terminalRunStatus: "success",
    taskId: null,
    taskFinalState: null,
    sourceFilesChanged: overrides.sourceFilesChanged ?? [],
  };
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify(artifact, null, 2),
  );
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cal-monitor-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  return dir;
}

function commitInitial(dir: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial", "--quiet"], {
    cwd: dir,
  });
}

const buildTrigger = {
  event: "workflow.build.committed",
  payload: {
    runId: "run-newer",
    taskId: null,
    commitMessage: "",
    costUsd: null,
    durationMs: null,
  },
} as const;

describe("evaluator-calibration-monitor workflow", () => {
  let projectDir: string;
  let runsDir: string;
  const originalThreshold = process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE;
  const originalMinSample = process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE;
  const originalPwwThreshold = process.env.KOTA_EVALUATOR_CALIBRATION_PWW_THRESHOLD_RATE;
  const originalPwwMinSample = process.env.KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE;

  beforeEach(async () => {
    vi.clearAllMocks();
    await mockCleanWorktree();
    projectDir = makeProjectDir();
    runsDir = join(projectDir, ".kota", "runs");
    process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE = "0.25";
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = "1";
    process.env.KOTA_EVALUATOR_CALIBRATION_PWW_THRESHOLD_RATE = "0.4";
    process.env.KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE = "1";
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    function restore(name: string, value: string | undefined): void {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    restore("KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE", originalThreshold);
    restore("KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE", originalMinSample);
    restore("KOTA_EVALUATOR_CALIBRATION_PWW_THRESHOLD_RATE", originalPwwThreshold);
    restore("KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE", originalPwwMinSample);
  });

  it("registers with the build-committed and recovery triggers", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/evaluator-calibration-monitor/workflow.ts",
      evaluatorCalibrationMonitor,
    );
    expect(registered.name).toBe("evaluator-calibration-monitor");
    expect(registered.recoveryCapable).toBe(true);
    const events = registered.triggers.map((t) => t.event);
    expect(events).toContain("workflow.build.committed");
    expect(events).toContain("runtime.recovered");
  });

  it("emits the regression event AND opens a calibration repair task when the gate fires for the first time", async () => {
    commitInitial(projectDir);
    const now = new Date();
    const hour = 60 * 60 * 1000;
    seedCalibration(runsDir, "run-older", new Date(now.getTime() - 5 * hour).toISOString(), {
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedCalibration(runsDir, "run-newer", new Date(now.getTime() - 1 * hour).toISOString(), {
      verdict: "fail",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: buildTrigger,
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(1);
    expect(regression[0].payload.driftKinds).toContain("pass-contradiction");
    expect(regression[0].payload.repairAction).toBe("created");

    const readyTaskPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      `${CALIBRATION_REPAIR_TASK_ID}.md`,
    );
    expect(existsSync(readyTaskPath)).toBe(true);
    const taskContent = readFileSync(readyTaskPath, "utf-8");
    expect(taskContent).toContain("status: ready");
    expect(taskContent).toContain("priority: p1");
    expect(taskContent).toContain("pass-contradiction");

    const calibrationArtifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "harness",
      "calibration-repair.json",
    );
    expect(existsSync(calibrationArtifactPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(calibrationArtifactPath, "utf-8"));
    expect(artifact.applied.kind).toBe("created");
    expect(artifact.driftKinds).toContain("pass-contradiction");
  });

  it("does not emit when the contradiction rate is under threshold", async () => {
    process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE = "0.9";
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = "2";
    process.env.KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE = "100";

    const now = new Date();
    const hour = 60 * 60 * 1000;
    seedCalibration(runsDir, "run-older", new Date(now.getTime() - 2 * hour).toISOString(), {
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedCalibration(runsDir, "run-newer", new Date(now.getTime() - 1 * hour).toISOString(), {
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: buildTrigger,
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(0);
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "ready", `${CALIBRATION_REPAIR_TASK_ID}.md`),
      ),
    ).toBe(false);
  });

  it("leaves an in-flight repair task alone (noop) when the gate fires again", async () => {
    const readyDir = join(projectDir, "data", "tasks", "ready");
    const existingPath = join(readyDir, `${CALIBRATION_REPAIR_TASK_ID}.md`);
    const existingBody = [
      "---",
      `id: ${CALIBRATION_REPAIR_TASK_ID}`,
      "title: Existing repair",
      "status: ready",
      "priority: p1",
      "area: autonomy",
      "summary: pre-existing",
      "created_at: 2026-04-01T00:00:00.000Z",
      "updated_at: 2026-04-01T00:00:00.000Z",
      "---",
      "",
      "## Problem",
      "",
      "preexisting body",
      "",
    ].join("\n");
    writeFileSync(existingPath, existingBody);
    commitInitial(projectDir);

    const now = new Date();
    const hour = 60 * 60 * 1000;
    seedCalibration(runsDir, "run-older", new Date(now.getTime() - 5 * hour).toISOString(), {
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedCalibration(runsDir, "run-newer", new Date(now.getTime() - 1 * hour).toISOString(), {
      verdict: "fail",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: buildTrigger,
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(1);
    expect(regression[0].payload.repairAction).toBe("noop");
    expect(readFileSync(existingPath, "utf-8")).toBe(existingBody);
  });

  it("recreates the repair task when a previous one is in done/", async () => {
    const doneDir = join(projectDir, "data", "tasks", "done");
    const donePath = join(doneDir, `${CALIBRATION_REPAIR_TASK_ID}.md`);
    writeFileSync(
      donePath,
      [
        "---",
        `id: ${CALIBRATION_REPAIR_TASK_ID}`,
        "title: Old repair",
        "status: done",
        "priority: p1",
        "area: autonomy",
        "summary: previous closure",
        "created_at: 2026-04-01T00:00:00.000Z",
        "updated_at: 2026-04-01T00:00:00.000Z",
        "---",
        "",
        "old body",
        "",
      ].join("\n"),
    );
    commitInitial(projectDir);

    const now = new Date();
    const hour = 60 * 60 * 1000;
    seedCalibration(runsDir, "run-older", new Date(now.getTime() - 5 * hour).toISOString(), {
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedCalibration(runsDir, "run-newer", new Date(now.getTime() - 1 * hour).toISOString(), {
      verdict: "fail",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: buildTrigger,
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression[0].payload.repairAction).toBe("recreated");

    expect(existsSync(donePath)).toBe(false);
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "ready", `${CALIBRATION_REPAIR_TASK_ID}.md`),
      ),
    ).toBe(true);
  });

  it("escalates pass-with-warnings drift on overlapping files into the same corrective path", async () => {
    process.env.KOTA_EVALUATOR_CALIBRATION_THRESHOLD_RATE = "0.99";
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = "100";
    process.env.KOTA_EVALUATOR_CALIBRATION_PWW_THRESHOLD_RATE = "0.4";
    process.env.KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE = "1";

    commitInitial(projectDir);
    const now = new Date();
    const hour = 60 * 60 * 1000;
    seedCalibration(runsDir, "run-pww-a", new Date(now.getTime() - 5 * hour).toISOString(), {
      verdict: "pass_with_warnings",
      sourceFilesChanged: ["src/modules/x.ts"],
    });
    seedCalibration(runsDir, "run-pww-b", new Date(now.getTime() - 1 * hour).toISOString(), {
      verdict: "pass_with_warnings",
      sourceFilesChanged: ["src/modules/x.ts"],
    });

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: buildTrigger,
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(1);
    expect(regression[0].payload.driftKinds).toContain("pass-with-warnings-escalation");
    expect(regression[0].payload.driftKinds).not.toContain("pass-contradiction");
    expect(regression[0].payload.repairAction).toBe("created");
  });

  it("skips the corrective path on dirty worktrees but still reports the gate decision", async () => {
    await mockDirtyWorktree();
    const now = new Date();
    const hour = 60 * 60 * 1000;
    seedCalibration(runsDir, "run-older", new Date(now.getTime() - 5 * hour).toISOString(), {
      verdict: "pass",
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedCalibration(runsDir, "run-newer", new Date(now.getTime() - 1 * hour).toISOString(), {
      verdict: "fail",
      sourceFilesChanged: ["src/core/a.ts"],
    });

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: buildTrigger,
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["propose-repair"].status).toBe("skipped");
    expect(result.steps["apply-repair"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(1);
    expect(regression[0].payload.repairAction).toBe("skipped");
  });

  it("skips all work on runtime.recovered triggers", async () => {
    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: { event: "runtime.recovered", payload: {} },
    });
    const result = await harness.run();
    expect(result.steps["evaluate-calibration"].status).toBe("skipped");
    expect(result.steps["propose-repair"].status).toBe("skipped");
    expect(result.steps["apply-repair"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });
});
