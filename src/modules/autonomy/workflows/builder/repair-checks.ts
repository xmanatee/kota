import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import {
  AUTONOMY_CHANGE_DECISION_CHECK_ID,
  checkAutonomyChangeDecisionForRun,
} from "#modules/autonomy/autonomy-change-decision.js";
import { createCriticCheck } from "#modules/autonomy/critic.js";
import { checkDocBloat } from "#modules/autonomy/doc-bloat-check.js";
import { checkRepoHygiene } from "#modules/autonomy/hygiene-check.js";
import {
  checkObservabilityObligationsForRun,
  OBSERVABILITY_OBLIGATION_WARNING_TYPE,
} from "#modules/autonomy/observability-obligation.js";
import {
  AUTONOMY_FULL_TEST_TIMEOUT_MS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
} from "#modules/autonomy/shared.js";
import { checkSourceFileSize, SOURCE_FILE_SIZE_WARNING_TYPE } from "#modules/autonomy/source-size-check.js";
import {
  SOURCE_FILE_SIZE_SEVERE_TYPE,
} from "#modules/autonomy/source-size-escalation.js";
import { checkSevereSourceFileSizeForRun } from "#modules/autonomy/source-size-review-artifact.js";
import type { QueueTaskClaimResult } from "#modules/autonomy/task-claims.js";
import {
  checkBuilderWorkflowChangesStageable,
  projectAgentRunArtifactsForValidation,
} from "./agent-run-artifacts.js";
import {
  CALIBRATION_REPAIR_EVIDENCE_CHECK_ID,
  checkCalibrationRepairEvidence,
} from "./calibration-repair-evidence-check.js";
import {
  checkMacosSwiftBuild,
  checkMobileTypecheck,
  checkModuleBoundary,
  checkPackageScript,
} from "./project-repair-checks.js";
import {
  checkSuccessCriteriaDeclared,
  checkSuccessCriteriaVerified,
} from "./success-criteria-repair-checks.js";
import {
  checkActionableTaskClaimed,
  checkActionableTaskResolved,
  checkClaimedTaskCommitSet,
  checkClaimedTaskStateStaged,
} from "./task-state-repair-checks.js";
import { builderAgentRunDir, workflowWorkspaceDir } from "./workspace.js";

export { checkCalibrationRepairEvidence } from "./calibration-repair-evidence-check.js";
export { checkModuleBoundary } from "./project-repair-checks.js";
export {
  checkSuccessCriteriaDeclared,
  checkSuccessCriteriaVerified,
} from "./success-criteria-repair-checks.js";
export {
  checkActionableTaskClaimed,
  checkActionableTaskResolved,
  checkClaimedTaskCommitSet,
  checkClaimedTaskStateStaged,
} from "./task-state-repair-checks.js";

export function builderRepairChecks(): WorkflowRepairCheck[] {
  return [
    {
      id: "actionable-task-claimed",
      type: "code" as const,
      run: (ctx) => checkActionableTaskClaimed(workflowWorkspaceDir(ctx), ctx.projectDir),
    },
    {
      id: "success-criteria-declared",
      type: "code" as const,
      run: (ctx) =>
        checkSuccessCriteriaDeclared(builderAgentRunDir(ctx), workflowWorkspaceDir(ctx)),
    },
    {
      id: "success-criteria-verified",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkSuccessCriteriaVerified(builderAgentRunDir(ctx)),
    },
    {
      id: "agent-run-artifacts-ready",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        projectAgentRunArtifactsForValidation(
          builderAgentRunDir(ctx),
          workflowWorkspaceDir(ctx),
        ),
    },
    {
      id: CALIBRATION_REPAIR_EVIDENCE_CHECK_ID,
      type: "code" as const,
      phase: 2,
      run: (ctx) =>
        checkCalibrationRepairEvidence(
          workflowWorkspaceDir(ctx),
          builderAgentRunDir(ctx),
          ctx.stepOutputs["claim-task"] as QueueTaskClaimResult | undefined,
        ),
    },
    {
      id: "actionable-task-resolved",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkActionableTaskResolved(workflowWorkspaceDir(ctx)),
    },
    {
      id: "claimed-task-commit-set",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        checkClaimedTaskCommitSet(
          workflowWorkspaceDir(ctx),
          ctx.stepOutputs["claim-task"] as QueueTaskClaimResult | undefined,
        ),
    },
    {
      id: "build-output",
      type: "code" as const,
      run: (ctx) => checkPackageScript(
        workflowWorkspaceDir(ctx),
        "pnpm build",
        { signal: ctx.signal },
      ),
    },
    {
      id: "workflow-validate",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(
        workflowWorkspaceDir(ctx),
        "pnpm dev workflow validate",
        { signal: ctx.signal },
      ),
    },
    {
      id: "claimed-task-state-staged",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        checkClaimedTaskStateStaged(
          workflowWorkspaceDir(ctx),
          ctx.stepOutputs["claim-task"] as QueueTaskClaimResult | undefined,
        ),
    },
    {
      id: "task-queue-valid",
      type: "code" as const,
      phase: 2,
      run: (ctx) => checkPackageScript(
        workflowWorkspaceDir(ctx),
        "pnpm run validate-tasks",
        { signal: ctx.signal },
      ),
    },
    {
      id: "typecheck",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(
        workflowWorkspaceDir(ctx),
        "pnpm run typecheck",
        { signal: ctx.signal },
      ),
    },
    {
      id: "lint",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        checkPackageScript(
          workflowWorkspaceDir(ctx),
          "pnpm run lint",
          { signal: ctx.signal },
        ),
    },
    {
      id: "test",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(
        workflowWorkspaceDir(ctx),
        "pnpm test",
        { timeoutMs: AUTONOMY_FULL_TEST_TIMEOUT_MS, signal: ctx.signal },
      ),
    },
    {
      id: "mobile-typecheck",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkMobileTypecheck(
        workflowWorkspaceDir(ctx),
        { signal: ctx.signal },
      ),
    },
    {
      id: "macos-swift-build",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkMacosSwiftBuild(
        workflowWorkspaceDir(ctx),
        { signal: ctx.signal },
      ),
    },
    {
      id: "module-boundary",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkModuleBoundary(workflowWorkspaceDir(ctx)),
    },
    {
      id: "no-scratch-artifacts",
      type: "code" as const,
      run: (ctx) => checkNoScratchArtifacts(workflowWorkspaceDir(ctx)),
    },
    {
      id: "doc-bloat",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkDocBloat(workflowWorkspaceDir(ctx)),
    },
    {
      id: "repo-hygiene",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkRepoHygiene(workflowWorkspaceDir(ctx)),
    },
    {
      id: OBSERVABILITY_OBLIGATION_WARNING_TYPE,
      type: "code" as const,
      severity: "warning" as const,
      phase: 1,
      run: (ctx) =>
        checkObservabilityObligationsForRun(
          workflowWorkspaceDir(ctx),
          ctx.workflow.runDirPath,
        ),
    },
    {
      id: AUTONOMY_CHANGE_DECISION_CHECK_ID,
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        checkAutonomyChangeDecisionForRun(
          workflowWorkspaceDir(ctx),
          builderAgentRunDir(ctx),
        ),
    },
    {
      id: SOURCE_FILE_SIZE_SEVERE_TYPE,
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        checkSevereSourceFileSizeForRun(workflowWorkspaceDir(ctx), ctx.workflow.runDirPath),
    },
    {
      id: SOURCE_FILE_SIZE_WARNING_TYPE,
      type: "code" as const,
      severity: "warning" as const,
      phase: 1,
      run: (ctx) => checkSourceFileSize(workflowWorkspaceDir(ctx)),
    },
    {
      id: "commit-message-exists",
      type: "code" as const,
      run: (ctx) =>
        checkCommitMessageExists(builderAgentRunDir(ctx), workflowWorkspaceDir(ctx)),
    },
    {
      id: "commit-stageable",
      type: "code" as const,
      run: (ctx) =>
        checkBuilderWorkflowChangesStageable(
          workflowWorkspaceDir(ctx),
          builderAgentRunDir(ctx),
        ),
    },
    { ...createCriticCheck(), phase: 3 },
  ];
}
