import {
  action,
  NAME_STATE_DETAIL_COLUMNS,
  resultSpec,
  uniqueActions,
} from "./operator-ui-builder-common.js";
import type {
  ContinuityEntry,
  ContinuityProjection,
  ContinuityState,
} from "./operator-ui-continuity-model.js";
import type {
  UiAction,
  UiListItem,
  UiRole,
  UiStatusEntry,
  UiSurface,
  UiTableRow,
} from "./operator-ui-types.js";

function entryAction(
  surfaceId: string,
  scopeId: string,
  entry: ContinuityEntry,
  index: number,
): UiAction | undefined {
  if (!entry.route) return undefined;
  return action({
    surfaceId,
    actionId: `open.${index}`,
    scopeId,
    label: entry.route.label,
    operation: { kind: "daemon-route", method: entry.route.method, path: entry.route.path },
    result: resultSpec(`${entry.route.label} loaded.`),
  });
}

function listItems(
  surfaceId: string,
  scopeId: string,
  entries: readonly ContinuityEntry[],
  offset: number,
): UiListItem[] {
  return entries.map((entry, index) => ({
    id: entry.id,
    title: entry.name,
    detail: `${entry.state}; ${entry.detail}`,
    role: entry.role,
    action: entryAction(surfaceId, scopeId, entry, offset + index),
  }));
}

function tableRows(
  surfaceId: string,
  scopeId: string,
  entries: readonly ContinuityEntry[],
  offset: number,
): UiTableRow[] {
  if (entries.length === 0) {
    return [{
      id: "none",
      cells: [
        { columnId: "name", value: "Work", role: "muted" },
        { columnId: "state", value: "empty", role: "muted" },
        { columnId: "detail", value: "No active or recent work is exposed right now.", role: "muted" },
      ],
    }];
  }
  return entries.map((entry, index) => ({
    id: entry.id,
    cells: [
      { columnId: "name", value: entry.name, role: entry.role },
      { columnId: "state", value: entry.state, role: entry.role },
      { columnId: "detail", value: entry.detail, role: "muted" },
    ],
    action: entryAction(surfaceId, scopeId, entry, offset + index),
  }));
}

function stateRole(state: ContinuityState): UiRole {
  if (state === "failed") return "error";
  if (state === "blocked") return "warn";
  if (state === "healthy") return "success";
  return "muted";
}

function summaryEntries(projection: ContinuityProjection): UiStatusEntry[] {
  const memoryKnowledge = projection.counts.memoryHints + projection.counts.knowledgeHints;
  return [
    { label: "State", value: projection.state, role: stateRole(projection.state) },
    { label: "Work", value: `${projection.counts.workItems}`, role: projection.counts.workItems > 0 ? "info" : "muted" },
    { label: "Unblocks", value: `${projection.counts.unblocks}`, role: projection.counts.unblocks > 0 ? "warn" : "muted" },
    { label: "Failed runs", value: `${projection.counts.failedRuns}`, role: projection.counts.failedRuns > 0 ? "error" : "muted" },
    { label: "Artifacts", value: `${projection.counts.reviewArtifacts}`, role: projection.counts.reviewArtifacts > 0 ? "info" : "muted" },
    { label: "Memory/knowledge", value: `${memoryKnowledge}`, role: memoryKnowledge > 0 ? "info" : "muted" },
    { label: "Follow-ups", value: `${projection.counts.recurringFollowUps}`, role: projection.counts.recurringFollowUps > 0 ? "success" : "muted" },
  ];
}

function projectionActions(projection: ContinuityProjection, refresh: UiAction): UiAction[] {
  return uniqueActions([
    refresh,
    ...projection.workItems.map((entry, index) => entryAction("continuity", projection.scopeId, entry, index)),
    ...projection.unblocks.map((entry, index) => entryAction("continuity", projection.scopeId, entry, 100 + index)),
    ...projection.reviewArtifacts.map((entry, index) => entryAction("continuity", projection.scopeId, entry, 200 + index)),
    ...projection.memoryKnowledgeHints.map((entry, index) => entryAction("continuity", projection.scopeId, entry, 300 + index)),
    ...projection.recurringFollowUps.map((entry, index) => entryAction("continuity", projection.scopeId, entry, 400 + index)),
  ]);
}

export function buildContinuityUiSurface(projection: ContinuityProjection): UiSurface {
  const refresh = action({
    surfaceId: "continuity",
    actionId: "continuity.refresh",
    scopeId: projection.scopeId,
    label: "Refresh continuity",
    operation: { kind: "daemon-route", method: "GET", path: "/ui/surfaces" },
    result: resultSpec("Continuity refreshed."),
  });
  const actions = projectionActions(projection, refresh);
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "continuity",
    extensionId: "core.continuity",
    title: "Continuity",
    intent: "Work",
    scopeId: projection.scopeId,
    attachmentPoint: { kind: "intent", intent: "Work" },
    order: 25,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: projection.state === "empty"
      ? [
          { kind: "status-summary", entries: summaryEntries(projection) },
          { kind: "empty", title: "Nothing needs attention", detail: projection.summary, action: refresh },
        ]
      : [
          { kind: "status-summary", entries: summaryEntries(projection) },
          { kind: "text", title: "Next action", body: projection.nextAction, role: stateRole(projection.state) },
          { kind: "table", title: "Work continuity", columns: NAME_STATE_DETAIL_COLUMNS, rows: tableRows("continuity", projection.scopeId, projection.workItems, 0) },
          { kind: "list", title: "Open unblock points", items: listItems("continuity", projection.scopeId, projection.unblocks, 100) },
          { kind: "list", title: "Run artifacts to review", items: listItems("continuity", projection.scopeId, projection.reviewArtifacts, 200) },
          { kind: "list", title: "Memory and knowledge hints", items: listItems("continuity", projection.scopeId, projection.memoryKnowledgeHints, 300) },
          { kind: "list", title: "Recurring follow-ups", items: listItems("continuity", projection.scopeId, projection.recurringFollowUps, 400) },
          { kind: "action-list", title: "Continuity actions", actions },
        ],
    actions,
  };
}
