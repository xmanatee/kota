import { join } from "node:path";
import type { UiSurface } from "#core/daemon/ui-surface.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import { collectAstArchitectureObservations } from "./ast-provider.js";
import { buildArchitectureGardenerStatus, formatGardenerStatusTerminal } from "./status.js";

function buildArchitectureGardenerUiSurface(
  scopeId: string,
  body: string,
): UiSurface {
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "architecture-gardener",
    extensionId: "architecture.gardener",
    title: "Architecture Gardener",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 68,
    refreshEvents: [
      "workflow.completed",
      "task.changed",
    ],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [{ kind: "detail", title: "Continuous simplification & fitness functions", body }],
    actions: [],
  };
}

export const architectureGardenerUiSurfaceSource: UiSurfaceSource = {
  sourceId: "architecture-gardener",
  scope: (context) => {
    const repoRoot = context.cwd;
    const stateDir = join(context.cwd, ".kota");
    const observations = collectAstArchitectureObservations(repoRoot);
    const status = buildArchitectureGardenerStatus({
      repoRoot,
      stateDir,
      currentObservations: observations,
    });
    const rendered = formatGardenerStatusTerminal(status);
    return [buildArchitectureGardenerUiSurface(context.scopeId, rendered)];
  },
};
