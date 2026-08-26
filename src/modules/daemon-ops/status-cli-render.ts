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
import { buildRunSandboxStatusNode } from "./status-cli-worktrees.js";

function formatUptime(ms: number): string {
  return formatUptimeFromIso(new Date(Date.now() - ms).toISOString());
}

function describeDispatch(snap: StatusSnapshot): {
  value: string;
  role: "warn" | "muted";
} {
  if (!snap.workflowPaused) return { value: "running", role: "muted" };
  switch (snap.workflowPause?.kind) {
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
      {
        label: "Dispatch",
        value: snap.workflowPaused
          ? "offline  (daemon control API unavailable; operator pause signal present)"
          : "offline  (daemon control API unavailable)",
        role: snap.workflowPaused ? "warn" as const : "muted" as const,
      },
      {
        label: "Runs",
        value: `${snap.activeRuns} active, ${snap.queuedRuns} queued  (durable database)`,
        role: snap.activeRuns > 0 || snap.queuedRuns > 0 ? "warn" as const : "muted" as const,
      },
    );
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
        : "durable run database and local files; daemon API and event stream unavailable",
      role: snap.daemonRunning ? "success" as const : "warn" as const,
    });
  }

  const status = kvBlock(entries);
  const runSandboxStatus = buildRunSandboxStatusNode(snap.runProjection);
  return runSandboxStatus ? stack(status, runSandboxStatus) : status;
}

export function formatStatusOutput(
  snap: StatusSnapshot,
  options: { explain?: boolean } = {},
): string {
  return renderToString(buildStatusNode(snap, options));
}
