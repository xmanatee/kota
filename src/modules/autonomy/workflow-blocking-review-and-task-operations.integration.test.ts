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
  projectBuilderAgentRunArtifactsOperation,
} from "#modules/autonomy/workflows/builder/blocking-operations.js";
import {
  applyScopeImprovementRecommendationsOperation,
  type ScopeImprovementInputs,
} from "#modules/autonomy/workflows/scope-improver/scope-improvement.js";

describe("autonomy workflow blocking review and task operations", () => {
  it("loads migrated review, projection, and task mutations through real workers", async () => {
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
        {
          reviewDir: projectDir,
          runDir: reviewRunDir,
          durableEvidenceDir: reviewRunDir,
        },
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

      const agentRunDir = join(
        projectDir,
        ".kota",
        "builder-evidence",
        "boundary-test",
      );
      mkdirSync(agentRunDir, { recursive: true });
      writeFileSync(join(agentRunDir, "success-criteria.txt"), "1. Declared\n");
      writeFileSync(
        join(agentRunDir, "success-criteria-verified.txt"),
        "1. Verified\n",
      );
      writeFileSync(join(agentRunDir, "commit-message.txt"), "Boundary test\n");
      writeFileSync(
        join(agentRunDir, "evidence-manifest.json"),
        `${JSON.stringify({ schemaVersion: 1, artifacts: [] })}\n`,
      );
      const projection = await runWorkflowBlockingOperation(
        projectBuilderAgentRunArtifactsOperation,
        { workspaceDir: projectDir, agentRunDir },
      );
      const criteriaInspection = await runWorkflowBlockingOperation(
        builderRepairCheckOperation,
        {
          kind: "success-criteria-declared",
          projectDir,
          runDirPath: agentRunDir,
        },
      );

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
      const blockedPromotions = await runWorkflowBlockingOperation(
        promoteSatisfiedBlockedTasksOperation,
        { projectDir },
      );
      const scopeInputs: ScopeImprovementInputs = {
        generatedAt: "2026-08-14T12:00:00.000Z",
        triggerKind: "manual",
        triggerEvent: "autonomy.scope-improvement.requested",
        scope: {
          scopeId: "root",
          displayName: "Boundary test",
          directoryRoot: projectDir,
        },
        config: {
          enabled: true,
          minMinutesBetweenRuns: 0,
          maxActionsPerRun: 1,
          allowAutonomousEdits: false,
          writePaths: [],
        },
        state: { scopeId: "root", lastRunAt: null, recentSignatures: [] },
        instructions: [],
        changedFiles: [],
        evidence: [],
        throttle: null,
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
                doneWhen: ["The task is created through the worker operation."],
                acceptanceEvidence: ["Focused worker-boundary test output."],
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
      expect(semanticInspection).toEqual({ status: "no-changes" });
      expect(shadowTargets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "git:workflow-mutation-files" }),
        ]),
      );
      expect(projection).toBe(
        "OK: 4 screened builder evidence file(s) projected and staged",
      );
      expect(criteriaInspection).toMatchObject({ status: "passed" });
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
