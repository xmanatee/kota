import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { createAutonomyClient } from "../client.js";

export function reportRoutes(scopeRoot: string): RouteRegistration[] {
  const client = createAutonomyClient(scopeRoot);
  return [{
    method: "GET", path: "/api/autonomy/report",
    handler: async (req, res) => {
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      const days = query.has("days") ? Number(query.get("days")) : undefined;
      if (days !== undefined && (!Number.isSafeInteger(days) || days <= 0)) {
        jsonResponse(res, 400, { error: "Report days must be a positive integer" });
        return;
      }
      jsonResponse(res, 200, await client.report({ days, scopeId: query.get("scopeId") ?? undefined }));
    },
  }];
}
