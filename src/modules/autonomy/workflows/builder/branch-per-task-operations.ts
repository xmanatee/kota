import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "#core/config/config.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { REPO_TASKS_DIR } from "#modules/repo-tasks/repo-tasks-domain.js";
import { builderWorktreeModeEnabledFromConfig } from "./builder-config.js";
import type { BuilderRunSummary } from "./run-summary.js";

export type CleanupResult = { cleaned: string[]; warnings: string[] };

export type BranchStepResult = {
  branchPerTask: boolean;
  branch: string | null;
  baseBranch: string | null;
  taskId: string | null;
};

export type CreateTaskBranchOperationInput = {
  projectDir: string;
  workspaceDir: string;
  runId: string;
  claimedTaskId: string | null;
};

export type CreatePullRequestOperationInput = {
  projectDir: string;
  canonicalProjectDir: string;
  runDir: string;
  branchInfo: BranchStepResult;
  summary?: BuilderRunSummary;
};

export type CleanupMergedBranchesOperationInput = {
  projectDir: string;
  branchInfo?: BranchStepResult;
};

function findTaskIdFromStagedFiles(projectDir: string): string | null {
  const result = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (result.status !== 0) return null;
  for (const file of result.stdout.trim().split("\n").filter(Boolean)) {
    if (
      !file.startsWith(`${REPO_TASKS_DIR}/`) ||
      !file.endsWith(".md") ||
      file.endsWith("AGENTS.md")
    ) continue;
    try {
      const idMatch = readFileSync(join(projectDir, file), "utf-8").match(
        /^id:\s+(.+)$/m,
      );
      if (idMatch) return idMatch[1].trim();
    } catch {
      // A staged task may have moved or been deleted.
    }
  }
  return null;
}

function getCurrentBranch(projectDir: string): string {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  });
  return result.stdout.trim() || "main";
}

export function createTaskBranchInWorker(
  input: CreateTaskBranchOperationInput,
): BranchStepResult {
  const projectDir = input.workspaceDir;
  const config = loadConfig(input.projectDir);
  if (projectDir !== input.projectDir) {
    return {
      branchPerTask: true,
      branch: getCurrentBranch(projectDir),
      baseBranch: getCurrentBranch(input.projectDir),
      taskId: input.claimedTaskId ?? findTaskIdFromStagedFiles(projectDir),
    };
  }
  if (!builderWorktreeModeEnabledFromConfig(config)) {
    return { branchPerTask: false, branch: null, baseBranch: null, taskId: null };
  }
  const baseBranch = getCurrentBranch(projectDir);
  const taskId = findTaskIdFromStagedFiles(projectDir);
  const shortRunId = input.runId.replace(/[^a-z0-9]/gi, "-").slice(0, 20);
  const branch = `kota/task/${taskId ?? shortRunId}`;
  const checkout = spawnSync("git", ["checkout", "-b", branch], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (checkout.status !== 0) {
    throw new Error(
      `Failed to create branch ${branch}: ${checkout.stderr || checkout.stdout}`,
    );
  }
  return { branchPerTask: true, branch, baseBranch, taskId };
}

export const createTaskBranchOperation = defineWorkflowBlockingOperation<
  CreateTaskBranchOperationInput,
  BranchStepResult
>(import.meta.url, "createTaskBranchInWorker");

export function createPullRequestInWorker(
  input: CreatePullRequestOperationInput,
): { prUrl: string } {
  const projectDir = input.projectDir;
  const { branchInfo, summary } = input;
  const authCheck = spawnSync("gh", ["auth", "status"], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (authCheck.status !== 0) {
    throw new Error(
      `gh CLI is not available or not authenticated. ` +
        `Install gh from https://cli.github.com and run 'gh auth login' to enable branch-per-task mode.\n` +
        `${authCheck.stderr || authCheck.stdout}`,
    );
  }
  const branch = branchInfo.branch!;
  const baseBranch = branchInfo.baseBranch ?? "main";
  const push = spawnSync("git", ["push", "origin", branch], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (push.status !== 0) {
    throw new Error(`Failed to push branch ${branch}: ${push.stderr || push.stdout}`);
  }
  const taskTitle = summary?.taskTitle ?? branchInfo.taskId ?? "Builder task";
  const filesChanged = summary?.filesChanged?.length ?? 0;
  const costUsd = summary?.costUsd != null ? `$${summary.costUsd.toFixed(4)}` : "—";
  const body = [
    `## ${taskTitle}`,
    "",
    `**Run**: \`${input.runDir}\``,
    `**Files changed**: ${filesChanged}`,
    `**Cost**: ${costUsd}`,
    "",
    "*Automated by KOTA builder workflow.*",
  ].join("\n");
  const prCreate = spawnSync(
    "gh",
    ["pr", "create", "--title", taskTitle, "--body", body, "--base", baseBranch, "--head", branch],
    { cwd: projectDir, env: withProtectedGitBareRepositoryEnv(), encoding: "utf-8", stdio: "pipe" },
  );
  if (prCreate.status !== 0) {
    throw new Error(`Failed to create pull request: ${prCreate.stderr || prCreate.stdout}`);
  }
  if (projectDir !== input.canonicalProjectDir) {
    return { prUrl: prCreate.stdout.trim() };
  }
  const restore = spawnSync("git", ["checkout", baseBranch], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (restore.status !== 0) {
    throw new Error(
      `PR created but failed to restore base branch ${baseBranch}: ${restore.stderr || restore.stdout}`,
    );
  }
  return { prUrl: prCreate.stdout.trim() };
}

export const createPullRequestOperation = defineWorkflowBlockingOperation<
  CreatePullRequestOperationInput,
  { prUrl: string }
>(import.meta.url, "createPullRequestInWorker");

export function cleanupMergedBranchesInWorker(
  input: CleanupMergedBranchesOperationInput,
): CleanupResult {
  const { projectDir, branchInfo } = input;
  const cleaned: string[] = [];
  const warnings: string[] = [];
  if (!branchInfo?.branchPerTask) return { cleaned, warnings };
  try {
    const authCheck = spawnSync("gh", ["auth", "status"], {
      cwd: projectDir, env: withProtectedGitBareRepositoryEnv(), encoding: "utf-8", stdio: "pipe",
    });
    if (authCheck.status !== 0) {
      warnings.push("gh CLI not available; skipping branch cleanup");
      return { cleaned, warnings };
    }
    const listResult = spawnSync(
      "gh",
      ["pr", "list", "--state", "merged", "--json", "headRefName", "--limit", "100"],
      { cwd: projectDir, env: withProtectedGitBareRepositoryEnv(), encoding: "utf-8", stdio: "pipe" },
    );
    if (listResult.status !== 0) {
      warnings.push(`Failed to list merged PRs: ${listResult.stderr || listResult.stdout}`);
      return { cleaned, warnings };
    }
    let prs: Array<{ headRefName: string }>;
    try {
      prs = JSON.parse(listResult.stdout) as Array<{ headRefName: string }>;
    } catch {
      warnings.push(`Failed to parse gh pr list output: ${listResult.stdout}`);
      return { cleaned, warnings };
    }
    const toDelete = prs
      .map((pr) => pr.headRefName)
      .filter((branch) => branch.startsWith("kota/task/") && branch !== branchInfo.branch);
    for (const branch of toDelete) {
      const deletion = spawnSync("git", ["push", "origin", "--delete", branch], {
        cwd: projectDir, env: withProtectedGitBareRepositoryEnv(), encoding: "utf-8", stdio: "pipe",
      });
      if (deletion.status !== 0) {
        warnings.push(`Failed to delete branch ${branch}: ${deletion.stderr || deletion.stdout}`);
      } else cleaned.push(branch);
    }
  } catch (error) {
    warnings.push(`Unexpected error during branch cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { cleaned, warnings };
}

export const cleanupMergedBranchesOperation = defineWorkflowBlockingOperation<
  CleanupMergedBranchesOperationInput,
  CleanupResult
>(import.meta.url, "cleanupMergedBranchesInWorker");
