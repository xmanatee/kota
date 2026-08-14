import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOWS_ROOT = fileURLToPath(new URL("./workflows/", import.meta.url));

const INLINE_REVIEW_SURFACES = [
  fileURLToPath(new URL("./critic.ts", import.meta.url)),
  fileURLToPath(new URL("./improver-semantic-gate.ts", import.meta.url)),
];

const ALLOWED_WORKER_IMPLEMENTATIONS = new Set([
  "autonomy-health-reviewer/action-operations.ts",
  "autonomy-health-reviewer/health-review.ts",
  "autonomy-health-reviewer/runtime-health-audit-evidence.ts",
  "autonomy-health-reviewer/runtime-health-audit-module-logs.ts",
  "attention-digest/blocked-attention.ts",
  "attention-digest/step.ts",
  "backlog-promoter/blocking-operations.ts",
  "backlog-promoter/promotion.ts",
  "blocked-promoter/blocking-operations.ts",
  "blocked-promoter/promotion.ts",
  "daily-digest/blocking-operations.ts",
  "daily-digest/aggregate.ts",
  "daily-digest/on-demand.ts",
  "decomposer/blocking-operations.ts",
  "decomposer/decomposition-check.ts",
  "decomposer/decomposition-actions.ts",
  "dispatcher/inspection.ts",
  "builder/agent-run-artifacts.ts",
  "builder/agent-run-evidence-filesystem-helper.ts",
  "builder/agent-run-evidence-reader-helper-source.ts",
  "builder/blocking-operations.ts",
  "builder/branch-per-task-operations.ts",
  "builder/claimed-task-consistency-operation.ts",
  "builder/merge-gate-operations.ts",
  "builder/project-repair-checks.ts",
  "builder/prepare-worktree-operations.ts",
  "builder/recovery-continuation.ts",
  "builder/run-summary-operation.ts",
  "builder/run-summary.ts",
  "builder/success-criteria-repair-checks.ts",
  "builder/task-claim-operations.ts",
  "builder/task-state-repair-checks.ts",
  "builder/terminal-worktree-finalizer-operation.ts",
  "evaluator-calibration-monitor/repair-operations.ts",
  "evaluator-calibration-monitor/inspection.ts",
  "explorer/assessment.ts",
  "explorer/exploration-rationale-operation.ts",
  "explorer/exploration-rationale.ts",
  "fan-out-consolidator/blocking-operations.ts",
  "improver/blocking-operations.ts",
  "github-mention-intake/task-support.ts",
  "inbox-sorter/inspect-inbox.ts",
  "owner-intervention-escalator/inspection.ts",
  "owner-intervention-escalator/task-operations.ts",
  "progress-reviewer/progress-review/action-operation.ts",
  "progress-reviewer/progress-review/action-writers.ts",
  "progress-reviewer/progress-review/actions.ts",
  "progress-reviewer/progress-review/artifact-evidence.ts",
  "progress-reviewer/progress-review/git-evidence.ts",
  "progress-reviewer/progress-review/operator-evidence.ts",
  "progress-reviewer/progress-review/run-evidence.ts",
  "repo-ai-checks/blocking-operations.ts",
  "research-retry/blocking-operations.ts",
  "research-retry/candidates.ts",
  "research-retry/precondition.ts",
  "review-scrutiny-escalator/task-operations.ts",
  "review-scrutiny-escalator/inspection.ts",
  "security-review/blocking-operations.ts",
  "security-review/due-check.ts",
  "security-review/security-review-candidate-selection.ts",
  "security-review/security-review-file-scan.ts",
  "security-review/security-review-tasks.ts",
  "scope-improver/evidence-gate.ts",
  "scope-improver/scope-improvement-actions.ts",
  "scope-improver/scope-improvement-discovery.ts",
  "trajectory-diagnostic-escalator/task-operations.ts",
  "trajectory-diagnostic-escalator/inspection.ts",
  "workflow-failure-escalator/task-operations.ts",
  "workflow-failure-escalator/inspection.ts",
]);

const DIRECT_BLOCKING_CALL =
  /\b(?:applyAskOutcome|applyAutonomyHealthReviewActions|applyDecompositionPlan|applyOperatorCaptureInstruction|applyOwnerInterventionEscalation|applyReviewScrutinyEscalation|applyTrajectoryDiagnosticEscalation|applyWorkflowFailureEscalation|buildPromotionRationale|checkBuilderWorkflowChangesStageable|checkCommitStageable|checkExplorationRationale|checkModuleBoundary|checkNoScratchArtifacts|checkCommitMessageExists|checkSevereSourceFileSizeForRun|checkSourceFileSize|claimPendingBuilderRecovery|cleanupAutomationWorktree|commitBuilderWorkflowChanges|commitWorkflowChanges|countRepoTaskState|createNormalizedTask|createOrUpdateSecurityFindingTasks|discoverRepoAiChecks|findTerminalTasksInChangedFiles|getClaimAwareRepoTaskQueueSnapshot|getRepoTaskQueueSnapshot|getRepoWorktreeStatus|inspectResearchRetryAvailability|inspectScopeImprovementEvidenceGate|inspectSecurityReviewDue|listBlockedTasksWithPreconditions|listOperatorCaptureInstructCandidates|listPendingBuilderRecoveries|listRepoTasksInState|markTaskClaimPendingMerge|moveTaskById|promoteSatisfiedBlockedTasks|proposeOwnerInterventionEscalation|proposeReviewScrutinyEscalation|proposeTrajectoryDiagnosticEscalation|proposeWorkflowFailureEscalation|readActiveTaskClaim|recordScopeImprovementEvidenceReady|releaseTaskClaim|requestPendingBuilderRecoveries|resetWorktreeForRecovery|seedFanOutConsolidationTasks|showTask|stageRepoTaskStateMutation|supersedeTaskClaim|writeBuilderRunSummary|writeMarkerForCandidate|writeRepoTaskFile)\s*\(/;

const DIRECT_REPOSITORY_BACKED_CHECK =
  /\b(?:applyCalibrationRepair|applyProgressReviewActions|applyScopeImprovementRecommendations|checkActionableTaskClaimed|checkActionableTaskResolved|checkAutonomyChangeDecisionForRun|checkClaimedTaskCommitSet|checkClaimedTaskStateStaged|checkDocBloat|checkMobileTypecheck|checkObservabilityObligationsForRun|checkRepoHygiene|checkSuccessCriteriaDeclared|checkSuccessCriteriaVerified|projectAgentRunArtifactsForValidation|proposeCalibrationRepair)\s*\(/;

const BLOCKING_IMPLEMENTATION_IMPORT =
  /\b(?:from|export\s+\{[^}]*\}\s+from)\s*["'](?:#modules\/autonomy\/(?:doc-bloat-check|hygiene-check|workflows\/builder\/(?:agent-run-artifacts|project-repair-checks))\.js|\.\/(?:agent-run-artifacts|project-repair-checks)\.js)["']/s;

const CODE_STEP_DEFINITION = /\btypedCodeStep\s*<|\btype:\s*["']code["']/;

const DIRECT_HEAVY_CODE_STEP_CALL =
  /\b(?:execFileSync|execSync|listWorkflowMutatedPaths|spawnSync|readdirSync|tryListWorkflowMutatedPaths|scanAndWriteSecurityReviewCandidates|securityReviewDueTargetsFromPayload|reconcileAutomationWorktrees)\s*\(/;

const INDIRECT_DIGEST_SCAN_IMPORT =
  /\bfrom\s*["']\.\/on-demand\.js["']/;

const DIRECT_TERMINAL_WORKTREE_RECONCILIATION =
  /\b(?:inspectAutomationWorktree|listAutomationWorktreeUniqueCommits|reconcileAutomationWorktrees)\s*\(/;

const DIRECT_REVIEW_INSPECTION_CALL =
  /\b(?:findTaskReviewTarget|getChangedFiles|getStagedDiff|getStagedDiffContent|runProbeIfDeclared|checkProductOperatorEvidence|readCommitMessage|workflowMutationArtifacts)\s*\(/;

function productionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__fixtures__") files.push(...productionTypeScriptFiles(path));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (
      entry.name.includes(".test.") ||
      entry.name.includes(".integration.") ||
      entry.name.includes("test-") ||
      entry.name.includes("-test")
    ) {
      continue;
    }
    files.push(path);
  }
  return files;
}

describe("autonomy workflow blocking-operation boundary", () => {
  it("keeps synchronous repository, Git, commit, and recovery helpers inside worker implementations", () => {
    const offenders = productionTypeScriptFiles(WORKFLOWS_ROOT)
      .map((path) => ({
        path,
        relativePath: relative(WORKFLOWS_ROOT, path),
      }))
      .filter(({ relativePath }) => !ALLOWED_WORKER_IMPLEMENTATIONS.has(relativePath))
      .filter(({ path }) => {
        const source = readFileSync(path, "utf8");
        return (
          DIRECT_BLOCKING_CALL.test(source) ||
          DIRECT_REPOSITORY_BACKED_CHECK.test(source) ||
          BLOCKING_IMPLEMENTATION_IMPORT.test(source) ||
          DIRECT_TERMINAL_WORKTREE_RECONCILIATION.test(source) ||
          DIRECT_HEAVY_CODE_STEP_CALL.test(source) ||
          (CODE_STEP_DEFINITION.test(source) &&
            INDIRECT_DIGEST_SCAN_IMPORT.test(source))
        );
      })
      .map(({ relativePath }) => relativePath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("keeps judge repository inspection out of inline repair-check bodies", () => {
    const offenders = INLINE_REVIEW_SURFACES
      .filter((path) => DIRECT_REVIEW_INSPECTION_CALL.test(readFileSync(path, "utf8")))
      .map((path) => relative(fileURLToPath(new URL("./", import.meta.url)), path));

    expect(offenders).toEqual([]);
  });
});
