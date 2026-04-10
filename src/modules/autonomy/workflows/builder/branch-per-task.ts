import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../../../config.js";
import type { WorkflowStepContext } from "../../../../core/workflow/run-types.js";
import { REPO_TASKS_DIR } from "../../../repo-tasks/repo-tasks.js";
import type { BuilderRunSummary } from "./run-summary.js";

export type CleanupResult = {
  cleaned: string[];
  warnings: string[];
};

export type BranchStepResult = {
  branchPerTask: boolean;
  branch: string | null;
  baseBranch: string | null;
  taskId: string | null;
};

function findTaskIdFromStagedFiles(projectDir: string): string | null {
  const result = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (result.status !== 0) return null;

  const files = result.stdout.trim().split("\n").filter(Boolean);
  for (const file of files) {
    if (
      !file.startsWith(`${REPO_TASKS_DIR}/`) ||
      !file.endsWith(".md") ||
      file.endsWith("AGENTS.md")
    ) {
      continue;
    }
    try {
      const content = readFileSync(join(projectDir, file), "utf-8");
      const idMatch = content.match(/^id:\s+(.+)$/m);
      if (idMatch) return idMatch[1].trim();
    } catch {
      // file moved/deleted at this path, skip
    }
  }
  return null;
}

function getCurrentBranch(projectDir: string): string {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: "pipe",
  });
  return result.stdout.trim() || "main";
}

export function createTaskBranch(ctx: WorkflowStepContext): BranchStepResult {
  const { projectDir } = ctx;
  const config = loadConfig(projectDir);
  const builderConfig = config.modules?.builder;

  if (!builderConfig?.branchPerTask) {
    return { branchPerTask: false, branch: null, baseBranch: null, taskId: null };
  }

  const baseBranch = getCurrentBranch(projectDir);
  const taskId = findTaskIdFromStagedFiles(projectDir);
  const shortRunId = ctx.workflow.runId.replace(/[^a-z0-9]/gi, "-").slice(0, 20);
  const branchSuffix = taskId ?? shortRunId;
  const branch = `kota/task/${branchSuffix}`;

  const checkout = spawnSync("git", ["checkout", "-b", branch], {
    cwd: projectDir,
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

export function createPullRequest(ctx: WorkflowStepContext): { prUrl: string } {
  const { projectDir } = ctx;
  const branchInfo = ctx.stepOutputs["create-task-branch"] as BranchStepResult;
  const summary = ctx.stepOutputs["write-run-summary"] as BuilderRunSummary | undefined;

  const authCheck = spawnSync("gh", ["auth", "status"], {
    cwd: projectDir,
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
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (push.status !== 0) {
    throw new Error(`Failed to push branch ${branch}: ${push.stderr || push.stdout}`);
  }

  const taskTitle = summary?.taskTitle ?? branchInfo.taskId ?? "Builder task";
  const runDir = ctx.workflow.runDir;
  const filesChanged = summary?.filesChanged?.length ?? 0;
  const costUsd = summary?.costUsd != null ? `$${summary.costUsd.toFixed(4)}` : "—";

  const body = [
    `## ${taskTitle}`,
    ``,
    `**Run**: \`${runDir}\``,
    `**Files changed**: ${filesChanged}`,
    `**Cost**: ${costUsd}`,
    ``,
    `*Automated by KOTA builder workflow.*`,
  ].join("\n");

  const prCreate = spawnSync(
    "gh",
    ["pr", "create", "--title", taskTitle, "--body", body, "--base", baseBranch, "--head", branch],
    { cwd: projectDir, encoding: "utf-8", stdio: "pipe" },
  );

  if (prCreate.status !== 0) {
    throw new Error(`Failed to create pull request: ${prCreate.stderr || prCreate.stdout}`);
  }

  // Restore base branch so the daemon restarts on the correct branch for subsequent runs.
  const restore = spawnSync("git", ["checkout", baseBranch], {
    cwd: projectDir,
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

export function cleanupMergedBranches(ctx: WorkflowStepContext): CleanupResult {
  const { projectDir } = ctx;
  const branchInfo = ctx.stepOutputs["create-task-branch"] as BranchStepResult | undefined;
  const cleaned: string[] = [];
  const warnings: string[] = [];

  if (!branchInfo?.branchPerTask) {
    return { cleaned, warnings };
  }

  try {
    const authCheck = spawnSync("gh", ["auth", "status"], {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: "pipe",
    });
    if (authCheck.status !== 0) {
      warnings.push("gh CLI not available; skipping branch cleanup");
      return { cleaned, warnings };
    }

    const listResult = spawnSync(
      "gh",
      ["pr", "list", "--state", "merged", "--json", "headRefName", "--limit", "100"],
      { cwd: projectDir, encoding: "utf-8", stdio: "pipe" },
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

    const currentBranch = branchInfo.branch;
    const toDelete = prs
      .map((pr) => pr.headRefName)
      .filter((b) => b.startsWith("kota/task/") && b !== currentBranch);

    for (const branch of toDelete) {
      const del = spawnSync("git", ["push", "origin", "--delete", branch], {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: "pipe",
      });
      if (del.status !== 0) {
        warnings.push(`Failed to delete branch ${branch}: ${del.stderr || del.stdout}`);
      } else {
        cleaned.push(branch);
      }
    }
  } catch (err) {
    warnings.push(`Unexpected error during branch cleanup: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { cleaned, warnings };
}
