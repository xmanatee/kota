import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { withProcessSignalAbort } from "#core/util/process-signal-abort.js";
import { invokeNativeRunTool } from "#core/workflow/native-run-authorization.js";
import { writeJson } from "#modules/rendering/transport.js";
import { buildEvalCommand as buildBaseEvalCommand } from "./cli.js";
import { registerAgyModelsCommand } from "./cli-agy-models.js";
import { parseContainedEvaluationRequest } from "./contained-evaluation.js";

export function buildEvalCommand(ctx: ModuleContext): Command {
  const command = buildBaseEvalCommand(ctx);
  registerAgyModelsCommand(command, ctx);
  command.command("contained")
    .description("Request a contained evaluation from this native workflow's trusted runtime")
    .argument("<request>", 'JSON: {"operation":"inspect"}, {"operation":"probe","profile":"name","probeId":"id"}, {"operation":"run","profile":"name","fixtureIds":["id"],"repeatCount":1}, or agy-models with candidates')
    .action(async (raw: string) => {
      const request = parseContainedEvaluationRequest(JSON.parse(raw));
      const result = await withProcessSignalAbort((abort) => invokeNativeRunTool(ctx.cwd, "contained_evaluation", request, abort.signal));
      writeJson(result);
      if (result.is_error) process.exitCode = 1;
    });
  return command;
}
