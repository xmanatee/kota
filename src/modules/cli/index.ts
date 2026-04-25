/**
 * CLI module — owns the interactive runtime navigator.
 *
 * The navigator is one operator-facing client of the daemon control surface;
 * native, web, and mobile clients use the same `KotaClient` contract through
 * different transports. This module ships the `kota navigate` command and
 * the navigator implementation; everything else is just rendering and the
 * standard contract.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { getTerminalTransport } from "#modules/rendering/transport.js";
import { createReadlinePrompt, refuseNonTtyLaunch, runNavigator } from "./navigator.js";

const cliModule: KotaModule = {
  name: "cli",
  version: "1.0.0",
  description: "Interactive runtime navigator for the KOTA CLI",
  dependencies: ["rendering", "approval-queue", "daemon-ops", "module-manager", "repo-tasks"],

  commands: (ctx: ModuleContext) => {
    const navigate = new Command("navigate")
      .description("Open the interactive runtime navigator (TTY only)")
      .action(async () => {
        if (process.stdin.isTTY !== true) {
          refuseNonTtyLaunch(process.stderr);
          process.exitCode = 1;
          return;
        }
        await runNavigator({
          client: ctx.client,
          prompt: createReadlinePrompt(),
          output: getTerminalTransport(),
        });
      });
    return [navigate];
  },
};

export default cliModule;
