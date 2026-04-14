import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  WorkflowPredicate,
  WorkflowRunMetadata,
  WorkflowRunWarning,
} from "#core/workflow/run-types.js";
import { loadRunsInWindow } from "#modules/workflow-ops/workflow-history.js";

export function runCheck(command: string, cwd: string, timeoutMs = 120_000): string {
  const result = spawnSync(command, { shell: true, cwd, timeout: timeoutMs, encoding: "utf-8" });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (result.status !== 0) throw new Error(output || `Command failed: ${command}`);
  return output;
}

export const READY_TASK_TARGET = 4;
export const BACKLOG_TASK_TARGET = 8;

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

// --- Run-outcome aggregation for the improver ---

type WorkflowFailureRate = {
  workflow: string;
  total: number;
  failures: number;
  rate: number;
};

type RepairCheckTally = {
  checkId: string;
  count: number;
};

type CostTrend = {
  workflow: string;
  currentUsd: number;
  previousUsd: number;
  deltaPercent: number | null;
};

type DurationOutlier = {
  runId: string;
  workflow: string;
  durationMs: number;
  medianMs: number;
};

export type RunOutcomeAggregation = {
  failureRates24h: WorkflowFailureRate[];
  failureRates7d: WorkflowFailureRate[];
  topRepairFailures24h: RepairCheckTally[];
  topRepairFailures7d: RepairCheckTally[];
  costTrends: CostTrend[];
  durationOutliers: DurationOutlier[];
};

function computeFailureRates(runs: RunSummary[]): WorkflowFailureRate[] {
  const byWf = new Map<string, { total: number; failures: number }>();
  for (const r of runs) {
    const entry = byWf.get(r.workflow) ?? { total: 0, failures: 0 };
    entry.total++;
    if (r.status === "failed") entry.failures++;
    byWf.set(r.workflow, entry);
  }
  return [...byWf.entries()]
    .map(([workflow, { total, failures }]) => ({
      workflow,
      total,
      failures,
      rate: total > 0 ? failures / total : 0,
    }))
    .sort((a, b) => b.rate - a.rate || b.failures - a.failures);
}

function tallyRepairFailures(runs: WorkflowRunMetadata[]): RepairCheckTally[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const step of run.steps) {
      const output = step.output as
        | { repairIterations?: Array<{ failures?: Array<{ id: string }> }> }
        | undefined;
      if (!output?.repairIterations) continue;
      for (const iter of output.repairIterations) {
        for (const f of iter.failures ?? []) {
          counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
        }
      }
    }
  }
  return [...counts.entries()]
    .map(([checkId, count]) => ({ checkId, count }))
    .sort((a, b) => b.count - a.count);
}

function computeCostTrends(
  currentRuns: RunSummary[],
  previousRuns: RunSummary[],
): CostTrend[] {
  const current = computeCostByWorkflow(currentRuns);
  const previous = computeCostByWorkflow(previousRuns);
  const allWfs = new Set([...Object.keys(current), ...Object.keys(previous)]);
  return [...allWfs]
    .map((workflow) => {
      const cur = current[workflow] ?? 0;
      const prev = previous[workflow] ?? 0;
      return {
        workflow,
        currentUsd: cur,
        previousUsd: prev,
        deltaPercent: prev > 0 ? ((cur - prev) / prev) * 100 : null,
      };
    })
    .sort((a, b) => (b.currentUsd + b.previousUsd) - (a.currentUsd + a.previousUsd));
}

function findDurationOutliers(runs: RunSummary[]): DurationOutlier[] {
  const byWf = new Map<string, RunSummary[]>();
  for (const r of runs) {
    if (r.durationMs == null) continue;
    const list = byWf.get(r.workflow) ?? [];
    list.push(r);
    byWf.set(r.workflow, list);
  }
  const outliers: DurationOutlier[] = [];
  for (const [workflow, wfRuns] of byWf) {
    if (wfRuns.length < 3) continue;
    const sorted = wfRuns.map((r) => r.durationMs!).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const r of wfRuns) {
      if (r.durationMs! > median * 2.5) {
        outliers.push({ runId: r.id, workflow, durationMs: r.durationMs!, medianMs: median });
      }
    }
  }
  return outliers.sort((a, b) => b.durationMs - a.durationMs);
}

export function aggregateRunOutcomes(runsDir: string): RunOutcomeAggregation {
  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;
  const cutoff14d = now - 14 * 24 * 60 * 60 * 1000;

  const all14d = loadRunsInWindow(runsDir, cutoff14d);
  const all7d = all14d.filter((r) => new Date(r.startedAt).getTime() >= cutoff7d);
  const all24h = all7d.filter((r) => new Date(r.startedAt).getTime() >= cutoff24h);
  const previous7d = all14d.filter((r) => {
    const t = new Date(r.startedAt).getTime();
    return t >= cutoff14d && t < cutoff7d;
  });

  const summaries7d = all7d.map(summarizeRun);
  const summaries24h = all24h.map(summarizeRun);
  const previousSummaries = previous7d.map(summarizeRun);

  return {
    failureRates24h: computeFailureRates(summaries24h),
    failureRates7d: computeFailureRates(summaries7d),
    topRepairFailures24h: tallyRepairFailures(all24h).slice(0, 10),
    topRepairFailures7d: tallyRepairFailures(all7d).slice(0, 10),
    costTrends: computeCostTrends(summaries7d, previousSummaries),
    durationOutliers: findDurationOutliers(summaries7d).slice(0, 10),
  };
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
