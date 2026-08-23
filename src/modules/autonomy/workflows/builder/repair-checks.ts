import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { AUTONOMY_CHANGE_DECISION_CHECK_ID } from "#modules/autonomy/autonomy-change-decision.js";
import { createCriticCheck } from "#modules/autonomy/critic.js";
import { OBSERVABILITY_OBLIGATION_WARNING_TYPE } from "#modules/autonomy/observability-obligation.js";
import { AUTONOMY_FULL_TEST_TIMEOUT_MS } from "#modules/autonomy/shared.js";
import { SOURCE_FILE_SIZE_WARNING_TYPE } from "#modules/autonomy/source-size-check.js";
import { SOURCE_FILE_SIZE_SEVERE_TYPE } from "#modules/autonomy/source-size-escalation.js";
import type { QueueTaskClaimResult } from "#modules/autonomy/task-claims.js";
import { workflowCommitCheckOperation } from "#modules/autonomy/workflow-commit-operations.js";
import {
  builderMobileTypecheckOperation,
  checkBuilderCommitOperation,
  projectBuilderAgentRunArtifactsOperation,
  runBuilderRepairCheck,
} from "./blocking-operations.js";
import {
  CALIBRATION_REPAIR_EVIDENCE_CHECK_ID,
  checkCalibrationRepairEvidence,
} from "./calibration-repair-evidence-check.js";
import { checkMacosSwiftBuild, checkPackageScript } from "./project-package-checks.js";
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

type CalibrationRepairEvidenceOperationInput = {
  workspaceDir: string;
  agentRunDir: string;
  claim?: QueueTaskClaimResult;
};

export function checkCalibrationRepairEvidenceInWorker(
  input: CalibrationRepairEvidenceOperationInput,
): string {
  return checkCalibrationRepairEvidence(
    input.workspaceDir,
    input.agentRunDir,
    input.claim,
  );
}

const calibrationRepairEvidenceOperation = defineWorkflowBlockingOperation<
  CalibrationRepairEvidenceOperationInput,
  string
>(import.meta.url, "checkCalibrationRepairEvidenceInWorker");

export function builderRepairChecks(): WorkflowRepairCheck[] {
  return [
    {
      id: "actionable-task-claimed",
      type: "code" as const,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "actionable-task-claimed",
          projectDir: workflowWorkspaceDir(ctx),
          claimProjectDir: ctx.projectDir,
        }),
    },
    {
      id: "success-criteria-declared",
      type: "code" as const,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "success-criteria-declared",
          projectDir: workflowWorkspaceDir(ctx),
          runDirPath: builderAgentRunDir(ctx),
        }),
    },
    {
      id: "success-criteria-verified",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "success-criteria-verified",
          runDirPath: builderAgentRunDir(ctx),
        }),
    },
    {
      id: "agent-run-artifacts-ready",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        withWorkflowBlockingOperation(ctx).runBlocking(
          projectBuilderAgentRunArtifactsOperation,
          {
            agentRunDir: builderAgentRunDir(ctx),
            workspaceDir: workflowWorkspaceDir(ctx),
          },
        ),
    },
    {
      id: CALIBRATION_REPAIR_EVIDENCE_CHECK_ID,
      type: "code" as const,
      phase: 2,
      run: (ctx) =>
        withWorkflowBlockingOperation(ctx).runBlocking(
          calibrationRepairEvidenceOperation,
          {
            workspaceDir: workflowWorkspaceDir(ctx),
            agentRunDir: builderAgentRunDir(ctx),
            ...(ctx.stepOutputs["claim-task"] === undefined
              ? {}
              : {
                  claim: ctx.stepOutputs["claim-task"] as QueueTaskClaimResult,
                }),
          },
        ),
    },
    {
      id: "actionable-task-resolved",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "actionable-task-resolved",
          projectDir: workflowWorkspaceDir(ctx),
        }),
    },
    {
      id: "claimed-task-commit-set",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "claimed-task-commit-set",
          projectDir: workflowWorkspaceDir(ctx),
          claim: ctx.stepOutputs["claim-task"] as QueueTaskClaimResult | undefined,
        }),
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
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "claimed-task-state-staged",
          projectDir: workflowWorkspaceDir(ctx),
          claim: ctx.stepOutputs["claim-task"] as QueueTaskClaimResult | undefined,
        }),
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
      run: (ctx) =>
        withWorkflowBlockingOperation(ctx).runBlocking(
          builderMobileTypecheckOperation,
          { projectDir: workflowWorkspaceDir(ctx) },
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
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "module-boundary",
          projectDir: workflowWorkspaceDir(ctx),
        }),
    },
    {
      id: "no-scratch-artifacts",
      type: "code" as const,
      run: (ctx) =>
        withWorkflowBlockingOperation(ctx).runBlocking(workflowCommitCheckOperation, {
          kind: "scratch-artifacts",
          projectDir: workflowWorkspaceDir(ctx),
        }),
    },
    {
      id: "doc-bloat",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "doc-bloat",
          projectDir: workflowWorkspaceDir(ctx),
        }),
    },
    {
      id: "repo-hygiene",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "repo-hygiene",
          projectDir: workflowWorkspaceDir(ctx),
        }),
    },
    {
      id: OBSERVABILITY_OBLIGATION_WARNING_TYPE,
      type: "code" as const,
      severity: "warning" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "observability-obligation",
          projectDir: workflowWorkspaceDir(ctx),
          runDirPath: ctx.workflow.runDirPath,
        }),
    },
    {
      id: AUTONOMY_CHANGE_DECISION_CHECK_ID,
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "autonomy-change-decision",
          projectDir: workflowWorkspaceDir(ctx),
          runDirPath: builderAgentRunDir(ctx),
        }),
    },
    {
      id: SOURCE_FILE_SIZE_SEVERE_TYPE,
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "source-file-size-severe",
          projectDir: workflowWorkspaceDir(ctx),
          runDirPath: ctx.workflow.runDirPath,
        }),
    },
    {
      id: SOURCE_FILE_SIZE_WARNING_TYPE,
      type: "code" as const,
      severity: "warning" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "source-file-size",
          projectDir: workflowWorkspaceDir(ctx),
        }),
    },
    {
      id: "commit-message-exists",
      type: "code" as const,
      run: (ctx) =>
        withWorkflowBlockingOperation(ctx).runBlocking(workflowCommitCheckOperation, {
          kind: "commit-message",
          projectDir: workflowWorkspaceDir(ctx),
          runDirPath: builderAgentRunDir(ctx),
        }),
    },
    {
      id: "commit-stageable",
      type: "code" as const,
      run: (ctx) =>
        withWorkflowBlockingOperation(ctx).runBlocking(checkBuilderCommitOperation, {
          workspaceDir: workflowWorkspaceDir(ctx),
          agentRunDir: builderAgentRunDir(ctx),
        }),
    },
    { ...createCriticCheck(), phase: 3 },
  ];
}
