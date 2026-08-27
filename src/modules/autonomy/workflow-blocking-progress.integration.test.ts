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
  type ProgressReviewActionOperationInput,
  progressReviewActionOperation,
} from "#modules/autonomy/workflows/progress-reviewer/progress-review.js";

const TASK_STATES = [
  "open",
  "open",
  "open",
  "blocked",
  "done",
  "dropped",
] as const;

function makeScopeRoot(): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-progress-action-worker-"));
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
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "-q", "-m", "initial"], {
    cwd: workspaceRoot,
  });
  return workspaceRoot;
}

describe("progress-review blocking operation", () => {
  it("applies queue actions through a real worker", async () => {
    const workspaceRoot = makeScopeRoot();
    try {
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
                  problem:
                    "Keep progress-review task scans and writes off the daemon event loop.",
                  priority: "p2",
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
      expect(result.createdTaskIds).toHaveLength(1);
      const createdTaskId = result.createdTaskIds[0]!;
      expect(
        existsSync(
          join(workspaceRoot, `data/tasks/${createdTaskId}.md`),
        ),
      ).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
