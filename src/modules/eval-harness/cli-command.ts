import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { buildEvalCommand as buildBaseEvalCommand } from "./cli.js";
import { registerAgyModelsCommand } from "./cli-agy-models.js";

export function buildEvalCommand(ctx: ModuleContext): Command {
  const command = buildBaseEvalCommand(ctx);
  registerAgyModelsCommand(command, ctx);
  return command;
}
