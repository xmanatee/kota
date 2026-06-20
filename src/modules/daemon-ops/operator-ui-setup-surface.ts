import type {
  ModuleSetupStatusResponse,
} from "#modules/setup/client.js";
import {
  NAME_STATE_DETAIL_COLUMNS,
  type SurfaceRead,
  scopeIdForStatus,
} from "./operator-ui-builder-common.js";
import {
  setupActionForms,
  setupActions,
  setupRows,
} from "./operator-ui-setup-helpers.js";
import type {
  UiRole,
  UiSurface,
} from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

export function buildSetupUiSurface(args: {
  status: StatusSnapshot;
  setup: SurfaceRead<ModuleSetupStatusResponse>;
}): UiSurface {
  const scopeId = scopeIdForStatus(args.status);
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
