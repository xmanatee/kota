import type { Command } from "commander";
import { registerControlCommands } from "./workflow-cli/control.js";
import { registerFollowCommand } from "./workflow-cli/follow.js";
import { registerLogsCommand } from "./workflow-cli/logs.js";
import { registerRunCommand } from "./workflow-cli/run.js";
import { registerCostCommand } from "./workflow-cli/run-cost.js";
import { registerRunListCommands } from "./workflow-cli/run-list.js";
import { registerRunShowCommand } from "./workflow-cli/run-show.js";
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
      "  Inspection commands (list, show, logs, follow) read run artifacts directly.",
    );

  registerRunListCommands(wfCmd);
  registerRunShowCommand(wfCmd);
  registerCostCommand(wfCmd);
  registerLogsCommand(wfCmd);
  registerFollowCommand(wfCmd);
  registerTriggerCommands(wfCmd);
  registerControlCommands(wfCmd);
  registerRunCommand(wfCmd);
}
