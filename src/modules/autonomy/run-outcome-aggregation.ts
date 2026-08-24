import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { readRepairIterations } from "#core/workflow/repair-iteration-output.js";
import {
  isWorkflowStepTimeoutErrorKind,
  type WorkflowRunMetadata,
} from "#core/workflow/run-types.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";
import type {
  AgentStepTimeout,
  DurationOutlier,
  RepairCheckTally,
  RunOutcomeAggregation,
  WorkflowFailureRate,
} from "./run-outcome-aggregation-types.js";
import type { WorkflowRunSummary } from "./run-summary.js";
import { type RunSummary, summarizeRun } from "./shared.js";

export type { RunOutcomeAggregation } from "./run-outcome-aggregation-types.js";

function computeFailureRates(runs: RunSummary[]): WorkflowFailureRate[] {
  const byWf = new Map<string, { total: number; failures: number }>();
  for (const r of runs) {
    // Interrupted and yielded runs carry no terminal workflow-quality signal.
    // A yield preserves unfinished work for continuation; counting it as a
    // non-failure would make real failure rates look lower than they are.
    if (r.status === "interrupted" || r.status === "yielded") continue;
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

export function tallyRepairFailures(runs: WorkflowRunMetadata[]): RepairCheckTally[] {
  const totals = new Map<
    string,
    {
      workflow: string;
      checkId: string;
      count: number;
      recovered: number;
      terminal: number;
    }
  >();
  for (const run of runs) {
    for (const step of run.steps) {
      // The same preserved repair lineage is tallied when it eventually
      // reaches a terminal outcome. Counting its yield would both duplicate
      // the repair and misclassify the outstanding checks as terminal.
      if (step.status === "yielded") continue;
      const iterations = readRepairIterations(step.output);
      if (iterations.length === 0) continue;
      const stepSucceeded = step.status === "success";
      const lastIter = iterations[iterations.length - 1];
      const terminalIds = stepSucceeded
        ? new Set<string>()
        : new Set((lastIter.failures ?? []).map((f) => f.id));

      const everFailed = new Set<string>();
      for (const iter of iterations) {
        for (const f of iter.failures ?? []) {
          everFailed.add(f.id);
        }
      }

      for (const id of everFailed) {
        const key = `${run.workflow}\0${id}`;
        const entry = totals.get(key) ?? {
          workflow: run.workflow,
          checkId: id,
          count: 0,
          recovered: 0,
          terminal: 0,
        };
        entry.count++;
        if (terminalIds.has(id)) {
          entry.terminal++;
        } else {
          entry.recovered++;
        }
        totals.set(key, entry);
      }
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.count - a.count);
}

const MEANINGFUL_AGENT_STEP_MIN_MS = 1000;

function hasMeaningfulAgentStep(run: WorkflowRunMetadata): boolean {
  return run.steps.some(
    (s) => s.type === "agent" && s.status !== "skipped" && s.durationMs > MEANINGFUL_AGENT_STEP_MIN_MS,
  );
}

export function findDurationOutliers(runs: WorkflowRunMetadata[]): DurationOutlier[] {
  const byWf = new Map<string, WorkflowRunMetadata[]>();
  for (const r of runs) {
    if (r.durationMs == null) continue;
    // Failed runs' durations are dominated by timeout ceilings or retry loops
    // rather than real agent work, so they pollute the signal.
    if (r.status !== "success") continue;
    if (!hasMeaningfulAgentStep(r)) continue;
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

function readCommitSubject(runsDir: string, runId: string): string | undefined {
  const summary = readOptionalJsonFile<WorkflowRunSummary>(
    join(runsDir, runId, "run-summary.json"),
  );
  const message = summary?.commitMessage?.split("\n")[0].trim();
  return message ? message : undefined;
}

function enrichOutliersWithSubjects(
  outliers: DurationOutlier[],
  runsDir: string,
): DurationOutlier[] {
  return outliers.map((outlier) => {
    const commitSubject = readCommitSubject(runsDir, outlier.runId);
    return commitSubject ? { ...outlier, commitSubject } : outlier;
  });
}

type AgentStepTimeoutCandidate = {
  run: WorkflowRunMetadata;
  step: WorkflowRunMetadata["steps"][number];
};

function findAgentStepTimeout(
  run: WorkflowRunMetadata,
): AgentStepTimeoutCandidate | null {
  if (run.status !== "failed") return null;
  for (const step of run.steps) {
    if (step.type !== "agent") continue;
    if (step.status !== "failed") continue;
    if (isWorkflowStepTimeoutErrorKind(step.errorKind)) {
      return { run, step };
    }
  }
  return null;
}

function collectAgentStepTimeouts(
  runs: WorkflowRunMetadata[],
): AgentStepTimeout[] {
  const out: AgentStepTimeout[] = [];
  for (const run of runs) {
    const found = findAgentStepTimeout(run);
    if (!found) continue;
    if (!found.step.completedAt) continue;
    out.push({
      runId: run.id,
      workflow: run.workflow,
      stepId: found.step.id,
      completedAt: found.step.completedAt,
      error: found.step.error!,
    });
  }
  return out.sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
}

function parseAgentFailureSubtype(error: string): string | undefined {
  const match = /\(([^)]+)\):/.exec(error);
  return match?.[1];
}

function hasClassifiedAgentRuntimeFailure(run: WorkflowRunMetadata): boolean {
  if (run.status !== "failed") return false;
  for (const step of run.steps) {
    if (step.type !== "agent") continue;
    if (step.status !== "failed") continue;
    if (typeof step.error !== "string") continue;
    const classified = classifyAgentRuntimeFailure({
      message: step.error,
      subtype: parseAgentFailureSubtype(step.error),
    });
    if (classified !== null) return true;
  }
  return false;
}

export function hasInfrastructureAgentFailure(run: WorkflowRunMetadata): boolean {
  return findAgentStepTimeout(run) !== null || hasClassifiedAgentRuntimeFailure(run);
}

function latestActionableCompletedAt(
  all24h: WorkflowRunMetadata[],
): string | null {
  let latest: string | null = null;
  for (const run of all24h) {
    if (run.workflow === "improver") continue;
    if (!run.completedAt) continue;
    if (run.status !== "failed") continue;
    if (hasInfrastructureAgentFailure(run)) continue;
    if (latest === null || run.completedAt > latest) latest = run.completedAt;
  }
  return latest;
}

export function aggregateRunOutcomes(runsDir: string): RunOutcomeAggregation {
  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;

  const all7d = loadRunsInWindow(runsDir, cutoff7d);
  const all24h = all7d.filter((r) => new Date(r.startedAt).getTime() >= cutoff24h);

  const summaries7d = all7d.map(summarizeRun);
  const summaries24h = all24h.map(summarizeRun);

  const durationOutliers = enrichOutliersWithSubjects(
    findDurationOutliers(all7d).slice(0, 10),
    runsDir,
  );

  return {
    failureRates24h: computeFailureRates(summaries24h),
    failureRates7d: computeFailureRates(summaries7d),
    topRepairFailures24h: tallyRepairFailures(all24h).slice(0, 10),
    topRepairFailures7d: tallyRepairFailures(all7d).slice(0, 10),
    durationOutliers,
    agentStepTimeouts7d: collectAgentStepTimeouts(all7d).slice(0, 10),
    latestActionableRunAt: latestActionableCompletedAt(all24h),
  };
}
