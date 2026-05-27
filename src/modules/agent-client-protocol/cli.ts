import { Command } from "commander";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import { HttpAcpDaemonClient } from "./daemon-adapter.js";
import { runAgentClientProtocolStdio } from "./stdio.js";

export function buildAgentClientProtocolCommand(): Command {
  return new Command("acp")
    .description("Run KOTA as an Agent Client Protocol agent over stdio")
    .option(
      "--autonomy-mode <mode>",
      "KOTA autonomy mode for daemon-owned ACP sessions (passive, supervised, autonomous)",
      "supervised",
    )
    .action(async (opts: { autonomyMode: string }) => {
      if (!isAutonomyMode(opts.autonomyMode)) {
        console.error("Error: --autonomy-mode must be one of: passive, supervised, autonomous");
        process.exitCode = 1;
        return;
      }
      const autonomyMode: AutonomyMode = opts.autonomyMode;
      await runAgentClientProtocolStdio({
        input: process.stdin,
        output: process.stdout,
        error: process.stderr,
        daemonFactory: () => {
          const transport = getDaemonTransport();
          return transport ? new HttpAcpDaemonClient(transport, autonomyMode) : null;
        },
      });
    });
}
