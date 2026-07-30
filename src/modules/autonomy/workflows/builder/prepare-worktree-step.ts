import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "#core/config/config.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
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
  type AutomationWorktreeInspection,
  continueAutomationWorktree,
  createAutomationWorktree,
  lockAutomationWorktree,
  updateAutomationWorktreeRuntimeResources,
} from "#modules/git/worktree-lifecycle.js";
import { builderWorktreeModeEnabledFromConfig } from "./builder-config.js";
import {
  assignBuilderRuntimeResources,
  type BuilderRuntimeResourceProfile,
} from "./runtime-resources.js";

export type BuilderWorkspaceResult = {
  enabled: boolean;
  projectDir: string;
  workspaceDir: string;
  runtimeResources: BuilderRuntimeResourceProfile;
  branch: string | null;
  baseCommit: string | null;
  headCommit: string | null;
  taskId: string | null;
  claimId: string | null;
  worktreeRunId?: string;
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

async function prepareWorktreeResources(
  ctx: WorkflowStepContext,
  inspection: AutomationWorktreeInspection,
  taskId: string,
  claimId: string,
  worktreeRunId: string,
): Promise<BuilderWorkspaceResult> {
  const runtimeResources = await assignBuilderRuntimeResources({
    projectDir: ctx.projectDir,
    taskId,
    runId: ctx.workflow.runId,
    workspaceDir: inspection.metadata.workspaceDir,
    runDirPath: ctx.workflow.runDirPath,
  });
  updateAutomationWorktreeRuntimeResources(
    { projectDir: ctx.projectDir, taskId, runId: worktreeRunId },
    {
      profileId: runtimeResources.profileId,
      agentRunDir: runtimeResources.agentRunDir,
      tempRoot: runtimeResources.tempRoot,
      artifactRoot: runtimeResources.artifactRoot,
      ports: runtimeResources.ports,
    },
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
    runtimeResources,
    branch: inspection.branch,
    baseCommit: inspection.baseCommit,
    headCommit: inspection.headCommit,
    taskId,
    claimId,
    claimPath: taskClaimPath(ctx.projectDir, taskId),
    metadataPath: inspection.metadataPath,
    copiedSetupFiles: inspection.metadata.copiedSetupFiles,
    ...(worktreeRunId !== ctx.workflow.runId ? { worktreeRunId } : {}),
  });
}

export function createPrepareBuilderWorktreeStep(
  claimTaskStep: TypedCodeStepInput<QueueTaskClaimResult>,
): TypedCodeStepInput<BuilderWorkspaceResult> {
  return typedCodeStep<BuilderWorkspaceResult>({
    id: "prepare-worktree",
    type: "code",
    updatesWorkspaceDir: true,
    updatesRuntimeResources: true,
    when: (ctx) => claimTaskStep.output(ctx)?.claimed === true,
    validate: (raw) =>
      expectStructuredOutput<BuilderWorkspaceResult>(raw, [
        "enabled",
        "projectDir",
        "workspaceDir",
        "runtimeResources",
        "taskId",
        "claimId",
      ]),
    run: async (ctx) => {
      const claim = claimTaskStep.outputRequired(ctx);
      const taskId = claim.taskId;
      if (!taskId) throw new Error("Cannot prepare a builder worktree without a claimed task id");

      const claimId = `${taskId}:${ctx.workflow.runId}`;
      if (claim.recoveryPath === "continued-preserved-claim") {
        const worktreeRunId = claim.claim?.worktreeRunId;
        if (!worktreeRunId) {
          throw new Error(`Recovery claim for ${taskId} does not identify its preserved worktree`);
        }
        const inspection = continueAutomationWorktree(
          { projectDir: ctx.projectDir, taskId, runId: worktreeRunId },
          ctx.workflow.runId,
        );
        return prepareWorktreeResources(
          ctx,
          inspection,
          taskId,
          claimId,
          worktreeRunId,
        );
      }

      if (!builderWorktreeModeEnabled(ctx.projectDir)) {
        const workspaceDir = ctx.workspaceDir ?? ctx.projectDir;
        const runtimeResources = await assignBuilderRuntimeResources({
          projectDir: ctx.projectDir,
          taskId,
          runId: ctx.workflow.runId,
          workspaceDir,
          runDirPath: ctx.workflow.runDirPath,
        });
        return writeWorkspaceArtifact(ctx.workflow.runDirPath, {
          enabled: false,
          projectDir: ctx.projectDir,
          workspaceDir,
          runtimeResources,
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

      createAutomationWorktree({
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
      return prepareWorktreeResources(
        ctx,
        locked,
        taskId,
        claimId,
        ctx.workflow.runId,
      );
    },
  });
}
