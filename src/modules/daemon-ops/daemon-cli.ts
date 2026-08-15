import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { addDaemonControlCommands } from "./daemon-control-commands.js";
import { addDaemonServiceCommands } from "./daemon-service-commands.js";
import { createDaemonCommand } from "./daemon-start-command.js";
import { buildEventsCommand } from "./events-cli.js";
import { buildInboxCommand } from "./operator-inbox-cli.js";
import { buildUiCommand } from "./operator-ui-cli.js";
import { buildProjectCommand } from "./projects-cli.js";
import { buildQrCommand } from "./qr-cli.js";
import { buildSessionCommand } from "./session-cli.js";
import { buildStatusCommand } from "./status-cli.js";

export function buildDaemonCommands(ctx: ModuleContext): Command[] {
  const daemon = createDaemonCommand();
  addDaemonControlCommands(daemon);
  addDaemonServiceCommands(daemon);
  daemon.addCommand(buildQrCommand());
  return [
    daemon,
    buildEventsCommand(ctx),
    buildSessionCommand(ctx),
    buildStatusCommand(ctx),
    buildInboxCommand(ctx),
    buildUiCommand(ctx),
    buildProjectCommand(ctx),
  ];
}
