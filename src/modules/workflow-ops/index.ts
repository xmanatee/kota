/**
 * Workflow ops module — owns the `kota workflow` CLI surface.
 *
 * Registers all workflow subcommands: run list/show/step-inspect/follow/trigger,
 * control (pause/resume/abort/reload), validate, definitions, logs, gc, export,
 * diff, cost, and stats.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "../../core/modules/module-types.js";
import { registerControlCommands } from "./control.js";
import { registerDefinitionLogCommand } from "./definition-log.js";
import { registerDefinitionsCommand } from "./definitions.js";
import { registerFollowCommand } from "./follow.js";
import { registerGcCommand } from "./gc.js";
import { registerLogsCommand } from "./logs.js";
import { workflowRoutes } from "./routes.js";
import { registerRunCommand } from "./run.js";
import { registerCostCommand } from "./run-cost.js";
import { registerRunDiffCommand } from "./run-diff.js";
import { registerExportCommand } from "./run-export.js";
import { registerRunListCommands } from "./run-list.js";
import { registerRunShowCommand } from "./run-show.js";
import { registerStatsCommand } from "./run-stats.js";
import { registerStepInspectCommand } from "./step-inspect.js";
import { registerTriggerCommands } from "./trigger.js";
import { registerTriggersCommand } from "./triggers.js";
import { registerValidateCommand } from "./validate.js";

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

  registerRunListCommands(wfCmd, ctx);
  registerStatsCommand(wfCmd);
  registerExportCommand(wfCmd);
  registerRunShowCommand(wfCmd);
  registerStepInspectCommand(wfCmd);
  registerRunDiffCommand(wfCmd);
  registerDefinitionsCommand(wfCmd, ctx);
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
  description: "Workflow CLI surface — kota workflow list/show/run/control/validate/definitions/logs/gc/export/diff/cost/stats",
  commands: (ctx) => [buildWorkflowCommand(ctx)],
  routes: () => workflowRoutes(),
};

export default workflowModule;
