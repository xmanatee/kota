import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "#core/config/config.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  expectStructuredOutput,
  type TypedCodeStepInput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import {
  type QueueTaskClaimResult,
  taskClaimPath,
  updateTaskClaimWorkspace,
} from "#modules/autonomy/task-claims.js";
import {
  createAutomationWorktree,
  lockAutomationWorktree,
} from "#modules/git/worktree-lifecycle.js";
import { builderWorktreeModeEnabledFromConfig } from "./builder-config.js";

export type BuilderWorkspaceResult = {
  enabled: boolean;
  projectDir: string;
  workspaceDir: string;
  branch: string | null;
  baseCommit: string | null;
  headCommit: string | null;
  taskId: string | null;
  claimId: string | null;
  claimPath: string | null;
  metadataPath: string | null;
  copiedSetupFiles: string[];
};

function gitOutput(repoDir: string, args: string[]): string | null {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function builderWorktreeModeEnabled(projectDir: string): boolean {
  return builderWorktreeModeEnabledFromConfig(loadConfig(projectDir));
}

function writeWorkspaceArtifact(
  runDirPath: string,
  result: BuilderWorkspaceResult,
): BuilderWorkspaceResult {
  const artifactPath = join(runDirPath, "builder-workspace.json");
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf-8",
  );
  return result;
}

export function createPrepareBuilderWorktreeStep(
  claimTaskStep: TypedCodeStepInput<QueueTaskClaimResult>,
): TypedCodeStepInput<BuilderWorkspaceResult> {
  return typedCodeStep<BuilderWorkspaceResult>({
    id: "prepare-worktree",
    type: "code",
    updatesWorkspaceDir: true,
    when: (ctx) => claimTaskStep.output(ctx)?.claimed === true,
    validate: (raw) =>
      expectStructuredOutput<BuilderWorkspaceResult>(raw, [
        "enabled",
        "projectDir",
        "workspaceDir",
        "taskId",
        "claimId",
      ]),
    run: (ctx) => {
      const claim = claimTaskStep.outputRequired(ctx);
      const taskId = claim.taskId;
      if (!taskId) throw new Error("Cannot prepare a builder worktree without a claimed task id");

      const claimId = `${taskId}:${ctx.workflow.runId}`;
      if (!builderWorktreeModeEnabled(ctx.projectDir)) {
        return writeWorkspaceArtifact(ctx.workflow.runDirPath, {
          enabled: false,
          projectDir: ctx.projectDir,
          workspaceDir: ctx.workspaceDir ?? ctx.projectDir,
          branch: gitOutput(ctx.projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
          baseCommit: claim.claim?.baseCommit ?? gitOutput(ctx.projectDir, ["rev-parse", "HEAD"]),
          headCommit: gitOutput(ctx.projectDir, ["rev-parse", "HEAD"]),
          taskId,
          claimId,
          claimPath: taskClaimPath(ctx.projectDir, taskId),
          metadataPath: null,
          copiedSetupFiles: [],
        });
      }

      const inspection = createAutomationWorktree({
        projectDir: ctx.projectDir,
        taskId,
        runId: ctx.workflow.runId,
        workflowId: ctx.workflow.name,
        owner: `workflow:${ctx.workflow.name}`,
        baseRef: claim.claim?.baseCommit ?? "HEAD",
      });
      const locked = lockAutomationWorktree(
        { projectDir: ctx.projectDir, taskId, runId: ctx.workflow.runId },
        "builder agent running",
      );
      const claimUpdate = updateTaskClaimWorkspace({
        projectDir: ctx.projectDir,
        taskId,
        runId: ctx.workflow.runId,
        workflowId: ctx.workflow.name,
        workspaceDir: inspection.metadata.workspaceDir,
        branch: inspection.branch,
        baseCommit: inspection.baseCommit,
        evidence: `prepared builder worktree ${inspection.metadata.workspaceDir}`,
      });
      if (!claimUpdate.changed || !claimUpdate.claim) {
        throw new Error(
          claimUpdate.reason ?? `Failed to update task claim workspace for ${taskId}`,
        );
      }

      return writeWorkspaceArtifact(ctx.workflow.runDirPath, {
        enabled: true,
        projectDir: ctx.projectDir,
        workspaceDir: inspection.metadata.workspaceDir,
        branch: inspection.branch,
        baseCommit: inspection.baseCommit,
        headCommit: locked.headCommit,
        taskId,
        claimId,
        claimPath: taskClaimPath(ctx.projectDir, taskId),
        metadataPath: inspection.metadataPath,
        copiedSetupFiles: inspection.metadata.copiedSetupFiles,
      });
    },
  });
}
