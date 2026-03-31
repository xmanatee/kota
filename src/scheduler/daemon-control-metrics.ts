import type { ServerResponse } from "node:http";
import type { DaemonControlHandle, WorkflowMetricCounts } from "./daemon-control-types.js";

function sanitizeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function buildPrometheusMetrics(
  metricCounts: WorkflowMetricCounts,
  activeSessions: number,
  pendingApprovals: number,
  dispatchPaused: boolean,
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

  lines.push("");
  return lines.join("\n");
}

export function handleMetrics(handle: DaemonControlHandle, res: ServerResponse): void {
  const metricCounts = handle.getWorkflowMetricCounts();
  const activeSessions = handle.listSessions().length;
  const pendingApprovals = handle.listApprovals().length;
  const { paused } = handle.getWorkflowLiveStatus();
  const body = buildPrometheusMetrics(metricCounts, activeSessions, pendingApprovals, paused);
  res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
  res.end(body);
}
