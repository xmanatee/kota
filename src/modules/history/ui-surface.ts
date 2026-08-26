import type {
  UiAction,
  UiActionParameterSpec,
  UiSurface,
  UiTableRow,
} from "#core/daemon/ui-surface.js";
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

function historyRows(
  history: SurfaceRead<HistoryListResult>,
  show: UiAction,
): UiTableRow[] {
  if (!history.ok) return unavailableRows(history.message);
  if (history.value.conversations.length === 0) return emptyRows("History");
  return history.value.conversations.slice(0, 10).map((conversation) => ({
    id: conversation.id,
    cells: [
      { columnId: "name", value: shortId(conversation.id), role: "info" },
      { columnId: "state", value: conversation.updatedAt ?? conversation.createdAt, role: "muted" },
      { columnId: "detail", value: conversation.title ?? conversation.cwd ?? "conversation", role: "muted" },
    ],
    action: show,
  }));
}

function historyShowParameters(): UiActionParameterSpec {
  return {
    fields: [
      {
        id: "historyId",
        label: "Conversation id",
        input: "text",
        required: true,
        schema: { type: "string" },
      },
    ],
    schema: {
      type: "object",
      required: ["historyId"],
      properties: { historyId: { type: "string" } },
      additionalProperties: false,
    },
  };
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
  const show = action({
    surfaceId: "history-store",
    actionId: "history.show",
    scopeId,
    label: "Open conversation",
    operation: { kind: "client-namespace", namespace: "history", method: "show" },
    parameters: historyShowParameters(),
    result: resultSpec("Conversation loaded."),
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
    refreshEvents: ["session.registered", "session.unregistered"],
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
      { kind: "table", title: "History", columns: NAME_STATE_DETAIL_COLUMNS, rows: historyRows(history, show) },
      { kind: "action-list", title: "History actions", actions: [refresh] },
    ],
    actions: [refresh, show],
  };
}

export const historyUiSurfaceSource: UiSurfaceSource = {
  sourceId: "history-store",
  scope: async (context) => {
    const history = await context.read("history", () => context.client.history.list({ limit: 10 }));
    return [buildHistoryUiSurface(context.scopeId, history)];
  },
};
