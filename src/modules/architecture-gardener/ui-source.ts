import { join } from "node:path";
import type { UiSurface } from "#core/daemon/ui-surface.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import { RUN_STATE_READER_PROVIDER_TYPE } from "#core/workflow/run-state-reader-provider.js";
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
    nodes: [{ kind: "detail", title: "Architecture investigation and proposed work", body }],
    actions: [],
  };
}

export function buildArchitectureGardenerUiSurfaceSource(ctx: Pick<ModuleContext, "getProvider">): UiSurfaceSource {
  return {
    sourceId: "architecture-gardener",
    scope: async (context) => {
      const scopes = await context.client.scopes.list();
      if (!scopes.ok) throw new Error("Architecture status requires daemon scope selection");
      const selected = scopes.scopes.find((scope) => scope.scopeId === context.scopeId);
      if (!selected) throw new Error(`Unknown architecture scope: ${context.scopeId}`);
      const repoRoot = selected.scopeRoot;
      const stateDir = join(context.cwd, ".kota");
      const observations = collectAstArchitectureObservations(repoRoot);
      const status = buildArchitectureGardenerStatus({
        repoRoot,
        stateDir,
        currentObservations: observations,
        reader: ctx.getProvider(RUN_STATE_READER_PROVIDER_TYPE) ?? undefined,
      });
      const rendered = formatGardenerStatusTerminal(status);
      return [buildArchitectureGardenerUiSurface(context.scopeId, rendered)];
    },
  };
}
