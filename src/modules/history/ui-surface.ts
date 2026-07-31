import type { UiSurface, UiTableRow } from "#core/daemon/ui-surface.js";
import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  shortId,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import type { HistoryListResult } from "./client.js";

function historyRows(history: SurfaceRead<HistoryListResult>): UiTableRow[] {
  if (!history.ok) return unavailableRows(history.message);
  if (history.value.conversations.length === 0) return emptyRows("History");
  return history.value.conversations.slice(0, 10).map((conversation) => ({
    id: conversation.id,
    cells: [
      { columnId: "name", value: shortId(conversation.id), role: "info" },
      { columnId: "state", value: conversation.updatedAt ?? conversation.createdAt, role: "muted" },
      { columnId: "detail", value: conversation.title ?? conversation.cwd ?? "conversation", role: "muted" },
    ],
  }));
}

function buildHistoryUiSurface(
  scopeId: string,
  history: SurfaceRead<HistoryListResult>,
): UiSurface {
  const refresh = action({
    surfaceId: "history-store",
    actionId: "history.list",
    scopeId,
    label: "Reload history",
    operation: { kind: "client-namespace", namespace: "history", method: "list" },
    result: resultSpec("History loaded."),
  });
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "history-store",
    extensionId: "history.store",
    title: "History",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 62,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [{
          label: "History",
          value: readValue(history, (value) => `${value.conversations.length}`),
          role: readRole(history),
        }],
      },
      { kind: "table", title: "History", columns: NAME_STATE_DETAIL_COLUMNS, rows: historyRows(history) },
      { kind: "action-list", title: "History actions", actions: [refresh] },
    ],
    actions: [refresh],
  };
}

export const historyUiSurfaceSource: UiSurfaceSource = {
  sourceId: "history-store",
  project: async (context) => {
    const history = await context.read("history", () => context.client.history.list({ limit: 10 }));
    return [buildHistoryUiSurface(context.scopeId, history)];
  },
};
