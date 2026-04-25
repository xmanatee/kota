/**
 * Daemon-control HTTP routes for the `doctor` namespace.
 *
 * Both the daemon-control server and the local-side handler reach the
 * same `runDoctorChecks` / `runDoctorFixes` helpers so daemon-up and
 * daemon-down callers see the same results for the same operator
 * project state.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { runDoctorChecks, runDoctorFixes } from "./doctor-checks.js";

export function doctorControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/doctor/run",
      capabilityScope: "read",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          const skipConnectivity = url.searchParams.get("skipConnectivity") === "true";
          const checks = await runDoctorChecks(ctx.cwd, { skipConnectivity });
          jsonResponse(res, 200, { checks });
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message });
        }
      },
    },
    {
      method: "POST",
      path: "/doctor/fix",
      capabilityScope: "control",
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        try {
          const repairs = runDoctorFixes(ctx.cwd);
          jsonResponse(res, 200, { repairs });
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message });
        }
      },
    },
  ];
}
