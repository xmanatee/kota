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
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  CALIBRATION_REPAIR_TASK_ID,
  type CalibrationRepairContext,
  proposeCalibrationRepair,
} from "#modules/autonomy/calibration-repair.js";
import { seedArtifact } from "#modules/autonomy/calibration-repair-freshness-test-support.js";
import {
  applyCalibrationRepairOperation,
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

function makeScopeRoot(prefix: string): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), prefix));
  for (const state of TASK_STATES) {
    mkdirSync(join(workspaceRoot, "data", "tasks", state), { recursive: true });
  }
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "kota@example.test"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["config", "user.name", "KOTA Test"], {
    cwd: workspaceRoot,
  });
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
  writeFileSync(join(workspaceRoot, "README.md"), "worker-boundary fixture\n");
  return workspaceRoot;
}

function commitFixture(workspaceRoot: string): void {
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "-q", "-m", "initial"], {
    cwd: workspaceRoot,
  });
}

describe("progress and calibration blocking operations", () => {
  it("applies progress-review queue actions through a real worker", async () => {
    const workspaceRoot = makeScopeRoot("kota-progress-action-worker-");
    try {
      commitFixture(workspaceRoot);
      const input: ProgressReviewActionOperationInput = {
        workspaceRoot,
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
                  topicKey: "worker-boundary",
                  title: "Exercise progress review worker boundary",
                  summary:
                    "Keep progress-review task scans and writes off the daemon event loop.",
                  priority: "p2",
                  area: "core",
                  evidenceIds: ["event:worker-boundary"],
                  howWeWillKnow: "Focused real-worker integration output.",
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
            workspaceRoot,
            "data/tasks/ready/task-exercise-progress-review-worker-boundary.md",
          ),
        ),
      ).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("uses the command rail for calibration inspection and a worker for mutation", async () => {
    const workspaceRoot = makeScopeRoot("kota-calibration-repair-worker-");
    try {
      const donePath = join(
        workspaceRoot,
        "data",
        "tasks",
        "done",
        `${CALIBRATION_REPAIR_TASK_ID}.md`,
      );
      writeFileSync(donePath, `---\nid: ${CALIBRATION_REPAIR_TASK_ID}\n---\n`);
      commitFixture(workspaceRoot);
      writeFileSync(join(workspaceRoot, "post-fix.ts"), "export const fixed = true;\n");
      commitFixture(workspaceRoot);
      const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: workspaceRoot,
        encoding: "utf8",
      }).trim();
      seedArtifact(workspaceRoot, "post-fix", sourceRevision, "task-post-fix");
      const context: CalibrationRepairContext = {
        workspaceRoot,
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
      const proposal = await proposeCalibrationRepair(
        context,
        createWorkflowCommandRunner({ cwd: workspaceRoot }),
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
            workspaceRoot,
            "data",
            "tasks",
            "ready",
            `${CALIBRATION_REPAIR_TASK_ID}.md`,
          ),
        ),
      ).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
