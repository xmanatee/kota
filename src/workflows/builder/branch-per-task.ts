import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../config.js";
import type { WorkflowStepContext } from "../../workflow/run-types.js";
import type { BuilderRunSummary } from "./run-summary.js";

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
  });
  if (result.status !== 0) return null;

  const files = result.stdout.trim().split("\n").filter(Boolean);
  for (const file of files) {
    if (!file.startsWith("tasks/") || !file.endsWith(".md") || file.endsWith("AGENTS.md")) {
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
  });
  return result.stdout.trim() || "main";
}

export function createTaskBranch(ctx: WorkflowStepContext): BranchStepResult {
  const { projectDir } = ctx;
  const config = loadConfig(projectDir);
  const builderConfig = config.extensions?.builder;

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
    { cwd: projectDir, encoding: "utf-8" },
  );

  if (prCreate.status !== 0) {
    throw new Error(`Failed to create pull request: ${prCreate.stderr || prCreate.stdout}`);
  }

  return { prUrl: prCreate.stdout.trim() };
}
