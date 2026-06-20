import type { HistoryListResult } from "#modules/history/client.js";
import type { KnowledgeListResult } from "#modules/knowledge/client.js";
import type { MemoryListResult } from "#modules/memory/client.js";
import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  scopeIdForStatus,
  shortId,
  unavailableRows,
} from "./operator-ui-builder-common.js";
import type { UiSurface, UiTableRow } from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

function memoryRows(memory: SurfaceRead<MemoryListResult>): UiTableRow[] {
  if (!memory.ok) return unavailableRows(memory.message);
  if (memory.value.entries.length === 0) return emptyRows("Memory");
  return memory.value.entries.slice(0, 10).map((entry) => ({
    id: entry.id,
    cells: [
      { columnId: "name", value: shortId(entry.id), role: "info" },
      { columnId: "state", value: entry.created, role: "muted" },
      { columnId: "detail", value: shortId(entry.content, 96), role: "muted" },
    ],
  }));
}

function knowledgeRows(knowledge: SurfaceRead<KnowledgeListResult>): UiTableRow[] {
  if (!knowledge.ok) return unavailableRows(knowledge.message);
  if (knowledge.value.entries.length === 0) return emptyRows("Knowledge");
  return knowledge.value.entries.slice(0, 10).map((entry) => ({
    id: entry.id,
    cells: [
      { columnId: "name", value: shortId(entry.id), role: "info" },
      { columnId: "state", value: entry.status ?? entry.type ?? "stored", role: "muted" },
      { columnId: "detail", value: entry.title, role: "muted" },
    ],
  }));
}

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

export function buildStoresUiSurface(args: {
  status: StatusSnapshot;
  memory: SurfaceRead<MemoryListResult>;
  knowledge: SurfaceRead<KnowledgeListResult>;
  history: SurfaceRead<HistoryListResult>;
}): UiSurface {
  const scopeId = scopeIdForStatus(args.status);
  const actions = [
    action({
      surfaceId: "stores",
      actionId: "memory.list",
      scopeId,
      label: "Reload memory",
      operation: { kind: "client-namespace", namespace: "memory", method: "list" },
      result: resultSpec("Memory loaded."),
    }),
    action({
      surfaceId: "stores",
      actionId: "knowledge.list",
      scopeId,
      label: "Reload knowledge",
      operation: { kind: "client-namespace", namespace: "knowledge", method: "list" },
      result: resultSpec("Knowledge loaded."),
    }),
    action({
      surfaceId: "stores",
      actionId: "history.list",
      scopeId,
      label: "Reload history",
      operation: { kind: "client-namespace", namespace: "history", method: "list" },
      result: resultSpec("History loaded."),
    }),
  ];
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "stores",
    extensionId: "core.stores",
    title: "Stores",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 60,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [
          { label: "Memory", value: readValue(args.memory, (memory) => `${memory.entries.length}`), role: readRole(args.memory) },
          { label: "Knowledge", value: readValue(args.knowledge, (knowledge) => `${knowledge.entries.length}`), role: readRole(args.knowledge) },
          { label: "History", value: readValue(args.history, (history) => `${history.conversations.length}`), role: readRole(args.history) },
        ],
      },
      { kind: "table", title: "Memory", columns: NAME_STATE_DETAIL_COLUMNS, rows: memoryRows(args.memory) },
      { kind: "table", title: "Knowledge", columns: NAME_STATE_DETAIL_COLUMNS, rows: knowledgeRows(args.knowledge) },
      { kind: "table", title: "History", columns: NAME_STATE_DETAIL_COLUMNS, rows: historyRows(args.history) },
      { kind: "action-list", title: "Store actions", actions },
    ],
    actions,
  };
}
