/**
 * HTTP route that operators use to invoke the eval harness via the daemon's
 * server surface. The route accepts a typed body, validates it, kicks off the
 * run via the subprocess executor, and emits the aggregate telemetry event
 * when the run completes.
 *
 * Wire shape: typed eval failures (`no_fixtures`, `fixture_provenance`)
 * collapse to `200 + EvalRunResult` discriminated body, matching the skills
 * migration precedent. The `400` status is reserved for genuine protocol
 * errors (malformed JSON, type mismatch in the request envelope).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { agyModelEvaluationRoute } from "./agy-model-evaluation-route.js";
import type { EvalRunOptions, EvalRunResult } from "./client.js";
import { runEvalHarness } from "./eval-operations.js";
import { validateEvalRunRequest } from "./eval-request-validation.js";
import { readEvalJsonBody, writeEvalJson } from "./eval-route-http.js";
import { evalHarnessSetCompleted } from "./events.js";

/**
 * Build the route registration for the eval-harness module. Called from
 * `index.ts` via `routes: (ctx) => evalHarnessRoutes(ctx)`.
 */
export function evalHarnessRoutes(ctx: ModuleContext) {
  return [
    {
      method: "POST" as const,
      path: "/api/eval/run",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        let body: Awaited<ReturnType<typeof readEvalJsonBody>>;
        try {
          body = await readEvalJsonBody(req);
        } catch (err) {
          writeEvalJson(res, 400, { error: (err as Error).message });
          return;
        }
        let options: EvalRunOptions;
        try {
          options = validateEvalRunRequest(body);
        } catch (err) {
          writeEvalJson(res, 400, { error: (err as Error).message });
          return;
        }
        const bus = new EventBus();
        bus.on(evalHarnessSetCompleted, (payload) => {
          ctx.events.emit(evalHarnessSetCompleted, payload);
        });
        let result: EvalRunResult;
        try {
          result = await runEvalHarness(ctx.cwd, options, bus);
        } catch (err) {
          writeEvalJson(res, 500, { error: (err as Error).message });
          return;
        }
        writeEvalJson(res, 200, result);
      },
    },
    agyModelEvaluationRoute(ctx),
  ];
}
