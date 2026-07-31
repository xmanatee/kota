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
import type { MemoryListResult } from "./client.js";

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

function buildMemoryUiSurface(
  scopeId: string,
  memory: SurfaceRead<MemoryListResult>,
): UiSurface {
  const refresh = action({
    surfaceId: "stores",
    actionId: "memory.list",
    scopeId,
    label: "Reload memory",
    operation: { kind: "client-namespace", namespace: "memory", method: "list" },
    result: resultSpec("Memory loaded."),
  });
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "stores",
    extensionId: "memory.stores",
    title: "Stores",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 60,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [{
          label: "Memory",
          value: readValue(memory, (value) => `${value.entries.length}`),
          role: readRole(memory),
        }],
      },
      { kind: "table", title: "Memory", columns: NAME_STATE_DETAIL_COLUMNS, rows: memoryRows(memory) },
      { kind: "action-list", title: "Memory actions", actions: [refresh] },
    ],
    actions: [refresh],
  };
}

export const memoryUiSurfaceSource: UiSurfaceSource = {
  sourceId: "stores",
  project: async (context) => {
    const memory = await context.read("memory", () => context.client.memory.list({ limit: 10 }));
    return [buildMemoryUiSurface(context.scopeId, memory)];
  },
};
