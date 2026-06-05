import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import {
  PRESET_ENV_VAR,
  resolvePreset,
  resolveTierModel,
} from "#core/model/preset.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type {
  WorkflowPredicate,
  WorkflowRunMetadata,
  WorkflowRunWarning,
} from "#core/workflow/run-types.js";
import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";

const RUN_CHECK_MAX_BUFFER = 10 * 1024 * 1024;
const RUN_CHECK_OUTPUT_TAIL_LIMIT = 20_000;
const SYSTEM_COMMAND_PATH_ENTRIES = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
] as const;

function tailTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const tail = text.slice(-limit);
  const lineBreak = tail.indexOf("\n");
  const clean = lineBreak >= 0 ? tail.slice(lineBreak + 1) : tail;
  return `[... ${text.length - clean.length} chars truncated — showing tail ...]\n${clean}`;
}

function splitPath(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(delimiter).filter((entry) => entry.length > 0);
}

function uniquePath(entries: readonly string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    unique.push(entry);
  }
  return unique.join(delimiter);
}

function collectNodeModulesBinDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, "node_modules", ".bin");
    if (existsSync(candidate)) dirs.push(candidate);
    const parent = dirname(current);
    if (parent === current) return dirs;
    current = parent;
  }
}

function buildRunCheckEnv(cwd: string): NodeJS.ProcessEnv {
  const env = withProtectedGitBareRepositoryEnv();
  const pathValue = uniquePath([
    ...collectNodeModulesBinDirs(cwd),
    dirname(process.execPath),
    ...splitPath(env.PATH),
    ...splitPath(env.Path),
    ...SYSTEM_COMMAND_PATH_ENTRIES,
  ]);
  env.PATH = pathValue;
  if (env.Path !== undefined) env.Path = pathValue;
  return env;
}

export function runCheck(command: string, cwd: string, timeoutMs = 120_000): string {
  const result = spawnSync(command, {
    shell: true,
    cwd,
    env: buildRunCheckEnv(cwd),
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
export const AUTONOMY_AGENT_HANG_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const ACTIVE_AUTONOMY_PRESET = resolvePreset({ env: process.env[PRESET_ENV_VAR] })
  .preset;
// Shipped autonomy workflows must boot in a fresh clone with no operator-local
// `.kota/config.json`, so they resolve through the shipped default preset when
// KOTA_PRESET is unset. When KOTA_PRESET is set, harness + model + effort move
// together and cannot form a cross-provider tuple.
export const AUTONOMY_AGENT_HARNESS = ACTIVE_AUTONOMY_PRESET.harness;

// Tier the autonomy fleet runs at. `tier: "capable"` is what every autonomy
// workflow agent step consumes; the workflow validator resolves it through
// the active preset's `tiers.capable`, so codex/gemini/claude all pick their
// own capable model without per-step edits.
export const AUTONOMY_AGENT_TIER = "capable" as const;

// Single source of truth for the autonomy fleet's model and effort level.
// `model` and `effort` are resolved at module-load time from the active
// preset (`KOTA_PRESET` env > shipped default). Every autonomy workflow
// agent definition spreads this object, and the autonomy-internal judges
// (critic, semantic gate) consume the same `model`/`effort` so a preset
// switch flows through every autonomy surface without per-call edits.
// No literal model id stays in this file — the negative grep test enforces
// that on every CI run.
function buildAutonomyAgentDefaults(): Pick<AgentDef, "model" | "effort"> & {
  tier: typeof AUTONOMY_AGENT_TIER;
} {
  return {
    tier: AUTONOMY_AGENT_TIER,
    model: resolveTierModel(ACTIVE_AUTONOMY_PRESET, AUTONOMY_AGENT_TIER),
    effort: ACTIVE_AUTONOMY_PRESET.defaultEffort,
  };
}

export const AUTONOMY_AGENT_DEFAULTS = buildAutonomyAgentDefaults();

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
    env: withProtectedGitBareRepositoryEnv(),
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
    const mutatedPaths = listWorkflowMutatedPaths(projectDir);
    if (mutatedPaths.length === 0) {
      return "OK: no mutated paths — commit message not required";
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
    env: withProtectedGitBareRepositoryEnv(),
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
