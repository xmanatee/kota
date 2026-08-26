import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  criticReviewInspectionOperation,
  improverSemanticInspectionOperation,
} from "#modules/autonomy/review-input-operations.js";
import { shadowSemanticReviewTargetOperation } from "#modules/autonomy/shadow-semantic-review-targets.js";
import { promoteSatisfiedBlockedTasksOperation } from "#modules/autonomy/workflows/blocked-promoter/blocking-operations.js";
import {
  builderRepairCheckOperation,
} from "#modules/autonomy/workflows/builder/blocking-operations.js";
import {
  applyScopeImprovementRecommendationsOperation,
  type ScopeImprovementInputs,
} from "#modules/autonomy/workflows/scope-improver/scope-improvement.js";

describe("autonomy workflow blocking review and task operations", () => {
  it("loads review and task operations through real workers", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-blocking-mutations-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], {
        cwd: projectDir,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.email", "kota@example.test"], {
        cwd: projectDir,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.name", "KOTA Test"], {
        cwd: projectDir,
        stdio: "ignore",
      });
      writeFileSync(join(projectDir, "README.md"), "boundary fixture\n");
      writeFileSync(join(projectDir, ".gitignore"), ".kota/\n.worktrees/\n");
      execFileSync("git", ["add", ".gitignore", "README.md"], {
        cwd: projectDir,
        stdio: "ignore",
      });
      execFileSync("git", ["commit", "-q", "-m", "initial"], {
        cwd: projectDir,
        stdio: "ignore",
      });

      const reviewRunDir = join(projectDir, ".kota", "runs", "review-boundary");
      mkdirSync(join(projectDir, "data", "tasks", "doing"), { recursive: true });
      mkdirSync(reviewRunDir, { recursive: true });
      writeFileSync(
        join(projectDir, "data", "tasks", "doing", "task-review-boundary.md"),
        "---\ntitle: Review boundary\n---\n\n## Done When\n\n- Review stays responsive.\n",
      );
      let reviewTimerFired = false;
      const reviewTimer = setTimeout(() => {
        reviewTimerFired = true;
      }, 10);
      const criticInspection = await runWorkflowBlockingOperation(
        criticReviewInspectionOperation,
        { reviewDir: projectDir, taskMutationStatus: "" },
      );
      const semanticInspection = await runWorkflowBlockingOperation(
        improverSemanticInspectionOperation,
        { projectDir, runDirPath: reviewRunDir },
      );
      const shadowTargets = await runWorkflowBlockingOperation(
        shadowSemanticReviewTargetOperation,
        { kind: "workflow-mutations", projectDir },
      );
      clearTimeout(reviewTimer);

      for (const state of [
        "backlog",
        "ready",
        "doing",
        "blocked",
        "done",
        "dropped",
      ]) {
        mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
      }
      writeFileSync(
        join(projectDir, "data", "tasks", "done", "task-review-boundary.md"),
        [
          "---",
          "id: task-review-boundary",
          "title: Review boundary",
          "status: done",
          "priority: p2",
          "area: autonomy",
          "task_class: Platform",
          "summary: Keep review workers responsive.",
          "created_at: 2026-08-14T12:00:00.000Z",
          "updated_at: 2026-08-14T12:00:00.000Z",
          "---",
          "",
          "Resolved.",
          "",
        ].join("\n"),
      );
      rmSync(
        join(projectDir, "data", "tasks", "doing", "task-review-boundary.md"),
      );
      execFileSync(
        "git",
        ["add", "data/tasks/done/task-review-boundary.md"],
        { cwd: projectDir, stdio: "ignore" },
      );
      const authorityInspection = await runWorkflowBlockingOperation(
        builderRepairCheckOperation,
        {
          projectDir,
          taskId: "task-review-boundary",
        },
      );
      const blockedPromotions = await runWorkflowBlockingOperation(
        promoteSatisfiedBlockedTasksOperation,
        { projectDir },
      );
      const scopeInputs: ScopeImprovementInputs = {
        generatedAt: "2026-08-14T12:00:00.000Z",
        triggerKind: "explicit-request",
        triggerEvent: "autonomy.scope-improvement.requested",
        scope: {
          scopeId: "root",
          displayName: "Boundary test",
          directoryRoot: projectDir,
        },
        config: {
          enabled: true,
          maxActionsPerRun: 1,
        },
        state: {
          scopeId: "root",
          lastRunAt: null,
          consumedFingerprint: null,
          pendingFingerprint: null,
          pendingBoundary: null,
          pendingDelivery: null,
          pendingDeliveryAttempt: 0,
          recentSignatures: [],
        },
        instructions: [],
        changedFiles: [],
        evidence: [],
        semanticInput: {
          automatic: false,
          fingerprint: "worker-boundary",
          evidenceRefs: ["boundary:test"],
        },
        alreadyConsumed: false,
      };
      const scopeImprovement = await runWorkflowBlockingOperation(
        applyScopeImprovementRecommendationsOperation,
        {
          projectDir,
          runId: "boundary-test",
          inputs: scopeInputs,
          recommendations: [
            {
              kind: "create-task",
              signature: "worker-boundary",
              title: "Worker boundary scope improvement",
              summary:
                "Exercise queue inspection and staged task mutation in a worker.",
              evidenceIds: ["boundary:test"],
              task: {
                problem: "The operation needs real worker coverage.",
                desiredOutcome: "The worker creates and stages the task.",
                constraints: ["Keep the daemon event loop free."],
                howWeWillKnow: [
                  "The task is created through the worker operation without blocking the daemon.",
                ],
              },
            },
          ],
        },
      );

      expect(reviewTimerFired).toBe(true);
      expect(criticInspection).toMatchObject({
        status: "ready",
        target: { path: "data/tasks/doing/task-review-boundary.md" },
      });
      expect(semanticInspection).toMatchObject({
        status: "ready",
        changedFiles: "data/tasks/doing/task-review-boundary.md",
      });
      expect(shadowTargets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "git:workflow-mutation-files" }),
        ]),
      );
      if (authorityInspection.status === "failed") {
        throw new Error(authorityInspection.output);
      }
      expect(authorityInspection.status).toBe("passed");
      expect(blockedPromotions).toEqual({ promotions: [] });
      expect(scopeImprovement.createdTaskIds).toEqual([
        "task-worker-boundary-scope-improvement",
      ]);
      expect(
        readFileSync(
          join(
            projectDir,
            "data",
            "tasks",
            "ready",
            "task-worker-boundary-scope-improvement.md",
          ),
          "utf8",
        ),
      ).toContain("The worker creates and stages the task.");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
