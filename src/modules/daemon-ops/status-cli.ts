import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { formatUptime as formatUptimeFromIso, padLabel, terminalWidth, truncateLine } from "./format-utils.js";

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
  return formatUptimeFromIso(new Date(Date.now() - ms).toISOString());
}

export function formatStatusOutput(snap: StatusSnapshot): string {
  const width = terminalWidth();
  const lines: string[] = [];
  const pad = padLabel;

  if (snap.daemonRunning && snap.daemonPid != null) {
    const uptimePart = snap.daemonUptimeMs != null
      ? `, up ${formatUptime(snap.daemonUptimeMs)}`
      : "";
    lines.push(truncateLine(`${pad("Daemon:")}running  (pid ${snap.daemonPid}${uptimePart})`, width));
  } else {
    lines.push(truncateLine(`${pad("Daemon:")}not running  (offline mode)`, width));
  }

  lines.push(truncateLine(`${pad("Runs:")}${snap.activeRuns} active, ${snap.queuedRuns} queued`, width));
  lines.push(truncateLine(`${pad("Sessions:")}${snap.sessions} interactive`, width));

  const approvalSuffix = snap.pendingApprovals > 0 ? "  \u2190 requires attention" : "";
  lines.push(truncateLine(`${pad("Approvals:")}${snap.pendingApprovals} pending${approvalSuffix}`, width));

  if (snap.dailyBudgetUsd != null && snap.dailySpendUsd != null) {
    lines.push(truncateLine(`${pad("Budget:")}$${snap.dailySpendUsd.toFixed(2)} of $${snap.dailyBudgetUsd.toFixed(2)} today`, width));
  } else if (snap.dailySpendUsd != null && snap.dailySpendUsd > 0) {
    lines.push(truncateLine(`${pad("Budget:")}$${snap.dailySpendUsd.toFixed(2)} today`, width));
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
