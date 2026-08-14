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
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  builderMobileTypecheckOperation,
  reconcileBuilderWorktreesOperation,
} from "#modules/autonomy/workflows/builder/blocking-operations.js";
import { builderTerminalWorktreeFinalizerOperation } from "#modules/autonomy/workflows/builder/terminal-worktree-finalizer-operation.js";
import { dailyDigestBuildOperation } from "#modules/autonomy/workflows/daily-digest/blocking-operations.js";
import { improverRepairCheckOperation } from "#modules/autonomy/workflows/improver/blocking-operations.js";
import {
  securityReviewCandidateScanOperation,
  securityReviewMutationBaselineOperation,
} from "#modules/autonomy/workflows/security-review/blocking-operations.js";
import { createAutomationWorktree } from "#modules/git/worktree-lifecycle.js";

describe("autonomy workflow blocking operations", () => {
  it("loads migrated repository inspections and aggregation through real workers", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-blocking-boundary-"));
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

      const baseline = await runWorkflowBlockingOperation(
        securityReviewMutationBaselineOperation,
        { projectDir },
      );
      const scan = await runWorkflowBlockingOperation(
        securityReviewCandidateScanOperation,
        {
          projectDir,
          runDirPath: join(projectDir, ".kota", "runs", "boundary-test"),
          trigger: {
            event: "autonomy.security-review.requested",
            payload: {},
          },
        },
      );
      const reconciliation = await runWorkflowBlockingOperation(
        reconcileBuilderWorktreesOperation,
        { projectDir },
      );

      const terminalRunId = "terminal-worker-boundary";
      createAutomationWorktree({
        projectDir,
        taskId: "task-terminal-worker-boundary",
        runId: terminalRunId,
        workflowId: "builder",
        owner: "workflow:builder",
      });
      const terminalRunDir = join(projectDir, ".kota", "runs", terminalRunId);
      mkdirSync(terminalRunDir, { recursive: true });
      const terminalMetadata: WorkflowRunMetadata = {
        id: terminalRunId,
        workflow: "builder",
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        startedAt: "2026-08-14T12:00:00.000Z",
        completedAt: "2026-08-14T12:01:00.000Z",
        status: "failed",
        runDir: `.kota/runs/${terminalRunId}`,
        steps: [],
      };
      writeFileSync(
        join(terminalRunDir, "metadata.json"),
        `${JSON.stringify(terminalMetadata, null, 2)}\n`,
      );
      let terminalTimerFired = false;
      const terminalTimer = setTimeout(() => {
        terminalTimerFired = true;
      }, 10);
      const terminalFinalizer = await runWorkflowBlockingOperation(
        builderTerminalWorktreeFinalizerOperation,
        {
          projectDir,
          metadata: terminalMetadata,
          triggerEvent: "manual",
          workspace: {
            taskId: "task-terminal-worker-boundary",
            worktreeRunId: terminalRunId,
          },
          artifactPath: join(
            terminalRunDir,
            "terminal-worktree-finalizer.json",
          ),
        },
      );
      clearTimeout(terminalTimer);

      const digestRunDir = join(projectDir, ".kota", "runs", "digest-boundary");
      mkdirSync(digestRunDir, { recursive: true });
      const digest = await runWorkflowBlockingOperation(
        dailyDigestBuildOperation,
        {
          projectDir,
          runDirPath: digestRunDir,
          windowEndMs: Date.parse("2026-08-14T12:00:00.000Z"),
        },
      );
      const mobile = await runWorkflowBlockingOperation(
        builderMobileTypecheckOperation,
        { projectDir },
      );
      const docBloat = await runWorkflowBlockingOperation(
        improverRepairCheckOperation,
        { kind: "doc-bloat", projectDir },
      );
      const repoHygiene = await runWorkflowBlockingOperation(
        improverRepairCheckOperation,
        { kind: "repo-hygiene", projectDir },
      );

      expect(baseline.preExistingMutatedPaths).toEqual([]);
      expect(scan.candidateCount).toBe(0);
      expect(reconciliation).toMatchObject({ inspected: 0, items: [] });
      expect(terminalTimerFired).toBe(true);
      expect(terminalFinalizer).toEqual({
        recoveryRequest: null,
        logMessages: [],
      });
      expect(
        JSON.parse(
          readFileSync(
            join(terminalRunDir, "terminal-worktree-finalizer.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({
        removed: true,
        claimDisposition: "already-absent",
      });
      expect(digest).toMatchObject({
        data: { quiet: true },
        currentCounts: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
      });
      expect(mobile).toBe("OK: no mobile client present");
      expect(docBloat).toMatch(/^OK:/);
      expect(repoHygiene).toBe("OK: no staged changes");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
