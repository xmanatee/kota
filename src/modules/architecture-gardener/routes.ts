import { join } from "node:path";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import { collectAstArchitectureObservations } from "./ast-provider.js";
import { buildArchitectureGardenerStatus } from "./status.js";
import { ARCHITECTURE_REVIEW_REQUESTED_EVENT } from "./workflow.js";

export function buildGardenerControlRoutes(
  ctx: ModuleContext,
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/architecture/status",
      capabilityScope: "read",
      handler: async (_req, res) => {
        const repoRoot = ctx.cwd;
        const stateDir = join(ctx.cwd, ".kota");
        const observations = collectAstArchitectureObservations(repoRoot);
        const status = buildArchitectureGardenerStatus({
          repoRoot,
          stateDir,
          currentObservations: observations,
        });
        jsonResponse(res, 200, status);
      },
    },
    {
      method: "GET",
      path: "/api/architecture/observations",
      capabilityScope: "read",
      handler: async (_req, res) => {
        const repoRoot = ctx.cwd;
        const observations = collectAstArchitectureObservations(repoRoot);
        jsonResponse(res, 200, { observations });
      },
    },
    {
      method: "POST",
      path: "/api/architecture/review",
      capabilityScope: "control",
      handler: async (req, res) => {
        const body = (await readBody(req)) as { targetScope?: string; reason?: string };
        const targetScope = body?.targetScope ?? "repo";
        const reason = body?.reason ?? "Operator requested review";

        // Emit typed review requested event to trigger workflow
        ctx.events.emitExternal(ARCHITECTURE_REVIEW_REQUESTED_EVENT, {
          targetScope,
          reason,
          requestedAt: new Date().toISOString(),
        });

        jsonResponse(res, 202, {
          ok: true,
          message: `Architecture review requested for "${targetScope}".`,
          targetScope,
          reason,
        });
      },
    },
  ];
}
