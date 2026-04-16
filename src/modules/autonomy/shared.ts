import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  WorkflowPredicate,
  WorkflowRunMetadata,
  WorkflowRunWarning,
} from "#core/workflow/run-types.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";

const RUN_CHECK_MAX_BUFFER = 10 * 1024 * 1024;
const RUN_CHECK_OUTPUT_TAIL_LIMIT = 20_000;

function tailTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const tail = text.slice(-limit);
  const lineBreak = tail.indexOf("\n");
  const clean = lineBreak >= 0 ? tail.slice(lineBreak + 1) : tail;
  return `[... ${text.length - clean.length} chars truncated — showing tail ...]\n${clean}`;
}

export function runCheck(command: string, cwd: string, timeoutMs = 120_000): string {
  const result = spawnSync(command, {
    shell: true,
    cwd,
    timeout: timeoutMs,
    encoding: "utf-8",
    maxBuffer: RUN_CHECK_MAX_BUFFER,
  });
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (result.status !== 0) {
    throw new Error(tailTruncate(rawOutput, RUN_CHECK_OUTPUT_TAIL_LIMIT) || `Command failed: ${command}`);
  }
  return rawOutput;
}

export const READY_TASK_TARGET = 4;
export const BACKLOG_TASK_TARGET = 8;
export const AUTONOMY_DISALLOWED_TOOLS = ["Agent", "Task", "EnterWorktree", "ExitWorktree"];

export type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  durationMs?: number;
  totalCostUsd?: number;
  warnings?: WorkflowRunWarning[];
};

export function summarizeRun(metadata: WorkflowRunMetadata): RunSummary {
  return {
    id: metadata.id,
    workflow: metadata.workflow,
    status: metadata.status,
    ...(metadata.durationMs != null ? { durationMs: metadata.durationMs } : {}),
    ...(metadata.totalCostUsd != null ? { totalCostUsd: metadata.totalCostUsd } : {}),
    ...(metadata.warnings != null ? { warnings: metadata.warnings } : {}),
  };
}

export function loadRecentRuns(runsDir: string): RunSummary[] {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  return loadRunsInWindow(runsDir, cutoffMs).slice(0, 20).map(summarizeRun);
}

export function computeCostByWorkflow(runs: RunSummary[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const run of runs) {
    if (run.totalCostUsd != null) {
      result[run.workflow] = (result[run.workflow] ?? 0) + run.totalCostUsd;
    }
  }
  return result;
}

const SCRATCH_ARTIFACT_PREFIXES = [".claude/worktrees/"];
const SCRATCH_WORKTREE_ROOTS = [".claude/worktrees"];

function isWithinDirectory(parentDir: string, childPath: string): boolean {
  const relativePath = relative(parentDir, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function findScratchArtifactPaths(paths: string[]): string[] {
  return paths.filter((f) => SCRATCH_ARTIFACT_PREFIXES.some((p) => f.startsWith(p)));
}

export function findRegisteredScratchWorktrees(projectDir: string): string[] {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const projectRoot = realpathSync(projectDir);
  const scratchRoots = SCRATCH_WORKTREE_ROOTS.map((p) => resolve(projectRoot, p));
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length).trim()))
    .filter((worktreePath) => scratchRoots.some((root) => isWithinDirectory(root, worktreePath)));
}

export function checkNoRegisteredScratchWorktrees(projectDir: string): string {
  const worktrees = findRegisteredScratchWorktrees(projectDir);
  if (worktrees.length > 0) {
    throw new Error(
      `Registered scratch worktrees must be merged or removed before committing:\n${worktrees.map((v) => `  ${v}`).join("\n")}`,
    );
  }
  return "OK: no registered scratch worktrees";
}

export function checkCommitMessageExists(runDirPath: string, projectDir?: string): string {
  if (projectDir) {
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!staged) {
      return "OK: no staged changes — commit message not required";
    }
  }
  const msgPath = join(runDirPath, "commit-message.txt");
  if (!existsSync(msgPath)) {
    throw new Error(
      `Missing commit-message.txt in the run directory (${runDirPath}). ` +
        "Write a short commit message to <run-directory>/commit-message.txt before finishing.",
    );
  }
  const content = readFileSync(msgPath, "utf8").trim();
  if (content.length === 0) {
    throw new Error(
      `commit-message.txt in the run directory is empty. ` +
        "Write a meaningful commit message summarizing the change.",
    );
  }
  return `OK: commit-message.txt present (${content.split("\n").length} line(s))`;
}

export function checkNoScratchArtifacts(projectDir: string): string {
  checkNoRegisteredScratchWorktrees(projectDir);
  const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const violations = findScratchArtifactPaths(staged.split("\n"));
  if (violations.length > 0) {
    throw new Error(
      `Staged scratch artifacts must not be committed:\n${violations.map((v) => `  ${v}`).join("\n")}\n` +
        `Unstage these files with: git reset HEAD ${violations.join(" ")}`,
    );
  }
  return "OK: no scratch artifacts staged";
}

export function stepSucceeded(stepId: string): WorkflowPredicate {
  return ({ stepResults }) => stepResults[stepId]?.status === "success";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stepCommitted(stepId: string): WorkflowPredicate {
  return ({ stepResults, stepOutputs }) => {
    if (stepResults[stepId]?.status !== "success") {
      return false;
    }
    const output = stepOutputs[stepId];
    return Boolean(
      output &&
        typeof output === "object" &&
        "committed" in output &&
        output.committed === true,
    );
  };
}
