/**
 * `GET /api/digest` — daemon HTTP counterpart to the Telegram `/digest`
 * command and the `kota digest` CLI. Web and native clients consume this
 * route through the daemon control server to read the same on-demand digest
 * body terminal/chat surfaces already emit, so the rolled-up output cannot
 * drift between operator surfaces.
 *
 * Honors the on-demand seam invariants: reuses `renderOnDemandDigest`, so it
 * does not write `.kota/daily-digest-state.json` and does not emit
 * `workflow.daily.digest`. Per the no-cost-bias-in-autonomy contract, this
 * body is operator-facing only — it never reaches an autonomy agent prompt
 * because the route is an HTTP handler, not an agent step with
 * `exposeOutputToAgent`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { renderOnDemandDigest } from "./on-demand.js";

function parseWindowEndMs(raw: string): number | { error: string } {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { error: "windowEndMs must be a finite number" };
  }
  return value;
}

export function digestRoutes(opts: { projectDir: string }): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/digest",
      handler: (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const rawWindowEnd = url.searchParams.get("windowEndMs");
        let windowEndMs: number | undefined;
        if (rawWindowEnd !== null) {
          const parsed = parseWindowEndMs(rawWindowEnd);
          if (typeof parsed !== "number") {
            jsonResponse(res, 400, parsed);
            return;
          }
          windowEndMs = parsed;
        }
        try {
          const result = renderOnDemandDigest({
            projectDir: opts.projectDir,
            windowEndMs,
          });
          jsonResponse(res, 200, { data: result.data, text: result.text });
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message });
        }
      },
    },
  ];
}
