import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModuleContext } from "#core/modules/module-types.js";
import { runAgyModelEvaluationSuite } from "./agy-model-evaluation.js";
import type {
  AgyModelEvaluationOptions,
  AgyModelEvaluationResult,
} from "./agy-model-evaluation-types.js";
import { validateAgyModelEvaluationRequest } from "./eval-request-validation.js";
import {
  type EvalJsonValue,
  readEvalJsonBody,
  writeEvalJson,
} from "./eval-route-http.js";

export function agyModelEvaluationRoute(ctx: ModuleContext) {
  return {
    method: "POST" as const,
    path: "/api/eval/agy-models",
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      let body: EvalJsonValue;
      try {
        body = await readEvalJsonBody(req);
      } catch (error) {
        writeEvalJson(res, 400, { error: (error as Error).message });
        return;
      }
      let options: AgyModelEvaluationOptions;
      try {
        options = validateAgyModelEvaluationRequest(body);
      } catch (error) {
        writeEvalJson(res, 400, { error: (error as Error).message });
        return;
      }
      let result: AgyModelEvaluationResult;
      try {
        result = await runAgyModelEvaluationSuite(ctx.cwd, options);
      } catch (error) {
        writeEvalJson(res, 500, { error: (error as Error).message });
        return;
      }
      writeEvalJson(res, 200, result);
    },
  };
}
