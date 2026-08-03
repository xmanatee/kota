import {
  action,
  resultSpec,
  uniqueActions,
} from "#core/daemon/ui-surface-builders.js";
import type { OperatorInboxItem, OperatorInboxSnapshot } from "./operator-inbox.js";
import { statusEntries, statusWarnings } from "./operator-ui-status-summary.js";
import type {
  UiActionOperation,
  UiListItem,
  UiRole,
  UiStatusEntry,
  UiSurface,
} from "./operator-ui-types.js";
import { statusWorktreeItems } from "./operator-ui-worktree-status.js";
import type { StatusSnapshot } from "./status-cli.js";

export function buildStatusUiSurface(
  snapshot: StatusSnapshot,
  options: { explain?: boolean; scopeId?: string } = {},
): UiSurface {
  const scopeId = options.scopeId ?? snapshot.scopedProject?.projectId ?? `dir:${snapshot.projectDir}`;
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
  const worktreeItems = statusWorktreeItems(snapshot);
  const nodes: UiSurface["nodes"] = [
    { kind: "status-summary", entries: statusEntries(snapshot, options.explain === true) },
    ...(worktreeItems.length > 0
      ? [{ kind: "list" as const, title: "Automation worktrees", items: worktreeItems }]
      : []),
    { kind: "list", title: "Warnings", items: statusWarnings(snapshot, scopeId) },
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
    refreshEvents: [
      "daemon.config.reload",
      "scope.lifecycle.changed",
      "workflow.completed",
      "session.registered",
      "session.unregistered",
    ],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes,
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

export function buildInboxUiSurface(
  snapshot: OperatorInboxSnapshot,
  scopeId = `dir:${snapshot.projectDir}`,
): UiSurface {
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
    refreshEvents: [
      "approval.changed",
      "owner.question.asked",
      "owner.question.changed",
      "owner.question.resolved",
      "owner.question.dismissed",
      "owner.question.expired",
      "task.changed",
      "workflow.completed",
      "daemon.config.reload",
    ],
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
