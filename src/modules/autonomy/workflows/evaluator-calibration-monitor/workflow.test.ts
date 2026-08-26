import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import {
  createWorkflowCommandRunner,
  type WorkflowCommandRunner,
} from "#core/workflow/workflow-command.js";
import { CALIBRATION_REPAIR_TASK_ID } from "#modules/autonomy/calibration-repair.js";
import { seedArtifact as seedBoundCalibrationArtifact } from "#modules/autonomy/calibration-repair-freshness-test-support.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
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
    | "verdict"
    | "sourceRevision"
    | "sourceFilesChanged"
    | "finalIterationFailures"
    | "criticFailureCount"
    | "criticPromptHash"
    | "terminalRunStatus"
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
    terminalRunStatus: overrides.terminalRunStatus ?? "success",
    taskId: null,
    taskFinalState: null,
    sourceRevision:
      overrides.sourceRevision ?? "1111111111111111111111111111111111111111",
    sourceFilesChanged: overrides.sourceFilesChanged ?? [],
    // Match the running critic prompt so the workflow's filtered aggregation
    // counts these seeded runs. Cross-prompt-version filtering is exercised
    // directly in evaluator-calibration.test.ts.
    criticPromptHash: overrides.criticPromptHash ?? getCriticPromptHash(),
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

function headRevision(dir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
}

function commitSourceChange(dir: string, name: string): string {
  writeFileSync(join(dir, `${name}.ts`), `export const value = ${JSON.stringify(name)};\n`);
  execFileSync("git", ["add", `${name}.ts`], { cwd: dir });
  execFileSync("git", ["commit", "-m", name, "--quiet"], { cwd: dir });
  return headRevision(dir);
}

function calibrationWorkflowCommandRunner(
  projectDir: string,
): WorkflowCommandRunner {
  const runCommand = createWorkflowCommandRunner({ cwd: projectDir });
  return (input) =>
    input.command === "git"
      ? runCommand(input)
      : successfulWorkflowCommandRun(input);
}

const builderCompletionTrigger = {
  event: "workflow.completed",
  payload: {
    workflow: "builder",
    runId: "run-newer",
    status: "success",
    triggerEvent: "autonomy.queue.available",
    durationMs: 1_000,
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    runDir: ".kota/runs/run-newer",
    tags: ["monitored"],
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

  it("registers for completed builder runs", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/evaluator-calibration-monitor/workflow.ts",
      evaluatorCalibrationMonitor,
    );
    expect(registered.name).toBe("evaluator-calibration-monitor");
    const events = registered.triggers.map((t) => t.event);
    expect(events).toEqual(["workflow.completed"]);
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
      trigger: builderCompletionTrigger,
      contextOverrides: {
        runCommand: calibrationWorkflowCommandRunner(projectDir),
      },
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(1);
    expect(regression[0].payload.driftKinds).toContain("pass-contradiction");
    expect(regression[0].payload.repairAction).toBe("created");
    const healthSignals = result.emitted.filter(
      (e) => e.event === autonomyHealthSignal.name,
    );
    expect(healthSignals).toHaveLength(1);
    expect(healthSignals[0].payload).toMatchObject({
      severity: "warning",
      labels: ["evaluator-drift", "quality"],
      actionability: "informational",
    });

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
    expect(artifact).toMatchObject({
      runId: "harness-run-id",
      workflow: "evaluator-calibration-monitor",
      triggerEvent: "workflow.completed",
      sourceRunId: "run-newer",
      criticPromptHash: getCriticPromptHash(),
      driftKinds: ["pass-contradiction"],
      applied: { kind: "created" },
    });
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
      trigger: builderCompletionTrigger,
      contextOverrides: {
        runCommand: calibrationWorkflowCommandRunner(projectDir),
      },
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
    const artifact = JSON.parse(
      readFileSync(
        join(projectDir, ".kota", "runs", "harness", "calibration-repair.json"),
        "utf-8",
      ),
    );
    expect(artifact).toMatchObject({
      gateStatus: "under-threshold",
      proposal: null,
      applied: null,
    });
  });

  it("keeps the affected 3-of-10 sample intact but below the retuned minimum", async () => {
    const activePromptHash = getCriticPromptHash();
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = String(
      DEFAULT_CALIBRATION_MIN_SAMPLE,
    );
    process.env.KOTA_EVALUATOR_CALIBRATION_PWW_MIN_SAMPLE = "5";
    commitInitial(projectDir);
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    for (let index = 0; index < 10; index++) {
      seedCalibration(
        runsDir,
        `source-sample-pass-${index}`,
        new Date(now - (20 - index) * hour).toISOString(),
        {
          verdict: "pass",
          criticPromptHash: activePromptHash,
          sourceFilesChanged:
            index < 3
              ? ["src/modules/autonomy/affected.ts"]
              : [`src/modules/autonomy/healthy-${index}.ts`],
        },
      );
    }
    // Preserve the source relationship: the later failure overlaps all three
    // passes. The repair changes sample adequacy, not historical verdicts.
    seedCalibration(
      runsDir,
      "source-sample-failure",
      new Date(now - 2 * hour).toISOString(),
      {
        verdict: "fail",
        criticPromptHash: activePromptHash,
        terminalRunStatus: "failed",
        sourceFilesChanged: ["src/modules/autonomy/affected.ts"],
      },
    );
    for (let index = 0; index < 4; index++) {
      seedCalibration(
        runsDir,
        `source-sample-absent-${index}`,
        new Date(now - (6 - index) * hour).toISOString(),
        {
          verdict: "absent",
          criticPromptHash: activePromptHash,
          sourceFilesChanged: [],
        },
      );
    }
    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: builderCompletionTrigger,
      contextOverrides: {
        runCommand: calibrationWorkflowCommandRunner(projectDir),
      },
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(
      result.emitted.filter(
        (event) => event.event === "evaluator-calibration.regression.detected",
      ),
    ).toHaveLength(0);

    const artifact = JSON.parse(
      readFileSync(
        join(projectDir, ".kota", "runs", "harness", "calibration-repair.json"),
        "utf-8",
      ),
    );
    expect(artifact).toMatchObject({
      runId: "harness-run-id",
      workflow: "evaluator-calibration-monitor",
      triggerEvent: "workflow.completed",
      sourceRunId: "run-newer",
      criticPromptHash: getCriticPromptHash(),
      gateStatus: "insufficient-sample",
      aggregate: {
        totalRuns: 15,
        byVerdict: { pass: 10, pass_with_warnings: 0, fail: 1, absent: 4 },
        passContradictionCount: 3,
        passContradictionRate: 0.3,
      },
      thresholdRate: 0.25,
      minSample: DEFAULT_CALIBRATION_MIN_SAMPLE,
      proposal: null,
      applied: null,
    });
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
      trigger: builderCompletionTrigger,
      contextOverrides: {
        runCommand: calibrationWorkflowCommandRunner(projectDir),
      },
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

  it("recreates the repair task when a previous one is in done/ and post-fix calibration evidence has accrued", async () => {
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
    const postFixRevision = commitSourceChange(projectDir, "post-fix-calibration");

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
    // The recreate-loop guard accepts only canonical builder evidence whose
    // source revision descends from the repair-closing commit.
    seedBoundCalibrationArtifact(
      projectDir,
      "run-post-fix",
      postFixRevision,
      "task-post-fix",
    );

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: builderCompletionTrigger,
      contextOverrides: {
        runCommand: calibrationWorkflowCommandRunner(projectDir),
      },
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

  it("noops the recreate when the previous repair task was just closed and no post-fix calibration artifact exists", async () => {
    const now = new Date();
    const hour = 60 * 60 * 1000;
    commitInitial(projectDir);
    const preFixRevision = headRevision(projectDir);
    // Seed pre-fix calibration evidence first so the gate fires.
    seedCalibration(runsDir, "run-older", new Date(now.getTime() - 5 * hour).toISOString(), {
      verdict: "pass",
      sourceRevision: preFixRevision,
      sourceFilesChanged: ["src/core/a.ts"],
    });
    seedCalibration(runsDir, "run-newer", new Date(now.getTime() - 1 * hour).toISOString(), {
      verdict: "fail",
      sourceRevision: preFixRevision,
      sourceFilesChanged: ["src/core/a.ts"],
    });

    // Then close the previous repair task to done/. Its commit is later than
    // every artifact above — no post-fix builder run has written calibration
    // evidence yet.
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

    const harness = new WorkflowTestHarness(evaluatorCalibrationMonitor, {
      projectDir,
      trigger: builderCompletionTrigger,
      contextOverrides: {
        runCommand: calibrationWorkflowCommandRunner(projectDir),
      },
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(1);
    expect(regression[0].payload.repairAction).toBe("noop");
    expect(existsSync(donePath)).toBe(true);
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "ready", `${CALIBRATION_REPAIR_TASK_ID}.md`),
      ),
    ).toBe(false);
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
      trigger: builderCompletionTrigger,
      contextOverrides: {
        runCommand: calibrationWorkflowCommandRunner(projectDir),
      },
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
      trigger: builderCompletionTrigger,
      contextOverrides: {
        runCommand: calibrationWorkflowCommandRunner(projectDir),
      },
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["propose-repair"].status).toBe("skipped");
    expect(result.steps["apply-repair"].status).toBe("skipped");
    const regression = result.emitted.filter(
      (e) => e.event === "evaluator-calibration.regression.detected",
    );
    expect(regression).toHaveLength(1);
    expect(regression[0].payload.repairAction).toBe("skipped");
  });

});
