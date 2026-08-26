import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { AUTONOMY_CHANGE_DECISION_CHECK_ID } from "#modules/autonomy/autonomy-change-decision.js";
import { createCriticCheck } from "#modules/autonomy/critic.js";
import { OBSERVABILITY_OBLIGATION_WARNING_TYPE } from "#modules/autonomy/observability-obligation.js";
import { AUTONOMY_FULL_TEST_TIMEOUT_MS } from "#modules/autonomy/shared.js";
import { SOURCE_FILE_SIZE_WARNING_TYPE } from "#modules/autonomy/source-size-check.js";
import { SOURCE_FILE_SIZE_SEVERE_TYPE } from "#modules/autonomy/source-size-escalation.js";
import {
  runBuilderRepairCheck,
} from "./blocking-operations.js";
import {
  CALIBRATION_REPAIR_EVIDENCE_CHECK_ID,
  checkCalibrationRepairEvidence,
} from "./calibration-repair-evidence-check.js";
import { checkMacosSwiftBuild, checkPackageScript } from "./project-package-checks.js";
import { checkMobileTypecheck } from "./project-repair-checks.js";
import { readBuilderTaskReviewContract } from "./task-contract.js";
import { builderAgentRunDir, workflowWorkspaceDir } from "./workspace.js";

export { checkCalibrationRepairEvidence } from "./calibration-repair-evidence-check.js";

export function builderRepairChecks(): WorkflowRepairCheck[] {
  return [
    {
      id: "success-criteria-declared",
      type: "code" as const,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "success-criteria-declared",
          projectDir: workflowWorkspaceDir(ctx),
          runDirPath: builderAgentRunDir(ctx),
          taskContract: readBuilderTaskReviewContract(ctx.trigger.payload),
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
      id: CALIBRATION_REPAIR_EVIDENCE_CHECK_ID,
      type: "code" as const,
      phase: 2,
      run: (ctx) =>
        checkCalibrationRepairEvidence(
          workflowWorkspaceDir(ctx),
          builderAgentRunDir(ctx),
          ctx.runtimeResources?.env.KOTA_RUN_ARTIFACT_DIR ??
            ctx.workflow.runDirPath,
          String(ctx.trigger.payload.taskId),
          ctx.runCommand,
        ),
    },
    {
      id: "target-task-resolved",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        runBuilderRepairCheck(withWorkflowBlockingOperation(ctx), {
          kind: "target-task-resolved",
          projectDir: workflowWorkspaceDir(ctx),
          taskId: String(ctx.trigger.payload.taskId),
        }),
    },
    {
      id: "build-output",
      type: "code" as const,
      run: (ctx) => checkPackageScript(
        ctx,
        workflowWorkspaceDir(ctx),
        { command: "pnpm", args: ["build"] },
      ),
    },
    {
      id: "workflow-validate",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(
        ctx,
        workflowWorkspaceDir(ctx),
        { command: "pnpm", args: ["dev", "workflow", "validate"] },
      ),
    },
    {
      id: "task-queue-valid",
      type: "code" as const,
      phase: 2,
      run: (ctx) => checkPackageScript(
        ctx,
        workflowWorkspaceDir(ctx),
        { command: "pnpm", args: ["run", "validate-tasks"] },
      ),
    },
    {
      id: "typecheck",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(
        ctx,
        workflowWorkspaceDir(ctx),
        { command: "pnpm", args: ["run", "typecheck"] },
      ),
    },
    {
      id: "lint",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        checkPackageScript(
          ctx,
          workflowWorkspaceDir(ctx),
          { command: "pnpm", args: ["run", "lint"] },
        ),
    },
    {
      id: "test",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(
        ctx,
        workflowWorkspaceDir(ctx),
        {
          command: "pnpm",
          args: ["test"],
          timeoutMs: AUTONOMY_FULL_TEST_TIMEOUT_MS,
        },
      ),
    },
    {
      id: "mobile-typecheck",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkMobileTypecheck(ctx, workflowWorkspaceDir(ctx)),
    },
    {
      id: "macos-swift-build",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkMacosSwiftBuild(ctx, workflowWorkspaceDir(ctx)),
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
      ...createCriticCheck({
        resolveTaskReviewContract: readBuilderTaskReviewContract,
      }),
      phase: 3,
    },
  ];
}
