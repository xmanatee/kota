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
import { applyAutonomyIssueObservations, buildAutonomyIssueObservation, emptyAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import {
  criticReviewInspectionOperation,
  improverSemanticInspectionOperation,
} from "#modules/autonomy/review-input-operations.js";
import { shadowSemanticReviewTargetOperation } from "#modules/autonomy/shadow-semantic-review-targets.js";
import { promoteSatisfiedBlockedTasksOperation } from "#modules/autonomy/workflows/blocked-promoter/blocking-operations.js";
import {
  builderRepairCheckOperation,
} from "#modules/autonomy/workflows/builder/blocking-operations.js";
import { applyDispositionOperation } from "#modules/autonomy/workflows/improver/apply-disposition.js";
import { decodeIssueDisposition } from "#modules/autonomy/workflows/improver/issue-disposition.js";
import {
  applyScopeImprovementRecommendationsOperation,
  type ScopeImprovementInputs,
} from "#modules/autonomy/workflows/scope-improver/scope-improvement.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";

describe("autonomy workflow blocking review and task operations", () => {
  it("loads review and task operations through real workers", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-blocking-mutations-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], {
        cwd: workspaceRoot,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.email", "kota@example.test"], {
        cwd: workspaceRoot,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.name", "KOTA Test"], {
        cwd: workspaceRoot,
        stdio: "ignore",
      });
      writeFileSync(join(workspaceRoot, "README.md"), "boundary fixture\n");
      writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n.worktrees/\n");
      execFileSync("git", ["add", ".gitignore", "README.md"], {
        cwd: workspaceRoot,
        stdio: "ignore",
      });
      execFileSync("git", ["commit", "-q", "-m", "initial"], {
        cwd: workspaceRoot,
        stdio: "ignore",
      });

      const reviewRunDir = join(workspaceRoot, ".kota", "runs", "review-boundary");
      mkdirSync(join(workspaceRoot, "data", "tasks"), { recursive: true });
      mkdirSync(reviewRunDir, { recursive: true });
      writeFileSync(
        join(workspaceRoot, "data", "tasks", "task-review-boundary.md"),
        "---\nstatus: open\npriority: p2\n---\n\n# Review boundary\n\n## Done When\n\n- Review stays responsive.\n",
      );
      let reviewTimerFired = false;
      const reviewTimer = setTimeout(() => {
        reviewTimerFired = true;
      }, 10);
      const criticInspection = await runWorkflowBlockingOperation(
        criticReviewInspectionOperation,
        { reviewDir: workspaceRoot, taskMutationStatus: "" },
      );
      const semanticInspection = await runWorkflowBlockingOperation(
        improverSemanticInspectionOperation,
        { workspaceRoot, runDirPath: reviewRunDir },
      );
      const shadowTargets = await runWorkflowBlockingOperation(
        shadowSemanticReviewTargetOperation,
        { kind: "workflow-mutations", workspaceRoot },
      );
      clearTimeout(reviewTimer);

      mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
      writeFileSync(
        join(workspaceRoot, "data", "tasks", "archive", "task-review-boundary.md"),
        [
          "---",
          "status: done",
          "---",
          "",
          "# Review boundary",
          "",
          "Resolved.",
          "",
        ].join("\n"),
      );
      rmSync(
        join(workspaceRoot, "data", "tasks", "task-review-boundary.md"),
      );
      execFileSync(
        "git",
        ["add", "-A", "data/tasks"],
        { cwd: workspaceRoot, stdio: "ignore" },
      );
      const authorityInspection = await runWorkflowBlockingOperation(
        builderRepairCheckOperation,
        {
          workspaceRoot,
          taskId: "task-review-boundary",
        },
      );
      const blockedPromotions = await runWorkflowBlockingOperation(
        promoteSatisfiedBlockedTasksOperation,
        { workspaceRoot, scopeRoot: workspaceRoot },
      );
      const scopeInputs: ScopeImprovementInputs = {
        generatedAt: "2026-08-14T12:00:00.000Z",
        triggerKind: "explicit-request",
        triggerEvent: "autonomy.scope-improvement.requested",
        scope: {
          scopeId: "root",
          displayName: "Boundary test",
          directoryRoot: workspaceRoot,
        },
        config: {
          enabled: true,
          maxActionsPerRun: 1,
          posture: "build",
        },
        taskProposalAuthority: {
          outcome: "allow",
          reason: "The boundary fixture permits task proposals.",
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
      consumedExplicitRunIds: [],
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
          workspaceRoot,
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
        status: "open",
        target: { path: "data/tasks/task-review-boundary.md" },
      });
      expect(semanticInspection).toMatchObject({
        status: "open",
        changedFiles: "data/tasks/task-review-boundary.md",
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
      expect(scopeImprovement.createdTaskIds).toHaveLength(1);
      const createdTaskId = scopeImprovement.createdTaskIds[0]!;
      expect(
        readFileSync(
          join(
            workspaceRoot,
            "data",
            "tasks",
            `${createdTaskId}.md`,
          ),
          "utf8",
        ),
      ).toContain("The worker creates and stages the task.");
      const issue = applyAutonomyIssueObservations({
        current: emptyAutonomyIssueProjection(),
        observations: [buildAutonomyIssueObservation({
          kind: "present", rootCauseKey: "worker-boundary:missed-output",
          observedAt: "2026-09-07T12:00:00Z", signalIds: ["worker-output-failure"],
          source: { kind: "workflow", id: "builder" }, severity: "error", actionability: "local-code",
          labels: ["workflow"], summaries: ["A completed worker omitted its required output."],
          evidenceRefs: [{ kind: "artifact", ref: ".kota/runs/failed-worker/metadata.json" }],
          observationCount: 1,
        })],
      }).projection.issues[0]!;
      const disposition = await runWorkflowBlockingOperation(applyDispositionOperation, {
        workspaceRoot, scopeRoot: workspaceRoot, issue, workflowRunId: "disposition-boundary",
        disposition: decodeIssueDisposition({
          action: "create-task", recoveryAction: "", rationale: "The missed output requires a repair.",
          taskTitle: "Restore the required worker output", taskSummary: "Completed workers omit the required output.",
          taskPriority: "p1", taskHowWeWillKnow: "A completed worker returns the required output.",
          ownerQuestion: "", ownerReason: "", proposedAnswers: [],
        }),
      });
      expect(listFullRepoTasks(workspaceRoot)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: disposition.materialized.taskId, state: "open" }),
      ]));
      expect(disposition).toMatchObject({
        issueKey: issue.issueKey, semanticRevision: issue.semanticRevision,
        materialized: { touchedTaskQueue: true, ownerQuestionId: null },
      });

    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
