import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  updateAutomationWorktreeRuntimeResources,
} from "#modules/git/worktree-lifecycle.js";
import {
  continueBuilderWorktreeOperation,
  createBuilderWorktreeOperation,
  inspectBuilderWorkspaceModeOperation,
} from "./prepare-worktree-operations.js";
import { findPreservedBuilderEvidenceRunId } from "./preserved-evidence.js";
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
  evidenceRunId?: string,
): Promise<BuilderWorkspaceResult> {
  const runtimeResources = await assignBuilderRuntimeResources({
    projectDir: ctx.projectDir,
    taskId,
    runId: ctx.workflow.runId,
    workspaceDir: inspection.metadata.workspaceDir,
    runDirPath: ctx.workflow.runDirPath,
    ...(evidenceRunId !== undefined ? { evidenceRunId } : {}),
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
        const inspection = await ctx.runBlocking(
          continueBuilderWorktreeOperation,
          {
            projectDir: ctx.projectDir,
            taskId,
            worktreeRunId,
            continuationRunId: ctx.workflow.runId,
          },
        );
        const evidenceRunId = findPreservedBuilderEvidenceRunId(
          inspection.metadata.workspaceDir,
          worktreeRunId,
        );
        return prepareWorktreeResources(
          ctx,
          inspection,
          taskId,
          claimId,
          worktreeRunId,
          evidenceRunId,
        );
      }

      const mode = await ctx.runBlocking(inspectBuilderWorkspaceModeOperation, {
        projectDir: ctx.projectDir,
      });
      if (!mode.enabled) {
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
          branch: mode.branch,
          baseCommit: claim.claim?.baseCommit ?? mode.headCommit,
          headCommit: mode.headCommit,
          taskId,
          claimId,
          claimPath: taskClaimPath(ctx.projectDir, taskId),
          metadataPath: null,
          copiedSetupFiles: [],
        });
      }

      const locked = await ctx.runBlocking(createBuilderWorktreeOperation, {
        projectDir: ctx.projectDir,
        taskId,
        runId: ctx.workflow.runId,
        workflowId: ctx.workflow.name,
        owner: `workflow:${ctx.workflow.name}`,
        baseRef: claim.claim?.baseCommit ?? "HEAD",
      });
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
