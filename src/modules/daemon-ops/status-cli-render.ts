import { basename } from "node:path";
import type { ClientDashboardAvailability } from "#core/daemon/client-identity.js";
import {
  kvBlock,
  type RenderNode,
  stack,
} from "#modules/rendering/primitives.js";
import { renderToString } from "#modules/rendering/transport.js";
import { formatUptime as formatUptimeFromIso } from "./format-utils.js";
import type {
  DaemonControlIdentity,
  StatusDashboard,
  StatusSnapshot,
} from "./status-cli-types.js";
import { buildWorktreeStatusNode } from "./status-cli-worktrees.js";

function formatUptime(ms: number): string {
  return formatUptimeFromIso(new Date(Date.now() - ms).toISOString());
}

function formatDirtyCheckout(
  dirtyCheckout: NonNullable<StatusSnapshot["pendingRecovery"]>["dirtyCheckout"],
): string {
  if (dirtyCheckout === undefined) return "worktree";
  return dirtyCheckout === "workspace" ? "workspace checkout" : "canonical checkout";
}

function describeDispatch(snap: StatusSnapshot): {
  value: string;
  role: "warn" | "muted";
} {
  if (!snap.workflowPaused) return { value: "running", role: "muted" };
  switch (snap.workflowPause?.kind) {
    case "dirty-recovery":
      return {
        value:
          `paused for dirty recovery  (${snap.workflowPause.recovery.sourceWorkflow} ` +
          `${snap.workflowPause.recovery.sourceRunId})`,
        role: "warn",
      };
    case "operator":
      return {
        value: "paused by operator  (run `kota workflow resume`)",
        role: "warn",
      };
    case "runtime":
      return {
        value: "paused in daemon memory  (inspect daemon before resuming)",
        role: "warn",
      };
    case "none":
    case undefined:
      return {
        value: "paused  (run `kota workflow resume`)",
        role: "warn",
      };
  }
}

function formatRecovery(recovery: NonNullable<StatusSnapshot["pendingRecovery"]>): string {
  const prefix = "status" in recovery && recovery.status === "unavailable"
    ? "git status unavailable for"
    : "dirty";
  const nextAction = "nextAction" in recovery ? `; next: ${recovery.nextAction}` : "";
  return (
    `${prefix} ${formatDirtyCheckout(recovery.dirtyCheckout)} from ${recovery.sourceWorkflow} ` +
    `(${recovery.sourceRunId}, attempts ${recovery.attempts}): ` +
    `${recovery.worktreeSummary}${nextAction}`
  );
}

function describeControlFile(identity: DaemonControlIdentity): {
  value: string;
  role: "success" | "warn" | "error" | "muted";
} {
  switch (identity.kind) {
    case "missing":
      return { value: "missing  (no .kota/daemon-control.json)", role: "muted" };
    case "unreadable":
      return { value: "unreadable  (could not parse .kota/daemon-control.json)", role: "warn" };
    case "stale":
      return {
        value: `stale  (pid ${identity.pid} not alive — run \`kota doctor --fix\`)`,
        role: "warn",
      };
    case "fresh":
      return { value: `fresh  (pid ${identity.pid})`, role: "success" };
  }
}

export function resolveDashboardForStatus(
  dashboard: ClientDashboardAvailability,
  baseURL: string,
): StatusDashboard {
  if (dashboard.available) {
    const url = new URL(dashboard.path, baseURL).toString();
    return { available: true, url };
  }
  return {
    available: false,
    reason: dashboard.reason,
    ...(dashboard.message !== undefined && { message: dashboard.message }),
  };
}

function describeDashboard(dashboard: StatusDashboard): {
  value: string;
  role: "success" | "warn" | "muted";
} {
  if (dashboard.available) {
    return { value: `available  (${dashboard.url})`, role: "success" };
  }
  const suffix = dashboard.message ? `  — ${dashboard.message}` : "";
  return {
    value: `not available  (${dashboard.reason})${suffix}`,
    role: "warn",
  };
}

export function buildStatusNode(
  snap: StatusSnapshot,
  options: { explain?: boolean } = {},
): RenderNode {
  const daemonValue = snap.daemonRunning && snap.daemonPid != null
    ? `running  (pid ${snap.daemonPid}${snap.daemonUptimeMs != null ? `, up ${formatUptime(snap.daemonUptimeMs)}` : ""})`
    : "not running  (offline mode)";

  const approvalSuffix = snap.pendingApprovals > 0 ? "  ← requires attention" : "";
  const entries = [
    { label: "Project", value: `${snap.projectName}  (${snap.projectDir})`, role: "info" as const },
    { label: "Control file", ...describeControlFile(snap.controlFile) },
  ];
  if (snap.controlFile.kind === "fresh" || snap.controlFile.kind === "stale") {
    entries.push({ label: "Daemon URL", value: snap.controlFile.baseURL, role: "muted" as const });
  }
  if (snap.strandedDaemon) {
    entries.push({
      label: "Stranded daemon",
      value: `pid ${snap.strandedDaemon.pid} is alive but has no control API — terminate it and restart`,
      role: "warn" as const,
    });
  }
  if (snap.daemonProjectDir) {
    const name = snap.daemonProjectName ?? basename(snap.daemonProjectDir);
    entries.push({
      label: "Daemon project",
      value: snap.wrongProject
        ? `${name}  (${snap.daemonProjectDir})  ← MISMATCH with selected project`
        : `${name}  (${snap.daemonProjectDir})`,
      role: snap.wrongProject ? "warn" as const : "muted" as const,
    });
  }
  if (snap.scopedProject) {
    entries.push({
      label: "Active project",
      value: `${snap.scopedProject.displayName}  (${snap.scopedProject.projectDir})`,
      role: "info" as const,
    });
  }
  if (snap.dashboard) {
    const dash = describeDashboard(snap.dashboard);
    entries.push({ label: "Dashboard", value: dash.value, role: dash.role });
  }
  entries.push({
    label: "Daemon",
    value: daemonValue,
    role: snap.daemonRunning ? "success" as const : snap.strandedDaemon ? "warn" as const : "muted" as const,
  });

  if (snap.daemonRunning) {
    const dispatch = describeDispatch(snap);
    entries.push(
      { label: "Dispatch", value: dispatch.value, role: dispatch.role },
      { label: "Runs", value: `${snap.activeRuns} active, ${snap.queuedRuns} queued`, role: "muted" as const },
      { label: "Sessions", value: `${snap.sessions} interactive`, role: "muted" as const },
    );
  } else {
    entries.push(
      { label: "Dispatch", value: "offline  (daemon control API unavailable)", role: "muted" as const },
      { label: "Runs", value: "offline  (live run state unavailable)", role: "muted" as const },
    );
    appendOfflineStatusEntries(entries, snap);
  }

  if (snap.pendingRecovery) {
    entries.push({
      label: "status" in snap.pendingRecovery && snap.pendingRecovery.status === "unavailable"
        ? "Recovery status"
        : "Pending recovery",
      value: formatRecovery(snap.pendingRecovery),
      role: "warn" as const,
    });
  }

  entries.push({
    label: "Approvals",
    value: `${snap.pendingApprovals} pending${approvalSuffix}`,
    role: snap.pendingApprovals > 0 ? "warn" as const : "muted" as const,
  });

  if (options.explain) {
    entries.push({
      label: "Runtime source",
      value: snap.daemonRunning
        ? "daemon control API; event stream expected available through the daemon"
        : "local files only; daemon API and event stream unavailable",
      role: snap.daemonRunning ? "success" as const : "warn" as const,
    });
  }

  const status = kvBlock(entries);
  const worktreeStatus = buildWorktreeStatusNode(snap.worktrees ?? [], snap.worktreeSummary);
  return worktreeStatus ? stack(status, worktreeStatus) : status;
}

function appendOfflineStatusEntries(
  entries: Parameters<typeof kvBlock>[0],
  snap: StatusSnapshot,
): void {
  if (
    snap.historicalWorkflow &&
    (snap.historicalWorkflow.activeRuns > 0 ||
      snap.historicalWorkflow.queuedRuns > 0 ||
      snap.historicalWorkflow.workflowPaused)
  ) {
    const paused = snap.historicalWorkflow.workflowPaused
      ? `, ${snap.workflowPause?.kind === "dirty-recovery" ? "dirty recovery pause signal" : "operator pause signal"} present`
      : "";
    entries.push({
      label: "Historical run store",
      value:
        `${snap.historicalWorkflow.activeRuns} active, ` +
        `${snap.historicalWorkflow.queuedRuns} queued from offline files${paused}`,
      role: "warn" as const,
    });
  }
}

export function formatStatusOutput(
  snap: StatusSnapshot,
  options: { explain?: boolean } = {},
): string {
  return renderToString(buildStatusNode(snap, options));
}
