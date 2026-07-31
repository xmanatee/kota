import {
  action,
  resultSpec,
} from "#core/daemon/ui-surface-builders.js";
import {
  formatOperatorRecoverySummary,
  recoveryIsUnavailable,
} from "./operator-ui-recovery-summary.js";
import type { UiListItem, UiStatusEntry } from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

export function statusEntries(
  snapshot: StatusSnapshot,
  explain: boolean,
): UiStatusEntry[] {
  const dispatchValue = snapshot.daemonRunning
    ? snapshot.workflowPause?.kind === "dirty-recovery"
      ? formatOperatorRecoverySummary(snapshot.workflowPause.recovery)
      : snapshot.workflowPause?.kind === "operator"
        ? "paused by operator"
        : snapshot.workflowPaused
          ? "paused"
          : "running"
    : "offline";
  const entries: UiStatusEntry[] = [
    {
      label: "Daemon",
      value: snapshot.daemonRunning && snapshot.daemonPid !== undefined
        ? `running (pid ${snapshot.daemonPid})`
        : "not running (offline mode)",
      role: snapshot.daemonRunning ? "success" : "warn",
    },
    {
      label: "Dispatch",
      value: dispatchValue,
      role: snapshot.daemonRunning && !snapshot.workflowPaused ? "success" : "warn",
    },
    {
      label: "Runs",
      value: snapshot.daemonRunning
        ? `${snapshot.activeRuns} active, ${snapshot.queuedRuns} queued`
        : "offline (live run state unavailable)",
      role: snapshot.daemonRunning ? "neutral" : "muted",
    },
    {
      label: "Approvals",
      value: `${snapshot.pendingApprovals} pending`,
      role: snapshot.pendingApprovals > 0 ? "warn" : "muted",
    },
  ];

  if (snapshot.historicalWorkflow && !snapshot.daemonRunning) {
    entries.push({
      label: "Historical run store",
      value:
        `${snapshot.historicalWorkflow.activeRuns} active, ` +
        `${snapshot.historicalWorkflow.queuedRuns} queued from offline files` +
        `${snapshot.historicalWorkflow.workflowPaused ? "; pause present" : ""}`,
      role: "warn",
    });
  }

  if (snapshot.pendingRecovery) {
    entries.push({
      label: recoveryIsUnavailable(snapshot.pendingRecovery)
        ? "Recovery status"
        : "Pending recovery",
      value: formatOperatorRecoverySummary(snapshot.pendingRecovery),
      role: "warn",
    });
  }

  if (explain) {
    entries.push({
      label: "Runtime source",
      value: snapshot.daemonRunning
        ? "daemon control API"
        : "local files only; daemon API and event stream unavailable",
      role: snapshot.daemonRunning ? "success" : "warn",
    });
  }

  return entries;
}

export function statusWarnings(
  snapshot: StatusSnapshot,
  scopeId: string,
): UiListItem[] {
  const warnings: UiListItem[] = [];
  if (!snapshot.daemonRunning) {
    warnings.push({
      id: "daemon-offline",
      title: "Daemon is offline",
      detail: "Dispatch, event stream, live sessions, and live run state are unavailable.",
      role: "warn",
      action: action({
        surfaceId: "status",
        actionId: "daemon.start",
        scopeId,
        label: "Start daemon",
        effect: "write",
        operation: { kind: "client-namespace", namespace: "daemonOps", method: "start" },
        result: resultSpec("Daemon start requested."),
      }),
    });
  }
  if (snapshot.controlFile.kind === "stale") {
    warnings.push({
      id: "daemon-control-stale",
      title: "Daemon control file is stale",
      detail: `Recorded pid ${snapshot.controlFile.pid} is no longer alive.`,
      role: "warn",
      action: action({
        surfaceId: "status",
        actionId: "doctor.fix",
        scopeId,
        label: "Run doctor",
        effect: "write",
        operation: { kind: "client-namespace", namespace: "doctor", method: "fix" },
        confirmation: {
          mode: "required",
          title: "Run doctor fix",
          detail: "This can modify local daemon control files.",
          confirmLabel: "Run fix",
          risk: "medium",
        },
      }),
    });
  }
  if (snapshot.pendingApprovals > 0) {
    warnings.push({
      id: "pending-approvals",
      title: "Approvals require attention",
      detail: `${snapshot.pendingApprovals} approval(s) are waiting for operator review.`,
      role: "warn",
      action: action({
        surfaceId: "status",
        actionId: "inbox.open",
        scopeId,
        label: "Open inbox",
        operation: { kind: "daemon-route", method: "GET", path: "/attention" },
      }),
    });
  }
  if (snapshot.pendingRecovery) {
    warnings.push({
      id: "dirty-recovery",
      title: recoveryIsUnavailable(snapshot.pendingRecovery)
        ? "Recovery status unavailable"
        : "Dirty recovery pending",
      detail: formatOperatorRecoverySummary(snapshot.pendingRecovery),
      role: "warn",
      action: action({
        surfaceId: "status",
        actionId: "workflow.status",
        scopeId,
        label: "Open workflow status",
        operation: { kind: "client-namespace", namespace: "workflow", method: "status" },
      }),
    });
  }
  return warnings;
}
