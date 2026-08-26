import type { UiAction, UiTableRow } from "#core/daemon/ui-surface.js";
import {
  emptyRows,
  type SurfaceRead,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type { ModuleSetupStatusResponse } from "#modules/setup/client.js";

export function setupRows(
  setup: SurfaceRead<ModuleSetupStatusResponse>,
  actions: readonly UiAction[],
): UiTableRow[] {
  if (!setup.ok) return unavailableRows(setup.message);
  if (setup.value.visibility === "hidden") {
    return emptyRows("Setup requirements hidden by scope policy");
  }
  if (setup.value.requirements.length === 0) return emptyRows("Setup requirements");
  return setup.value.requirements.map((requirement) => ({
    id: `${requirement.moduleName}-${requirement.requirementId}`,
    cells: [
      {
        columnId: "name",
        value: `${requirement.moduleName}/${requirement.requirementId}`,
        role: requirement.state === "ready" ? "success" : "warn",
      },
      {
        columnId: "state",
        value: requirement.state,
        role: requirement.state === "ready" ? "success" : "warn",
      },
      {
        columnId: "detail",
        value:
          `${requirement.kind}; ${requirement.sensitivity}; ` +
          `${requirement.setup.mode}; ${requirement.message}`,
        role: "muted",
      },
    ],
    action: actions.find((candidate) =>
      candidate.actionId.startsWith(
        `setup.${requirement.moduleName}.${requirement.requirementId}.`,
      ) && candidate.effect !== "read"
    ),
  }));
}
