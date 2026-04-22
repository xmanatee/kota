import { join } from "node:path";
import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { kvBlock, type RenderNode } from "#modules/rendering/primitives.js";
import { print, renderToString } from "#modules/rendering/transport.js";
import { formatUptime as formatUptimeFromIso } from "./format-utils.js";

export type StatusSnapshot = {
  daemonRunning: boolean;
  daemonPid?: number;
  daemonUptimeMs?: number;
  activeRuns: number;
  queuedRuns: number;
  sessions: number;
  pendingApprovals: number;
};

function formatUptime(ms: number): string {
  return formatUptimeFromIso(new Date(Date.now() - ms).toISOString());
}

export function buildStatusNode(snap: StatusSnapshot): RenderNode {
  const daemonValue = snap.daemonRunning && snap.daemonPid != null
    ? `running  (pid ${snap.daemonPid}${snap.daemonUptimeMs != null ? `, up ${formatUptime(snap.daemonUptimeMs)}` : ""})`
    : "not running  (offline mode)";

  const approvalSuffix = snap.pendingApprovals > 0 ? "  ← requires attention" : "";

  return kvBlock([
    { label: "Daemon", value: daemonValue, role: snap.daemonRunning ? "success" : "muted" },
    { label: "Runs", value: `${snap.activeRuns} active, ${snap.queuedRuns} queued` },
    { label: "Sessions", value: `${snap.sessions} interactive` },
    {
      label: "Approvals",
      value: `${snap.pendingApprovals} pending${approvalSuffix}`,
      role: snap.pendingApprovals > 0 ? "warn" : "muted",
    },
  ]);
}

export function formatStatusOutput(snap: StatusSnapshot): string {
  return renderToString(buildStatusNode(snap));
}

export async function gatherStatus(projectDir: string): Promise<StatusSnapshot> {
  const stateDir = join(projectDir, ".kota");
  const client = DaemonControlClient.fromStateDir(stateDir);

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

      return {
        daemonRunning: true,
        daemonPid: status.pid ?? undefined,
        daemonUptimeMs: uptimeMs,
        activeRuns: status.workflow.activeRuns.length,
        queuedRuns: status.workflow.queueLength,
        sessions: status.sessions.length,
        pendingApprovals,
      };
    }
  }

  const store = new WorkflowRunStore(projectDir);
  const state = store.readState();
  const queue = getApprovalQueue(join(stateDir, "approvals"));
  const pendingApprovals = queue.count("pending");

  return {
    daemonRunning: false,
    activeRuns: (state.activeRuns ?? []).length,
    queuedRuns: (state.pendingRuns ?? []).length,
    sessions: 0,
    pendingApprovals,
  };
}

export function buildStatusCommand(): Command {
  return new Command("status")
    .description("Show a concise operational snapshot: daemon, active runs, approvals, and cost")
    .action(async () => {
      const projectDir = resolveProjectDir();
      const snap = await gatherStatus(projectDir);
      print(buildStatusNode(snap));
      if (snap.pendingApprovals > 0) process.exit(1);
    });
}
