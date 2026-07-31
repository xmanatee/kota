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
import type { KnowledgeListResult } from "./client.js";

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

function buildKnowledgeUiSurface(
  scopeId: string,
  knowledge: SurfaceRead<KnowledgeListResult>,
): UiSurface {
  const refresh = action({
    surfaceId: "knowledge-store",
    actionId: "knowledge.list",
    scopeId,
    label: "Reload knowledge",
    operation: { kind: "client-namespace", namespace: "knowledge", method: "list" },
    result: resultSpec("Knowledge loaded."),
  });
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "knowledge-store",
    extensionId: "knowledge.store",
    title: "Knowledge",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 61,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [{
          label: "Knowledge",
          value: readValue(knowledge, (value) => `${value.entries.length}`),
          role: readRole(knowledge),
        }],
      },
      { kind: "table", title: "Knowledge", columns: NAME_STATE_DETAIL_COLUMNS, rows: knowledgeRows(knowledge) },
      { kind: "action-list", title: "Knowledge actions", actions: [refresh] },
    ],
    actions: [refresh],
  };
}

export const knowledgeUiSurfaceSource: UiSurfaceSource = {
  sourceId: "knowledge-store",
  project: async (context) => {
    const knowledge = await context.read("knowledge", () => context.client.knowledge.list());
    return [buildKnowledgeUiSurface(context.scopeId, knowledge)];
  },
};
