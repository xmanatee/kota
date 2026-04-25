import type { ServerResponse } from "node:http";
import type { WorkflowActiveRun } from "#core/workflow/run-types.js";
import { getApprovalQueue } from "./approval-queue.js";
import type { DaemonControlHandle, WorkflowDurationHistogramEntry, WorkflowMetricCounts } from "./daemon-control-types.js";

function sanitizeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function buildDurationHistogram(entries: WorkflowDurationHistogramEntry[]): string[] {
  if (entries.length === 0) return [];
  const lines: string[] = [];
  lines.push("# HELP kota_workflow_run_duration_seconds Duration of completed workflow runs in seconds");
  lines.push("# TYPE kota_workflow_run_duration_seconds histogram");
  for (const entry of entries) {
    const wf = sanitizeLabelValue(entry.workflow);
    const st = sanitizeLabelValue(entry.status);
    for (const { le, count } of entry.buckets) {
      lines.push(`kota_workflow_run_duration_seconds_bucket{workflow="${wf}",status="${st}",le="${le}"} ${count}`);
    }
    lines.push(`kota_workflow_run_duration_seconds_sum{workflow="${wf}",status="${st}"} ${entry.sum}`);
    lines.push(`kota_workflow_run_duration_seconds_count{workflow="${wf}",status="${st}"} ${entry.count}`);
  }
  return lines;
}

function buildPrometheusMetrics(
  metricCounts: WorkflowMetricCounts,
  activeSessions: number,
  pendingApprovals: number,
  dispatchPaused: boolean,
  activeRuns: WorkflowActiveRun[],
  queueLength: number,
): string {
  const lines: string[] = [];

  lines.push("# HELP kota_workflow_runs_total Lifetime workflow run counts by workflow and status");
  lines.push("# TYPE kota_workflow_runs_total counter");
  for (const entry of metricCounts.runCounts) {
    const wf = sanitizeLabelValue(entry.workflow);
    const st = sanitizeLabelValue(entry.status);
    lines.push(`kota_workflow_runs_total{workflow="${wf}",status="${st}"} ${entry.count}`);
  }

  lines.push("# HELP kota_workflow_cost_usd_total Cumulative agent spend in USD per workflow");
  lines.push("# TYPE kota_workflow_cost_usd_total counter");
  for (const entry of metricCounts.costTotals) {
    const wf = sanitizeLabelValue(entry.workflow);
    lines.push(`kota_workflow_cost_usd_total{workflow="${wf}"} ${entry.costUsd}`);
  }

  lines.push("# HELP kota_active_sessions_total Current number of active interactive sessions");
  lines.push("# TYPE kota_active_sessions_total gauge");
  lines.push(`kota_active_sessions_total ${activeSessions}`);

  lines.push("# HELP kota_pending_approvals_total Current number of pending approval requests");
  lines.push("# TYPE kota_pending_approvals_total gauge");
  lines.push(`kota_pending_approvals_total ${pendingApprovals}`);

  lines.push("# HELP kota_dispatch_paused 1 if workflow dispatch is paused, 0 otherwise");
  lines.push("# TYPE kota_dispatch_paused gauge");
  lines.push(`kota_dispatch_paused ${dispatchPaused ? 1 : 0}`);

  const runsByWorkflow = new Map<string, number>();
  for (const run of activeRuns) {
    runsByWorkflow.set(run.workflow, (runsByWorkflow.get(run.workflow) ?? 0) + 1);
  }
  lines.push("# HELP kota_workflow_active_runs Current number of actively executing runs per workflow");
  lines.push("# TYPE kota_workflow_active_runs gauge");
  for (const [wf, count] of runsByWorkflow) {
    lines.push(`kota_workflow_active_runs{workflow="${sanitizeLabelValue(wf)}"} ${count}`);
  }

  lines.push("# HELP kota_workflow_queued_runs Total number of runs currently waiting in the dispatch queue");
  lines.push("# TYPE kota_workflow_queued_runs gauge");
  lines.push(`kota_workflow_queued_runs ${queueLength}`);

  for (const line of buildDurationHistogram(metricCounts.durationHistogram)) {
    lines.push(line);
  }

  lines.push("");
  return lines.join("\n");
}

export function handleMetrics(handle: DaemonControlHandle, res: ServerResponse): void {
  const metricCounts = handle.getWorkflowMetricCounts();
  const activeSessions = handle.listSessions().length;
  const pendingApprovals = getApprovalQueue().count("pending");
  const { paused, activeRuns, queueLength } = handle.getWorkflowLiveStatus();
  const body = buildPrometheusMetrics(metricCounts, activeSessions, pendingApprovals, paused, activeRuns, queueLength);
  res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
  res.end(body);
}
