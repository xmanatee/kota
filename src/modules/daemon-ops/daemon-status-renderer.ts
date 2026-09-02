import type { DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import {
  type ColumnRow,
  columns,
  dashboard,
  type KVEntry,
  kvBlock,
  line,
  plain,
  type RenderNode,
  span,
  statusBanner,
} from "#modules/rendering/primitives.js";
import { renderToString } from "#modules/rendering/transport.js";
import { abbreviateRunId, formatDuration, formatTimeAgo, formatUptime } from "./format-utils.js";

export function buildDaemonStatusNode(
  status: DaemonLiveStatus,
  serviceInstalled: boolean,
): RenderNode {
  const uptime = status.startedAt ? formatUptime(status.startedAt) : "unknown";
  const started = status.startedAt ? formatTimeAgo(status.startedAt) : "unknown";
  const workflow = status.workflow;
  const stateEntries: KVEntry[] = [
    {
      label: "Status",
      value: `running  (pid ${status.pid}, up ${uptime}, started ${started})`,
      role: "success",
    },
    { label: "Sessions", value: `${status.sessions.length} interactive` },
    ...(workflow.agentOperatingState === undefined
      ? []
      : [{
          label: "Agent autonomy",
          value: `${workflow.agentOperatingState.runtimeId} ${workflow.agentOperatingState.state}`,
          role: workflow.agentOperatingState.state === "working"
            ? "success" as const
            : workflow.agentOperatingState.state === "idle"
              ? "muted" as const
              : "warn" as const,
        }]),
    {
      label: "Paused",
      value: workflow.paused ? "yes" : "no",
      role: workflow.paused ? "warn" : "muted",
    },
    {
      label: "Service",
      value: serviceInstalled ? "yes (OS service installed)" : "not installed",
      role: serviceInstalled ? "info" : "muted",
    },
  ];
  const summary = `${workflow.activeRuns.length} active · ${workflow.pendingRuns.length} pending · ${workflow.completedRuns} completed`;
  const activity: RenderNode[] = [line(span(summary, "muted"))];
  if (workflow.activeRuns.length > 0) {
    const rows: ColumnRow[] = workflow.activeRuns.map((run) => ({
      cells: [
        { spans: [span(run.workflow, "tool", true)] },
        { spans: [plain(formatDuration(run.startedAt))] },
        { spans: [span(abbreviateRunId(run.runId), "muted")] },
      ],
    }));
    activity.push(columns([
      { header: "Active", role: "tool", headerRole: "muted", minWidth: 12 },
      { header: "Duration", align: "right", minWidth: 9 },
      { header: "Run", role: "muted", minWidth: 7 },
    ], rows));
  }
  if (workflow.pendingRuns.length > 0) {
    const shown = workflow.pendingRuns.slice(0, 5);
    const overflow = workflow.pendingRuns.length - shown.length;
    activity.push(columns([
      {
        header: `Pending${overflow > 0 ? ` (+${overflow} more)` : ""}`,
        headerRole: "muted",
        minWidth: 12,
      },
      { header: "Run", role: "muted", minWidth: 7 },
    ], shown.map((run) => ({
      cells: [
        { spans: [plain(run.workflowName)] },
        { spans: [span(run.runId ? abbreviateRunId(run.runId) : "-", "muted")] },
      ],
    }))));
  }
  if (workflow.activeRuns.length === 0 && workflow.pendingRuns.length === 0) {
    activity.push(line(span("queue idle — no active or pending runs", "muted")));
  }

  const sections: { title: string; role: "info" | "accent"; body: RenderNode }[] = [
    { title: "State", role: "info", body: kvBlock(stateEntries) },
    {
      title: "Activity",
      role: "accent",
      body: activity.length === 1 ? activity[0]! : { kind: "stack", children: activity },
    },
  ];
  if (workflow.paused) {
    sections.unshift({
      title: "Notice",
      role: "accent",
      body: statusBanner("warn", "workflow scheduler paused", "no new runs are being dispatched"),
    });
  }
  return dashboard(sections);
}

export function formatDaemonStatus(status: DaemonLiveStatus, serviceInstalled: boolean): string {
  return renderToString(buildDaemonStatusNode(status, serviceInstalled));
}
