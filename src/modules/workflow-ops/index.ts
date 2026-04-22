/**
 * Workflow ops module — owns the `kota workflow` CLI surface.
 *
 * Registers all workflow subcommands: run list/show/step-inspect/follow/trigger,
 * control (pause/resume/abort/reload), validate, definitions, logs, gc, export,
 * diff, cost, and stats.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { registerDefinitionLogCommand } from "./definitions/definition-log.js";
import { registerDefinitionsCommand } from "./definitions/definitions.js";
import { registerDepsCommand } from "./definitions/deps.js";
import { registerValidateCommand } from "./definitions/validate.js";
import { registerControlCommands } from "./execution/control.js";
import { registerGcCommand } from "./execution/gc.js";
import { registerRunCommand } from "./execution/run.js";
import { registerTriggerCommands } from "./execution/trigger.js";
import { registerTriggersCommand } from "./execution/triggers.js";
import { workflowRoutes } from "./routes/routes.js";
import { registerFollowCommand } from "./runs/follow.js";
import { registerLogsCommand } from "./runs/logs.js";
import { registerCostCommand } from "./runs/run-cost.js";
import { registerRunDiffCommand } from "./runs/run-diff.js";
import { registerExportCommand } from "./runs/run-export.js";
import { registerRunListCommands } from "./runs/run-list.js";
import { registerRunShowCommand } from "./runs/run-show.js";
import { registerStatsCommand } from "./runs/run-stats.js";
import { registerStepInspectCommand } from "./runs/step-inspect.js";

export function buildWorkflowCommand(ctx: ModuleContext): Command {
  const wfCmd = new Command("workflow")
    .alias("wf")
    .description(
      "Inspect workflow runs and control the daemon.\n\n" +
        "  Control commands (status, pause, resume, abort, reload) use the daemon\n" +
        "  control API when a daemon is running, and fall back to signal files when\n" +
        "  no daemon is reachable.\n\n" +
        "  Inspection commands (list, show, definitions, logs, follow) read artifacts\n" +
        "  or static definitions directly.",
    );

  registerRunListCommands(wfCmd);
  registerStatsCommand(wfCmd);
  registerExportCommand(wfCmd);
  registerRunShowCommand(wfCmd);
  registerStepInspectCommand(wfCmd);
  registerRunDiffCommand(wfCmd);
  registerDefinitionsCommand(wfCmd, ctx);
  registerDepsCommand(wfCmd, ctx);
  registerDefinitionLogCommand(wfCmd, ctx);
  registerCostCommand(wfCmd);
  registerLogsCommand(wfCmd);
  registerFollowCommand(wfCmd);
  registerTriggerCommands(wfCmd, ctx);
  registerTriggersCommand(wfCmd, ctx);
  registerValidateCommand(wfCmd, ctx);
  registerControlCommands(wfCmd);
  registerRunCommand(wfCmd, ctx);
  registerGcCommand(wfCmd);

  return wfCmd;
}

const workflowModule: KotaModule = {
  name: "workflow-ops",
  version: "1.0.0",
  description: "Workflow CLI surface — kota workflow list/show/run/control/validate/definitions/deps/logs/gc/export/diff/cost/stats",
  dependencies: ["rendering"],
  commands: (ctx) => [buildWorkflowCommand(ctx)],
  routes: (ctx) => workflowRoutes(ctx),
};

export default workflowModule;
