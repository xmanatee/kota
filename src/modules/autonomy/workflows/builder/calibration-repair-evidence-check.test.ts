import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CALIBRATION_REPAIR_TASK_ID } from "#modules/autonomy/calibration-repair.js";
import { checkCalibrationRepairEvidence } from "./calibration-repair-evidence-check.js";
import {
  calibrationClaim as claim,
  CALIBRATION_FOLLOW_UP_TASK_ID as FOLLOW_UP_TASK_ID,
  CALIBRATION_TASK_PATH as TASK_PATH,
  calibrationTaskSnapshot as taskSnapshot,
} from "./calibration-repair-evidence-test-support.js";

describe("calibration repair evidence check", () => {
  let projectDir: string;
  let runDir: string;
  let sourceRef: string;
  let historicalMonitorRefs: string[];
  const originalMinSample = process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE;

  function commitTask(content: string, message: string): string {
    writeFileSync(join(projectDir, TASK_PATH), content);
    execFileSync("git", ["add", TASK_PATH], { cwd: projectDir });
    execFileSync("git", ["commit", "--quiet", "-m", message], {
      cwd: projectDir,
    });
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectDir,
      encoding: "utf8",
    }).trim();
    return `git:${revision}:${TASK_PATH}`;
  }

  function validArtifact() {
    const aggregate = {
      windowStartMs: Date.parse("2026-08-06T17:33:19.913Z"),
      windowEndMs: Date.parse("2026-08-13T17:33:19.913Z"),
      totalRuns: 15,
      byVerdict: { pass: 10, pass_with_warnings: 0, fail: 1, absent: 4 },
      passContradictionCount: 3,
      passContradictionRate: 0.3,
      passWithWarningsFollowUpCount: 0,
      passWithWarningsFollowUpRate: 0,
    };
    return {
      schemaVersion: 1,
      artifactType: "evaluator-calibration-repair",
      evidenceKind: "gate-retune",
      taskId: CALIBRATION_REPAIR_TASK_ID,
      workflow: "builder",
      gateStatus: "insufficient-sample",
      decisionReason:
        "Only 10 pass verdicts and 0 pass_with_warnings verdicts in window (minimums 20 / 5).",
      sourceSnapshot: { sourceRef, gateStatus: "gated", aggregate },
      aggregate,
      candidateConfig: {
        thresholdRate: 0.25,
        minSample: 20,
        passWithWarningsThresholdRate: 0.75,
        passWithWarningsMinSample: 5,
      },
      rationale:
        "Monitor-generated 8–10-pass windows were volatile at 30–44%, while two preserved 73–74-pass windows held at 2.7%; retain all contradictions and require twenty passes.",
      historicalMonitorRefs,
      weakEvidenceDisposition: {
        resolution: "follow-up-task",
        sourceRef,
        weakEvidenceCount: 3,
        rationale:
          "The low-volume retune accepts that overlap alone is inconclusive, while a bound follow-up retains responsibility for identifying and reviewing all three weak-evidence passes.",
        followUpTaskIds: [FOLLOW_UP_TASK_ID],
      },
    };
  }

  function writeFollowUpTask(): void {
    writeFileSync(
      join(projectDir, "data", "tasks", "backlog", `${FOLLOW_UP_TASK_ID}.md`),
      [
        "---",
        `id: ${FOLLOW_UP_TASK_ID}`,
        "title: Disposition retained evaluator calibration contradictions",
        "status: backlog",
        "---",
        "",
        "## Calibration Source",
        "",
        `sourceRef: ${sourceRef}`,
        "weakEvidenceCount: 3",
        "acceptedTradeoff: low-sample-overlap",
        "",
      ].join("\n"),
    );
  }

  function writeArtifact(value: object): void {
    writeFileSync(
      join(runDir, "artifacts", "calibration-repair.json"),
      JSON.stringify(value),
    );
  }

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-calibration-repair-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    runDir = join(projectDir, ".kota", "builder-evidence", "run-test");
    mkdirSync(join(runDir, "artifacts"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "backlog"), { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: projectDir,
    });
    execFileSync("git", ["config", "user.name", "test"], { cwd: projectDir });
    execFileSync("git", ["config", "commit.gpgsign", "false"], {
      cwd: projectDir,
    });
    historicalMonitorRefs = [
      commitTask(
        taskSnapshot({ total: 75, pass: 73, fail: 0, absent: 2, contradictions: 2 }),
        "large monitor sample",
      ),
      commitTask(
        taskSnapshot({ total: 9, pass: 9, fail: 0, absent: 0, contradictions: 4 }),
        "small monitor sample",
      ),
    ];
    sourceRef = commitTask(
      taskSnapshot({ total: 15, pass: 10, fail: 1, absent: 4, contradictions: 3 }),
      "affected monitor sample",
    );
    writeFollowUpTask();
    writeFileSync(
      join(runDir, "evidence-manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        artifacts: [{ path: "calibration-repair.json", kind: "json" }],
      }),
    );
    process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = "20";
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (originalMinSample === undefined) {
      delete process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE;
    } else {
      process.env.KOTA_EVALUATOR_CALIBRATION_MIN_SAMPLE = originalMinSample;
    }
  });

  it("does not impose calibration evidence on unrelated tasks", () => {
    expect(
      checkCalibrationRepairEvidence(projectDir, runDir, claim("task-unrelated")),
    ).toMatch(/not an evaluator-calibration repair/);
  });

  it("rejects a calibration repair with no registered evidence", () => {
    expect(() =>
      checkCalibrationRepairEvidence(
        projectDir,
        runDir,
        claim(CALIBRATION_REPAIR_TASK_ID),
      ),
    ).toThrow(/is missing/);
  });

  it("rejects old aggregate-only evidence with no gate-retune provenance", () => {
    writeArtifact({
      gateStatus: "insufficient-sample",
      aggregate: { totalRuns: 1, passContradictionRate: 0 },
      thresholdRate: 0.25,
    });
    expect(() =>
      checkCalibrationRepairEvidence(
        projectDir,
        runDir,
        claim(CALIBRATION_REPAIR_TASK_ID),
      ),
    ).toThrow(/schemaVersion/);
  });

  it("rejects an unrelated older task snapshot", () => {
    const artifact = validArtifact();
    artifact.sourceSnapshot.sourceRef = historicalMonitorRefs[0];
    writeArtifact(artifact);
    expect(() =>
      checkCalibrationRepairEvidence(
        projectDir,
        runDir,
        claim(CALIBRATION_REPAIR_TASK_ID),
      ),
    ).toThrow(/unrelated to the claimed task/);
  });

  it("rejects candidate config that does not match the active monitor", () => {
    const artifact = validArtifact();
    artifact.candidateConfig.minSample = 8;
    writeArtifact(artifact);
    expect(() =>
      checkCalibrationRepairEvidence(
        projectDir,
        runDir,
        claim(CALIBRATION_REPAIR_TASK_ID),
      ),
    ).toThrow(/minSample/);
  });

  it("rejects a gate retune that leaves weak-evidence verdicts undispositioned", () => {
    const artifact = validArtifact();
    Reflect.deleteProperty(artifact, "weakEvidenceDisposition");
    writeArtifact(artifact);
    expect(() =>
      checkCalibrationRepairEvidence(
        projectDir,
        runDir,
        claim(CALIBRATION_REPAIR_TASK_ID),
      ),
    ).toThrow(/weakEvidenceDisposition/);
  });

  it("rejects a follow-up task that does not cover every weak-evidence signal", () => {
    const artifact = validArtifact();
    artifact.weakEvidenceDisposition.weakEvidenceCount = 2;
    writeArtifact(artifact);
    expect(() =>
      checkCalibrationRepairEvidence(
        projectDir,
        runDir,
        claim(CALIBRATION_REPAIR_TASK_ID),
      ),
    ).toThrow(/weakEvidenceCount must equal 3/);
  });

  it("rejects a disposition whose follow-up task is not open", () => {
    const artifact = validArtifact();
    artifact.weakEvidenceDisposition.followUpTaskIds = ["task-missing"];
    writeArtifact(artifact);
    expect(() =>
      checkCalibrationRepairEvidence(
        projectDir,
        runDir,
        claim(CALIBRATION_REPAIR_TASK_ID),
      ),
    ).toThrow(/task-missing must exist in an open task state/);
  });

  it("accepts a sourced retune that preserves the affected aggregate", () => {
    writeArtifact(validArtifact());
    expect(
      checkCalibrationRepairEvidence(
        projectDir,
        runDir,
        claim(CALIBRATION_REPAIR_TASK_ID),
      ),
    ).toBe(
      "OK: calibration gate retune preserves 15 source run(s), assigns weak evidence to 1 follow-up task(s), and resolves insufficient-sample",
    );
  });
});
