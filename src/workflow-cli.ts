import type { Command } from "commander";
import { registerControlCommands } from "./workflow-cli/control.js";
import { registerDefinitionsCommand } from "./workflow-cli/definitions.js";
import { registerFollowCommand } from "./workflow-cli/follow.js";
import { registerGcCommand } from "./workflow-cli/gc.js";
import { registerLogsCommand } from "./workflow-cli/logs.js";
import { registerRunCommand } from "./workflow-cli/run.js";
import { registerCostCommand } from "./workflow-cli/run-cost.js";
import { registerRunListCommands } from "./workflow-cli/run-list.js";
import { registerRunShowCommand } from "./workflow-cli/run-show.js";
import { registerStatsCommand } from "./workflow-cli/run-stats.js";
import { registerTriggerCommands } from "./workflow-cli/trigger.js";

export function registerWorkflowCommands(program: Command): void {
  const wfCmd = program
    .command("workflow")
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
  registerRunShowCommand(wfCmd);
  registerDefinitionsCommand(wfCmd);
  registerCostCommand(wfCmd);
  registerLogsCommand(wfCmd);
  registerFollowCommand(wfCmd);
  registerTriggerCommands(wfCmd);
  registerControlCommands(wfCmd);
  registerRunCommand(wfCmd);
  registerGcCommand(wfCmd);
}
