import type { UiSurface, UiTableRow } from "#core/daemon/ui-surface.js";
import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
  resultSpec,
  type SurfaceRead,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import type { AuditListResult } from "./client.js";

function auditRows(audit: SurfaceRead<AuditListResult>): UiTableRow[] {
  if (!audit.ok) return unavailableRows(audit.message);
  if (audit.value.entries.length === 0) return emptyRows("Guardrail audit");
  return audit.value.entries.map((entry, index) => ({
    id: `${entry.ts}-${index}`,
    cells: [
      { columnId: "name", value: entry.tool, role: "info" },
      {
        columnId: "state",
        value: `${entry.risk} / ${entry.policy}`,
        role: entry.policy === "deny" ? "warn" : "muted",
      },
      { columnId: "detail", value: `${entry.ts}; ${entry.reason}`, role: "muted" },
    ],
  }));
}

function buildAuditUiSurface(
  scopeId: string,
  audit: SurfaceRead<AuditListResult>,
): UiSurface {
  const refresh = action({
    surfaceId: "guardrail-audit",
    actionId: "audit.list",
    scopeId,
    label: "Reload guardrail audit",
    operation: { kind: "client-namespace", namespace: "audit", method: "list" },
    result: resultSpec("Guardrail audit loaded."),
  });
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "guardrail-audit",
    extensionId: "guardrails.audit",
    title: "Guardrail Audit",
    intent: "Setup",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Setup" },
    order: 52,
    refreshEvents: ["guardrail.assessed"],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "table",
        title: "Recent guardrail decisions",
        columns: NAME_STATE_DETAIL_COLUMNS,
        rows: auditRows(audit),
      },
      { kind: "action-list", title: "Audit actions", actions: [refresh] },
    ],
    actions: [refresh],
  };
}

export const auditUiSurfaceSource: UiSurfaceSource = {
  sourceId: "guardrail-audit",
  project: async (context) => {
    const audit = await context.read("guardrail audit", () =>
      context.client.audit.list({ limit: 20 }),
    );
    return [buildAuditUiSurface(context.scopeId, audit)];
  },
};
