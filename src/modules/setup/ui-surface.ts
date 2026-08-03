import type {
  UiRole,
  UiSurface,
} from "#core/daemon/ui-surface.js";
import {
  NAME_STATE_DETAIL_COLUMNS,
  type SurfaceRead,
} from "#core/daemon/ui-surface-builders.js";
import type {
  ModuleSetupStatusResponse,
} from "#modules/setup/client.js";
import {
  setupActionForms,
  setupActions,
  setupRows,
} from "./ui-surface-helpers.js";

export function buildSetupUiSurface(args: {
  scopeId: string;
  setup: SurfaceRead<ModuleSetupStatusResponse>;
}): UiSurface {
  const { scopeId } = args;
  const actions = setupActions(scopeId, args.setup);
  const forms = setupActionForms(actions);
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "setup",
    extensionId: "core.setup",
    title: "Setup",
    intent: "Setup",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Setup" },
    order: 50,
    refreshEvents: ["daemon.config.reload", "scope.lifecycle.changed"],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: args.setup.ok
          ? Object.entries(args.setup.value.summary).map(([label, value]) => ({
              label,
              value: `${value}`,
              role: value > 0 && label !== "ready" ? "warn" : "muted" as UiRole,
            }))
          : [{ label: "Setup", value: args.setup.message, role: "warn" }],
      },
      { kind: "table", title: "Setup and auth requirements", columns: NAME_STATE_DETAIL_COLUMNS, rows: setupRows(args.setup, actions) },
      ...forms,
      { kind: "action-list", title: "Setup actions", actions },
    ],
    actions,
  };
}
