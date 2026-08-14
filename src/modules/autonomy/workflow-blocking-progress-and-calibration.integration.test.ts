import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  CALIBRATION_REPAIR_TASK_ID,
  type CalibrationRepairContext,
} from "#modules/autonomy/calibration-repair.js";
import {
  applyCalibrationRepairOperation,
  proposeCalibrationRepairOperation,
} from "#modules/autonomy/workflows/evaluator-calibration-monitor/repair-operations.js";
import {
  type ProgressReviewActionOperationInput,
  progressReviewActionOperation,
} from "#modules/autonomy/workflows/progress-reviewer/progress-review.js";

const TASK_STATES = [
  "backlog",
  "ready",
  "doing",
  "blocked",
  "done",
  "dropped",
] as const;

function makeProjectDir(prefix: string): string {
  const projectDir = mkdtempSync(join(tmpdir(), prefix));
  for (const state of TASK_STATES) {
    mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
  }
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  execFileSync("git", ["config", "user.email", "kota@example.test"], {
    cwd: projectDir,
  });
  execFileSync("git", ["config", "user.name", "KOTA Test"], {
    cwd: projectDir,
  });
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
  writeFileSync(join(projectDir, "README.md"), "worker-boundary fixture\n");
  return projectDir;
}

function commitFixture(projectDir: string): void {
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], {
    cwd: projectDir,
  });
}

describe("progress and calibration blocking operations", () => {
  it("applies progress-review queue actions through a real worker", async () => {
    const projectDir = makeProjectDir("kota-progress-action-worker-");
    try {
      commitFixture(projectDir);
      const input: ProgressReviewActionOperationInput = {
        projectDir,
        runId: "progress-worker-boundary",
        evidence: {
          evidence: [
            {
              id: "event:worker-boundary",
              kind: "event",
              summary: "The queue action must not block daemon control.",
            },
          ],
        },
        review: {
          verdict: "needs-steering",
          summary: "Exercise the production queue mutation path.",
          findings: {
            crossScope: { claims: [], followUpTasks: [] },
            localScope: {
              claims: [],
              followUpTasks: [
                {
                  title: "Exercise progress review worker boundary",
                  summary:
                    "Keep progress-review task scans and writes off the daemon event loop.",
                  priority: "p2",
                  area: "core",
                  evidenceIds: ["event:worker-boundary"],
                  acceptanceEvidence: "Focused real-worker integration output.",
                },
              ],
            },
          },
          ownerQuestions: [],
        },
      };
      let timerFired = false;
      const timer = setTimeout(() => {
        timerFired = true;
      }, 0);
      const result = await runWorkflowBlockingOperation(
        progressReviewActionOperation,
        input,
      );
      clearTimeout(timer);

      expect(timerFired).toBe(true);
      expect(result.createdTaskIds).toEqual([
        "task-exercise-progress-review-worker-boundary",
      ]);
      expect(
        existsSync(
          join(
            projectDir,
            "data/tasks/ready/task-exercise-progress-review-worker-boundary.md",
          ),
        ),
      ).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("proposes and applies calibration repair through real workers", async () => {
    const projectDir = makeProjectDir("kota-calibration-repair-worker-");
    try {
      const donePath = join(
        projectDir,
        "data",
        "tasks",
        "done",
        `${CALIBRATION_REPAIR_TASK_ID}.md`,
      );
      writeFileSync(donePath, `---\nid: ${CALIBRATION_REPAIR_TASK_ID}\n---\n`);
      commitFixture(projectDir);
      const runDir = join(projectDir, ".kota", "runs", "post-fix");
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, "evaluator-calibration.json"),
        `${JSON.stringify({ completedAt: "2099-01-01T00:00:00.000Z" })}\n`,
      );
      const context: CalibrationRepairContext = {
        projectDir,
        decisionReason: "Real-worker boundary fixture",
        driftKinds: ["pass-contradiction"],
        aggregate: {
          windowStartMs: 1,
          windowEndMs: 2,
          totalRuns: 2,
          byVerdict: { pass: 1, pass_with_warnings: 0, fail: 1, absent: 0 },
          passContradictionCount: 1,
          passContradictionRate: 1,
          passWithWarningsFollowUpCount: 0,
          passWithWarningsFollowUpRate: 0,
        },
        thresholdRate: 0.2,
        passWithWarningsThresholdRate: 0.4,
        nowIso: "2099-01-01T00:01:00.000Z",
      };
      const proposal = await runWorkflowBlockingOperation(
        proposeCalibrationRepairOperation,
        context,
      );
      const applied = await runWorkflowBlockingOperation(
        applyCalibrationRepairOperation,
        { proposal, context },
      );

      expect(proposal.action).toBe("recreate");
      expect(applied.kind).toBe("recreated");
      expect(existsSync(donePath)).toBe(false);
      expect(
        existsSync(
          join(
            projectDir,
            "data",
            "tasks",
            "ready",
            `${CALIBRATION_REPAIR_TASK_ID}.md`,
          ),
        ),
      ).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
