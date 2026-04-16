import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";
import { computeCostByWorkflow, type RunSummary, summarizeRun } from "./shared.js";

type WorkflowFailureRate = {
  workflow: string;
  total: number;
  failures: number;
  rate: number;
};

type RepairCheckTally = {
  checkId: string;
  count: number;
  recovered: number;
  terminal: number;
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

export function tallyRepairFailures(runs: WorkflowRunMetadata[]): RepairCheckTally[] {
  const totals = new Map<string, { count: number; recovered: number; terminal: number }>();
  for (const run of runs) {
    for (const step of run.steps) {
      const output = step.output as
        | { repairIterations?: Array<{ failures?: Array<{ id: string }> }> }
        | undefined;
      if (!output?.repairIterations?.length) continue;

      const iterations = output.repairIterations;
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
        const entry = totals.get(id) ?? { count: 0, recovered: 0, terminal: 0 };
        entry.count++;
        if (terminalIds.has(id)) {
          entry.terminal++;
        } else {
          entry.recovered++;
        }
        totals.set(id, entry);
      }
    }
  }
  return [...totals.entries()]
    .map(([checkId, { count, recovered, terminal }]) => ({ checkId, count, recovered, terminal }))
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
    durationOutliers: findDurationOutliers(all7d).slice(0, 10),
  };
}
