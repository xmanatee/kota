import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const AUTONOMY_ROOT = fileURLToPath(new URL("./", import.meta.url));
const WORKFLOWS_ROOT = resolve(AUTONOMY_ROOT, "workflows");
const INLINE_REVIEW_SURFACES = [
  resolve(AUTONOMY_ROOT, "critic.ts"),
  resolve(AUTONOMY_ROOT, "improver-semantic-gate.ts"),
];

const CODE_STEP_DEFINITION = /\btypedCodeStep\s*<|\btype:\s*["']code["']/;
const DIRECT_BLOCKING_CALL =
  /\b(?:applyAskOutcome|applyAutonomyHealthReviewActions|applyDecompositionPlan|applyOperatorCaptureInstruction|applyOwnerInterventionEscalation|applyProgressReviewActions|applyScopeImprovementRecommendations|applyWorkflowFailureEscalation|checkBuilderWorkflowChangesStageable|checkCommitStageable|checkExplorationRationale|claimPendingBuilderRecovery|cleanupAutomationWorktree|commitBuilderWorkflowChanges|commitWorkflowChanges|createNormalizedTask|createOrUpdateSecurityFindingTasks|discoverRepoAiChecks|execFileSync|execSync|getClaimAwareRepoTaskQueueSnapshot|getRepoTaskQueueSnapshot|getRepoWorktreeStatus|inspectAutomationWorktree|inspectResearchRetryAvailability|inspectScopeImprovementEvidenceGate|inspectSecurityReviewDue|listAutomationWorktreeUniqueCommits|listPendingBuilderRecoveries|markTaskClaimPendingMerge|moveTaskById|promoteSatisfiedBlockedTasks|reconcileAutomationWorktrees|resetWorktreeForRecovery|runValidation|scanAndWriteSecurityReviewCandidates|spawnSync|stageRepoTaskStateMutation|supersedeTaskClaim|writeRepoTaskFile)\s*\(/;
const BLOCKING_IMPLEMENTATION_IMPORT =
  /\bfrom\s*["'](?:#modules\/autonomy\/(?:doc-bloat-check|hygiene-check)\.js|\.\/(?:agent-run-artifacts|project-repair-checks)\.js)["']/;
const DIRECT_REVIEW_INSPECTION_CALL =
  /\b(?:findTaskReviewTarget|getChangedFiles|getStagedDiff|getStagedDiffContent|runProbeIfDeclared|checkProductOperatorEvidence|readCommitMessage|workflowMutationArtifacts)\s*\(/;

function productionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__fixtures__") {
        files.push(...productionTypeScriptFiles(path));
      }
      continue;
    }
    if (
      entry.name.endsWith(".ts") &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".integration.") &&
      !entry.name.includes("test-") &&
      !entry.name.includes("-test")
    ) {
      files.push(path);
    }
  }
  return files;
}

describe("autonomy workflow blocking-operation boundary", () => {
  it("keeps blocking repository and process work out of code-step orchestration", () => {
    const offenders = productionTypeScriptFiles(WORKFLOWS_ROOT)
      .map((path) => ({ path, source: readFileSync(path, "utf8") }))
      .filter(({ source }) => CODE_STEP_DEFINITION.test(source))
      .filter(
        ({ source }) =>
          DIRECT_BLOCKING_CALL.test(source) ||
          BLOCKING_IMPLEMENTATION_IMPORT.test(source),
      )
      .map(({ path }) => relative(WORKFLOWS_ROOT, path))
      .sort();

    expect(offenders).toEqual([]);
  });

  it("keeps judge repository inspection out of inline repair-check bodies", () => {
    const offenders = INLINE_REVIEW_SURFACES
      .filter((path) =>
        DIRECT_REVIEW_INSPECTION_CALL.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(AUTONOMY_ROOT, path));

    expect(offenders).toEqual([]);
  });
});
