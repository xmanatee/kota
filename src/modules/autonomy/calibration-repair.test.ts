import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyCalibrationRepair,
  CALIBRATION_REPAIR_TASK_ID,
  type CalibrationRepairContext,
  proposeCalibrationRepair,
} from "./calibration-repair.js";
import type { EvaluatorCalibrationAggregate } from "./evaluator-calibration.js";

function makeAggregate(): EvaluatorCalibrationAggregate {
  return {
    windowStartMs: Date.parse("2026-04-13T00:00:00.000Z"),
    windowEndMs: Date.parse("2026-04-20T00:00:00.000Z"),
    totalRuns: 20,
    byVerdict: { pass: 10, pass_with_warnings: 5, fail: 3, absent: 2 },
    passContradictionCount: 5,
    passContradictionRate: 0.5,
    passWithWarningsFollowUpCount: 3,
    passWithWarningsFollowUpRate: 0.6,
  };
}

function makeContext(projectDir: string): CalibrationRepairContext {
  return {
    projectDir,
    decisionReason: "Pass-verdict contradiction rate 50.0% exceeds threshold 25.0%.",
    driftKinds: ["pass-contradiction"],
    aggregate: makeAggregate(),
    thresholdRate: 0.25,
    passWithWarningsThresholdRate: 0.4,
    nowIso: "2026-04-20T00:00:00.000Z",
  };
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cal-repair-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init", "--quiet", "--allow-empty"], {
    cwd: dir,
  });
  return dir;
}

function seedTask(projectDir: string, state: string): string {
  const path = join(projectDir, "data", "tasks", state, `${CALIBRATION_REPAIR_TASK_ID}.md`);
  writeFileSync(
    path,
    [
      "---",
      `id: ${CALIBRATION_REPAIR_TASK_ID}`,
      `title: ${state} repair`,
      `status: ${state}`,
      "priority: p1",
      "area: autonomy",
      "summary: seed",
      "created_at: 2026-04-01T00:00:00.000Z",
      "updated_at: 2026-04-01T00:00:00.000Z",
      "---",
      "",
      "## Problem",
      "seed body",
      "",
    ].join("\n"),
  );
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "-m", `seed ${state}`, "--quiet"], { cwd: projectDir });
  return path;
}

describe("proposeCalibrationRepair", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("proposes create when the repair task does not exist anywhere", () => {
    const proposal = proposeCalibrationRepair(makeContext(projectDir));
    expect(proposal.action).toBe("create");
  });

  it("proposes noop when the repair task is in ready/", () => {
    seedTask(projectDir, "ready");
    const proposal = proposeCalibrationRepair(makeContext(projectDir));
    expect(proposal.action).toBe("noop");
    if (proposal.action !== "noop") return;
    expect(proposal.existingState).toBe("ready");
  });

  it("proposes noop when the repair task is in doing/", () => {
    seedTask(projectDir, "doing");
    const proposal = proposeCalibrationRepair(makeContext(projectDir));
    expect(proposal.action).toBe("noop");
  });

  it("proposes noop with a precondition reason when the repair task is in blocked/", () => {
    seedTask(projectDir, "blocked");
    const proposal = proposeCalibrationRepair(makeContext(projectDir));
    expect(proposal.action).toBe("noop");
    if (proposal.action !== "noop") return;
    expect(proposal.existingState).toBe("blocked");
    expect(proposal.reason).toContain("blocked-promoter");
  });

  it("proposes promote when the repair task is in backlog/", () => {
    seedTask(projectDir, "backlog");
    const proposal = proposeCalibrationRepair(makeContext(projectDir));
    expect(proposal.action).toBe("promote");
    if (proposal.action !== "promote") return;
    expect(proposal.fromState).toBe("backlog");
    expect(proposal.target).toBe("ready");
  });

  it("proposes recreate when a previous repair task closed in done/", () => {
    seedTask(projectDir, "done");
    const proposal = proposeCalibrationRepair(makeContext(projectDir));
    expect(proposal.action).toBe("recreate");
    if (proposal.action !== "recreate") return;
    expect(proposal.previousState).toBe("done");
  });

  it("proposes recreate when a previous repair task closed in dropped/", () => {
    seedTask(projectDir, "dropped");
    const proposal = proposeCalibrationRepair(makeContext(projectDir));
    expect(proposal.action).toBe("recreate");
    if (proposal.action !== "recreate") return;
    expect(proposal.previousState).toBe("dropped");
  });
});

describe("applyCalibrationRepair", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates a new ready/ task with the calibration evidence in its body", () => {
    const ctx = makeContext(projectDir);
    const proposal = proposeCalibrationRepair(ctx);
    const applied = applyCalibrationRepair(proposal, ctx);
    expect(applied.kind).toBe("created");
    const targetPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      `${CALIBRATION_REPAIR_TASK_ID}.md`,
    );
    expect(existsSync(targetPath)).toBe(true);
    const content = readFileSync(targetPath, "utf-8");
    expect(content).toContain("status: ready");
    expect(content).toContain("priority: p1");
    expect(content).toContain("area: autonomy");
    expect(content).toContain("Pass-verdict contradiction rate 50.0%");
    expect(content).toContain("pass-contradiction");
    expect(content).toContain("Pass-with-warnings follow-up rate");
  });

  it("recreates the task in ready/ when the previous one is in done/", () => {
    const seededPath = seedTask(projectDir, "done");
    const ctx = makeContext(projectDir);
    const proposal = proposeCalibrationRepair(ctx);
    const applied = applyCalibrationRepair(proposal, ctx);
    expect(applied.kind).toBe("recreated");
    expect(existsSync(seededPath)).toBe(false);
    const readyPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      `${CALIBRATION_REPAIR_TASK_ID}.md`,
    );
    expect(existsSync(readyPath)).toBe(true);
    const content = readFileSync(readyPath, "utf-8");
    expect(content).toContain("status: ready");
  });

  it("promotes from backlog/ to ready/", () => {
    seedTask(projectDir, "backlog");
    const ctx = makeContext(projectDir);
    const proposal = proposeCalibrationRepair(ctx);
    const applied = applyCalibrationRepair(proposal, ctx);
    expect(applied.kind).toBe("promoted");
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "backlog", `${CALIBRATION_REPAIR_TASK_ID}.md`),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(projectDir, "data", "tasks", "ready", `${CALIBRATION_REPAIR_TASK_ID}.md`),
      ),
    ).toBe(true);
  });

  it("returns noop without disk changes when the repair task is already in ready/", () => {
    const seededPath = seedTask(projectDir, "ready");
    const seededBody = readFileSync(seededPath, "utf-8");
    const ctx = makeContext(projectDir);
    const proposal = proposeCalibrationRepair(ctx);
    const applied = applyCalibrationRepair(proposal, ctx);
    expect(applied.kind).toBe("noop");
    expect(readFileSync(seededPath, "utf-8")).toBe(seededBody);
  });
});
