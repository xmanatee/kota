import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { checkCommitStageable } from "#modules/autonomy/commit.js";
import { createCriticCheck } from "#modules/autonomy/critic.js";
import { checkDocBloat } from "#modules/autonomy/doc-bloat-check.js";
import { checkRepoHygiene } from "#modules/autonomy/hygiene-check.js";
import { checkCommitMessageExists, checkNoScratchArtifacts } from "#modules/autonomy/shared.js";
import { checkSourceFileSize, SOURCE_FILE_SIZE_WARNING_TYPE } from "#modules/autonomy/source-size-check.js";
import {
  SOURCE_FILE_SIZE_SEVERE_TYPE,
} from "#modules/autonomy/source-size-escalation.js";
import { checkSevereSourceFileSizeForRun } from "#modules/autonomy/source-size-review-artifact.js";
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
} from "./task-state-repair-checks.js";

export { checkModuleBoundary } from "./project-repair-checks.js";
export {
  checkSuccessCriteriaDeclared,
  checkSuccessCriteriaVerified,
} from "./success-criteria-repair-checks.js";
export {
  checkActionableTaskClaimed,
  checkActionableTaskResolved,
} from "./task-state-repair-checks.js";

export function builderRepairChecks(): WorkflowRepairCheck[] {
  return [
    {
      id: "actionable-task-claimed",
      type: "code" as const,
      run: (ctx) => checkActionableTaskClaimed(ctx.projectDir),
    },
    {
      id: "success-criteria-declared",
      type: "code" as const,
      run: (ctx) => checkSuccessCriteriaDeclared(ctx.workflow.runDirPath, ctx.projectDir),
    },
    {
      id: "success-criteria-verified",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkSuccessCriteriaVerified(ctx.workflow.runDirPath),
    },
    {
      id: "actionable-task-resolved",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkActionableTaskResolved(ctx.projectDir),
    },
    {
      id: "build-output",
      type: "code" as const,
      run: (ctx) => checkPackageScript(ctx.projectDir, "pnpm build"),
    },
    {
      id: "workflow-validate",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(ctx.projectDir, "pnpm dev workflow validate"),
    },
    {
      id: "task-queue-valid",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(ctx.projectDir, "pnpm run validate-tasks"),
    },
    {
      id: "typecheck",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(ctx.projectDir, "pnpm run typecheck"),
    },
    {
      id: "lint",
      type: "code" as const,
      phase: 1,
      run: (ctx) =>
        checkPackageScript(ctx.projectDir, "pnpm run lint:fix && git add -u && pnpm run lint"),
    },
    {
      id: "test",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkPackageScript(ctx.projectDir, "pnpm test", 300_000),
    },
    {
      id: "mobile-typecheck",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkMobileTypecheck(ctx.projectDir),
    },
    {
      id: "macos-swift-build",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkMacosSwiftBuild(ctx.projectDir),
    },
    {
      id: "module-boundary",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkModuleBoundary(ctx.projectDir),
    },
    {
      id: "no-scratch-artifacts",
      type: "code" as const,
      run: (ctx) => checkNoScratchArtifacts(ctx.projectDir),
    },
    {
      id: "doc-bloat",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkDocBloat(ctx.projectDir),
    },
    {
      id: "repo-hygiene",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkRepoHygiene(ctx.projectDir),
    },
    {
      id: SOURCE_FILE_SIZE_SEVERE_TYPE,
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkSevereSourceFileSizeForRun(ctx.projectDir, ctx.workflow.runDirPath),
    },
    {
      id: SOURCE_FILE_SIZE_WARNING_TYPE,
      type: "code" as const,
      severity: "warning" as const,
      phase: 1,
      run: (ctx) => checkSourceFileSize(ctx.projectDir),
    },
    {
      id: "commit-message-exists",
      type: "code" as const,
      run: (ctx) => checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir),
    },
    {
      id: "commit-stageable",
      type: "code" as const,
      run: (ctx) => checkCommitStageable(ctx.projectDir),
    },
    { ...createCriticCheck(), phase: 2 },
  ];
}
