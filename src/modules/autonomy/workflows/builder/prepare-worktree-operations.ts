import { spawnSync } from "node:child_process";
import { loadConfig } from "#core/config/config.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  type AutomationWorktreeInspection,
  continueAutomationWorktree,
  createAutomationWorktree,
  lockAutomationWorktree,
} from "#modules/git/worktree-lifecycle.js";
import { builderWorktreeModeEnabledFromConfig } from "./builder-config.js";

export type BuilderWorkspaceModeInspection = {
  enabled: boolean;
  branch: string | null;
  headCommit: string | null;
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

export function inspectBuilderWorkspaceModeInWorker(input: {
  projectDir: string;
}): BuilderWorkspaceModeInspection {
  return {
    enabled: builderWorktreeModeEnabledFromConfig(loadConfig(input.projectDir)),
    branch: gitOutput(input.projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    headCommit: gitOutput(input.projectDir, ["rev-parse", "HEAD"]),
  };
}

export const inspectBuilderWorkspaceModeOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    BuilderWorkspaceModeInspection
  >(import.meta.url, "inspectBuilderWorkspaceModeInWorker");

type ContinueBuilderWorktreeOperationInput = {
  projectDir: string;
  taskId: string;
  worktreeRunId: string;
  continuationRunId: string;
};

export function continueBuilderWorktreeInWorker(
  input: ContinueBuilderWorktreeOperationInput,
): AutomationWorktreeInspection {
  return continueAutomationWorktree(
    {
      projectDir: input.projectDir,
      taskId: input.taskId,
      runId: input.worktreeRunId,
    },
    input.continuationRunId,
  );
}

export const continueBuilderWorktreeOperation =
  defineWorkflowBlockingOperation<
    ContinueBuilderWorktreeOperationInput,
    AutomationWorktreeInspection
  >(import.meta.url, "continueBuilderWorktreeInWorker");

type CreateBuilderWorktreeOperationInput = {
  projectDir: string;
  taskId: string;
  runId: string;
  workflowId: string;
  owner: string;
  baseRef: string;
};

export function createBuilderWorktreeInWorker(
  input: CreateBuilderWorktreeOperationInput,
): AutomationWorktreeInspection {
  createAutomationWorktree(input);
  return lockAutomationWorktree(
    { projectDir: input.projectDir, taskId: input.taskId, runId: input.runId },
    "builder agent running",
  );
}

export const createBuilderWorktreeOperation =
  defineWorkflowBlockingOperation<
    CreateBuilderWorktreeOperationInput,
    AutomationWorktreeInspection
  >(import.meta.url, "createBuilderWorktreeInWorker");
