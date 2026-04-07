/**
 * Web extension — HTTP API server with SSE streaming and embedded web UI.
 *
 * Extracts the serve CLI command from cli.ts into a KotaExtension,
 * continuing the extension-first architecture plan. The actual server logic
 * lives in src/server.ts; this extension wires it into the CLI as
 * `kota serve`.
 */

import { Command } from "commander";
import type { KotaExtension } from "../extension-types.js";
import { startServer } from "../server/server.js";

function parseIntOption(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Error: --${name} must be a positive integer, got "${value}"`);
    process.exit(1);
  }
  return n;
}

const webModule: KotaExtension = {
  name: "web",
  version: "1.0.0",
  description: "HTTP API server with SSE streaming and embedded web UI",

  commands: (ctx) => {
    const cmd = new Command("serve")
      .description("Start KOTA as an HTTP API server with SSE streaming")
      .option("-p, --port <port>", "Port to listen on", "3000")
      .option("-m, --model <model>", "Model to use")
      .option("-v, --verbose", "Show debug output")
      .option("--no-auth", "Disable bearer token auth (dev/localhost only)")
      .action((opts) => {
        const port = parseIntOption(opts.port, "port");

        if (!process.env.ANTHROPIC_API_KEY) {
          console.error(
            "Error: ANTHROPIC_API_KEY environment variable is not set.\n",
          );
          console.error("To get started:");
          console.error(
            "  1. Get your API key at https://console.anthropic.com/settings/keys",
          );
          console.error("  2. Export it in your shell:\n");
          console.error("     export ANTHROPIC_API_KEY=sk-ant-...\n");
          process.exit(1);
        }

        // Collect routes from all loaded extensions via ExtensionContext
        const extensionRoutes = ctx.getRoutes();

        startServer({
          port,
          model: opts.model || ctx.config.model,
          verbose: opts.verbose || ctx.config.verbose,
          config: ctx.config,
          noAuth: opts.auth === false,
          extensionRoutes,
          getExtensionSummaries: () => ctx.getExtensionSummaries(),
        });
      });

    return [cmd];
  },
};

export default webModule;
