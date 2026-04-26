/**
 * `GET /api/attention` — daemon HTTP counterpart to the Telegram `/attention`
 * command and the `kota attention` CLI. Web and native clients consume this
 * route through the daemon control server to read the same on-demand
 * attention body chat/terminal surfaces already emit, so the rolled-up
 * output cannot drift between operator surfaces.
 *
 * Honors the on-demand seam invariants from the workflow's local AGENTS.md:
 * reuses `renderOnDemandAttention`, so it does not write
 * `<runsDir>/../attention-digest-counter.json` and does not emit
 * `workflow.attention.digest`. Per the no-cost-bias-in-autonomy contract,
 * this body is operator-facing only — it never reaches an autonomy agent
 * prompt because the route is an HTTP handler, not an agent step with
 * `exposeOutputToAgent`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { renderOnDemandAttention } from "./step.js";

export function attentionRoutes(opts: {
  projectDir: string;
}): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/attention",
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        try {
          const runsDir = join(opts.projectDir, ".kota", "runs");
          const result = renderOnDemandAttention({
            projectDir: opts.projectDir,
            runsDir,
          });
          jsonResponse(res, 200, {
            data: { items: result.items },
            text: result.text,
          });
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message });
        }
      },
    },
  ];
}
