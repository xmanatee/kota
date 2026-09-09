import { join } from "node:path";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { createDirectoryScopeSelector } from "#core/daemon/scope-selection.js";
import type { ControlRouteRegistration, ModuleContext } from "#core/modules/module-types.js";
import { readSelectedScopeSelectorIdQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import { RUN_STATE_READER_PROVIDER_TYPE } from "#core/workflow/run-state-reader-provider.js";
import { WORKFLOW_DISPATCHER_PROVIDER_TYPE } from "#core/workflow/workflow-dispatcher-provider.js";
import { collectAstArchitectureObservations } from "./ast-provider.js";
import { architectureReviewRequested } from "./events.js";
import { reviewRequestSchema } from "./request.js";
import { buildArchitectureGardenerStatus } from "./status.js";

export function buildGardenerControlRoutes(ctx: Pick<ModuleContext, "cwd" | "getProvider" | "events">): ControlRouteRegistration[] {
  const selectScope = createDirectoryScopeSelector({ defaultScopeRoot: ctx.cwd,
    getDaemonScopeProvider: () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE) });
  const readRoutes: ControlRouteRegistration[] = ["status", "observations"].map((view) => ({
    method: "GET", path: `/api/architecture/${view}`, capabilityScope: "read",
    handler: async (req, res) => {
      const selected = readSelectedScopeSelectorIdQueryOrErrorResponse(req, res);
      if (selected === null) return;
      const resolved = selectScope(selected);
      if (!resolved.ok) { jsonResponse(res, 404, resolved.error); return; }
      const repoRoot = resolved.scope.scopeRoot;
      const observations = collectAstArchitectureObservations(repoRoot);
      jsonResponse(res, 200, view === "observations" ? { observations } : buildArchitectureGardenerStatus({
        repoRoot, stateDir: join(ctx.cwd, ".kota"), currentObservations: observations,
        reader: ctx.getProvider(RUN_STATE_READER_PROVIDER_TYPE) ?? undefined,
      }));
    },
  }));
  return [...readRoutes, {
    method: "POST", path: "/api/architecture/review", capabilityScope: "control",
    handler: async (req, res) => {
      const selected = readSelectedScopeSelectorIdQueryOrErrorResponse(req, res);
      if (selected === null) return;
      const parsed = reviewRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) { jsonResponse(res, 400, { error: parsed.error.message }); return; }
      const resolved = selectScope(selected);
      if (!resolved.ok) { jsonResponse(res, 404, resolved.error); return; }
      if (!ctx.getProvider(WORKFLOW_DISPATCHER_PROVIDER_TYPE)) {
        jsonResponse(res, 503, { ok: false, reason: "daemon_required" });
        return;
      }
      ctx.events.emit(architectureReviewRequested, { ...parsed.data, scopeId: resolved.scope.scopeId });
      jsonResponse(res, 202, { ok: true, scopeId: resolved.scope.scopeId, targetScope: parsed.data.targetScope, message: "Architecture investigation requested." });
    },
  }];
}
