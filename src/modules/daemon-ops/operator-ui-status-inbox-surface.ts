import { buildUiSurfaceBundle } from "#core/daemon/ui-surface.js";
import type { OperatorInboxItem, OperatorInboxSnapshot } from "./operator-inbox.js";
import {
  action,
  resultSpec,
  scopeIdForStatus,
  uniqueActions,
} from "./operator-ui-builder-common.js";
import type {
  UiActionOperation,
  UiListItem,
  UiRole,
  UiStatusEntry,
  UiSurface,
  UiSurfaceBundle,
} from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

function statusEntries(snapshot: StatusSnapshot, explain: boolean): UiStatusEntry[] {
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
      value: snapshot.daemonRunning
        ? snapshot.workflowPaused ? "paused" : "running"
        : "offline",
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
      value: `${snapshot.historicalWorkflow.activeRuns} active, ${snapshot.historicalWorkflow.queuedRuns} queued from offline files`,
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

function statusWarnings(snapshot: StatusSnapshot, scopeId: string): UiListItem[] {
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
  return warnings;
}

export function buildStatusUiSurface(
  snapshot: StatusSnapshot,
  options: { explain?: boolean } = {},
): UiSurface {
  const scopeId = scopeIdForStatus(snapshot);
  const actions = [
    action({
      surfaceId: "status",
      actionId: "daemon.start",
      scopeId,
      label: "Start daemon",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "daemonOps", method: "start" },
      result: resultSpec("Daemon start requested."),
    }),
    action({
      surfaceId: "status",
      actionId: "status.explain",
      scopeId,
      label: "Explain status",
      operation: { kind: "daemon-route", method: "GET", path: "/status" },
      result: resultSpec("Daemon status loaded."),
    }),
  ];
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "status",
    extensionId: "core.status",
    title: "Status",
    intent: "Status",
    scopeId,
    attachmentPoint: { kind: "root" },
    order: 10,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      { kind: "status-summary", entries: statusEntries(snapshot, options.explain === true) },
      { kind: "list", title: "Warnings", items: statusWarnings(snapshot, scopeId) },
    ],
    actions,
  };
}

function actionIdForInboxItem(item: OperatorInboxItem): string {
  switch (item.kind) {
    case "runtime":
      return "runtime.open";
    case "approval":
      return "approval.open";
    case "owner-question":
      return "owner-question.open";
    case "blocked-task":
      return "blocked-task.open";
    case "setup":
      return "setup.open";
    case "failed-run":
      return "failed-run.open";
  }
}

function operationForInboxItem(item: OperatorInboxItem): UiActionOperation {
  switch (item.kind) {
    case "runtime":
      return { kind: "daemon-route", method: "GET", path: "/status" };
    case "approval":
      return { kind: "daemon-route", method: "GET", path: "/approvals?status=pending" };
    case "owner-question":
      return { kind: "daemon-route", method: "GET", path: "/owner-questions?status=pending" };
    case "blocked-task":
      return { kind: "daemon-route", method: "GET", path: "/tasks?state=blocked" };
    case "setup":
      return { kind: "daemon-route", method: "GET", path: "/setup/requirements" };
    case "failed-run":
      return { kind: "daemon-route", method: "GET", path: "/workflow/runs?status=failed" };
  }
}

function inboxRole(role: OperatorInboxItem["role"]): UiRole {
  return role === "accent" || role === "tool" || role === "agent" ? "neutral" : role;
}

function inboxSummaryEntries(snapshot: OperatorInboxSnapshot): UiStatusEntry[] {
  return [
    { label: "Runtime", value: `${snapshot.counts.runtime}`, role: snapshot.counts.runtime > 0 ? "warn" : "muted" },
    { label: "Approvals", value: `${snapshot.counts.approval}`, role: snapshot.counts.approval > 0 ? "warn" : "muted" },
    {
      label: "Owner questions",
      value: `${snapshot.counts["owner-question"]}`,
      role: snapshot.counts["owner-question"] > 0 ? "warn" : "muted",
    },
    { label: "Blocked", value: `${snapshot.counts["blocked-task"]}`, role: snapshot.counts["blocked-task"] > 0 ? "warn" : "muted" },
    { label: "Setup", value: `${snapshot.counts.setup}`, role: snapshot.counts.setup > 0 ? "warn" : "muted" },
    { label: "Failed runs", value: `${snapshot.counts["failed-run"]}`, role: snapshot.counts["failed-run"] > 0 ? "error" : "muted" },
  ];
}

export function buildInboxUiSurface(snapshot: OperatorInboxSnapshot): UiSurface {
  const scopeId = `dir:${snapshot.projectDir}`;
  const refresh = action({
    surfaceId: "inbox",
    actionId: "inbox.refresh",
    scopeId,
    label: "Refresh inbox",
    operation: { kind: "daemon-route", method: "GET", path: "/attention" },
    result: resultSpec("Inbox refreshed."),
  });
  const items: UiListItem[] = snapshot.items.map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    role: inboxRole(item.role),
    action: action({
      surfaceId: "inbox",
      actionId: actionIdForInboxItem(item),
      scopeId,
      label: item.title,
      operation: operationForInboxItem(item),
    }),
  }));
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "inbox",
    extensionId: "core.inbox",
    title: "Inbox",
    intent: "Inbox",
    scopeId,
    attachmentPoint: { kind: "root" },
    order: 20,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: items.length === 0
      ? [{ kind: "empty", title: "Operator inbox is clear", detail: snapshot.projectDir, action: refresh }]
      : [
          { kind: "status-summary", entries: inboxSummaryEntries(snapshot) },
          { kind: "list", title: "Attention items", items },
        ],
    actions: uniqueActions([refresh, ...items.map((item) => item.action)]),
  };
}

export function buildStatusInboxBundle(args: {
  status: StatusSnapshot;
  inbox: OperatorInboxSnapshot;
}): UiSurfaceBundle {
  return buildUiSurfaceBundle([
    buildStatusUiSurface(args.status, { explain: true }),
    buildInboxUiSurface(args.inbox),
  ]);
}
