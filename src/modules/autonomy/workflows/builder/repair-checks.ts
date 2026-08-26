import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { createCriticCheck } from "#modules/autonomy/critic.js";
import { AUTONOMY_FULL_TEST_TIMEOUT_MS } from "#modules/autonomy/shared.js";
import {
  runBuilderRepairCheck,
} from "./blocking-operations.js";
import { checkMacosSwiftBuild, checkPackageScript } from "./project-package-checks.js";
import { checkMobileTypecheck } from "./project-repair-checks.js";
import { readBuilderTaskReviewContract } from "./task-contract.js";
import { workflowWorkspaceDir } from "./workspace.js";

export function builderRepairChecks(): WorkflowRepairCheck[] {
  return [
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
      ...createCriticCheck({
        resolveTaskReviewContract: readBuilderTaskReviewContract,
      }),
      phase: 3,
    },
  ];
}
