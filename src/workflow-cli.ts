import type { Command } from "commander";
import { registerControlCommands } from "./workflow-cli/control.js";
import { registerLogsCommand } from "./workflow-cli/logs.js";
import { registerRunListCommands } from "./workflow-cli/run-list.js";
import { registerRunShowCommand } from "./workflow-cli/run-show.js";
import { registerTriggerCommands } from "./workflow-cli/trigger.js";

export function registerWorkflowCommands(program: Command): void {
  const wfCmd = program
    .command("workflow")
    .alias("wf")
    .description("Inspect workflow runs and runtime state");

  registerRunListCommands(wfCmd);
  registerRunShowCommand(wfCmd);
  registerLogsCommand(wfCmd);
  registerTriggerCommands(wfCmd);
  registerControlCommands(wfCmd);
}
