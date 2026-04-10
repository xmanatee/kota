import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "../../config.js";
import { WorkflowRunStore } from "../../core/workflow/run-store.js";
import { DaemonControlClient } from "../../core/server/daemon-client.js";
import { getApprovalQueue } from "../../core/daemon/approval-queue.js";

export type StatusSnapshot = {
  daemonRunning: boolean;
  daemonPid?: number;
  daemonUptimeMs?: number;
  activeRuns: number;
  queuedRuns: number;
  sessions: number;
  pendingApprovals: number;
  dailySpendUsd?: number;
  dailyBudgetUsd?: number;
};

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatStatusOutput(snap: StatusSnapshot): string {
  const lines: string[] = [];
  const pad = (label: string) => label.padEnd(12);

  // Daemon line
  if (snap.daemonRunning && snap.daemonPid != null) {
    const uptimePart = snap.daemonUptimeMs != null
      ? `, uptime ${formatUptime(snap.daemonUptimeMs)}`
      : "";
    lines.push(`${pad("Daemon:")}running  (pid ${snap.daemonPid}${uptimePart})`);
  } else {
    lines.push(`${pad("Daemon:")}not running  (offline mode)`);
  }

  lines.push(`${pad("Runs:")}${snap.activeRuns} active, ${snap.queuedRuns} queued`);
  lines.push(`${pad("Sessions:")}${snap.sessions} interactive`);

  const approvalSuffix = snap.pendingApprovals > 0 ? "  \u2190 requires attention" : "";
  lines.push(`${pad("Approvals:")}${snap.pendingApprovals} pending${approvalSuffix}`);

  if (snap.dailyBudgetUsd != null && snap.dailySpendUsd != null) {
    lines.push(`${pad("Budget:")}$${snap.dailySpendUsd.toFixed(2)} of $${snap.dailyBudgetUsd.toFixed(2)} today`);
  } else if (snap.dailySpendUsd != null && snap.dailySpendUsd > 0) {
    lines.push(`${pad("Budget:")}$${snap.dailySpendUsd.toFixed(2)} today`);
  }

  return lines.join("\n");
}

export async function gatherStatus(projectDir: string): Promise<StatusSnapshot> {
  const stateDir = join(projectDir, ".kota");
  const client = DaemonControlClient.fromStateDir(stateDir);
  const config = loadConfig(projectDir);

  if (client) {
    const status = await client.getDaemonStatus();
    if (status) {
      const uptimeMs = status.startedAt
        ? Date.now() - new Date(status.startedAt).getTime()
        : undefined;
      const approvalResult = await client.listApprovals();
      const pendingApprovals = approvalResult
        ? approvalResult.approvals.filter((a) => a.status === "pending").length
        : 0;
      const store = new WorkflowRunStore(projectDir);
      const dailySpend = store.getDailySpendUsd();

      return {
        daemonRunning: true,
        daemonPid: status.pid ?? undefined,
        daemonUptimeMs: uptimeMs,
        activeRuns: status.workflow.activeRuns.length,
        queuedRuns: status.workflow.queueLength,
        sessions: status.sessions.length,
        pendingApprovals,
        dailySpendUsd: dailySpend > 0 ? dailySpend : undefined,
        dailyBudgetUsd: config.dailyBudgetUsd,
      };
    }
  }

  // Standalone mode: read from disk when no daemon is running
  const store = new WorkflowRunStore(projectDir);
  const state = store.readState();
  const queue = getApprovalQueue(join(stateDir, "approvals"));
  const pendingApprovals = queue.count("pending");
  const dailySpend = store.getDailySpendUsd();

  return {
    daemonRunning: false,
    activeRuns: (state.activeRuns ?? []).length,
    queuedRuns: (state.pendingRuns ?? []).length,
    sessions: 0,
    pendingApprovals,
    dailySpendUsd: dailySpend > 0 ? dailySpend : undefined,
    dailyBudgetUsd: config.dailyBudgetUsd,
  };
}

export function buildStatusCommand(): Command {
  return new Command("status")
    .description("Show a concise operational snapshot: daemon, active runs, approvals, and cost")
    .action(async () => {
      const projectDir = process.cwd();
      const snap = await gatherStatus(projectDir);
      console.log(formatStatusOutput(snap));
      if (snap.pendingApprovals > 0) process.exit(1);
    });
}
