/**
 * Web module — HTTP API server with SSE streaming and embedded web UI.
 *
 * Contributes the `web` namespace and its `start` operation. The
 * `kota serve` CLI is the contract's only consumer today: it routes the
 * boot request through `ctx.client.web.start(opts)`. The local handler
 * does the actual server start; the daemon-side handler returns
 * `daemon_required` because the daemon cannot start a fresh `kota serve`
 * process in another address space.
 */

import { Command } from "commander";
import type { KotaModule } from "#core/modules/module-types.js";
import { staticWebUiRoutes } from "./static-routes.js";
import { localWebClient } from "./web-operations.js";

function parseIntOption(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Error: --${name} must be a positive integer, got "${value}"`);
    process.exit(1);
  }
  return n;
}

const webModule: KotaModule = {
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
      .action(async (opts) => {
        const port = parseIntOption(opts.port, "port");
        // Check the API key up front so the failure is reported the same way
        // regardless of whether the selector picked the local or daemon
        // transport. The local handler also reports `missing_api_key`, but
        // routing through the daemon transport would mask it as
        // `daemon_required`.
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
        const result = await ctx.client.web.start({
          port,
          ...(opts.model !== undefined && { model: opts.model }),
          ...(opts.verbose !== undefined && { verbose: opts.verbose }),
          ...(opts.auth === false && { noAuth: true }),
        });
        if (result.ok) return;
        if (result.reason === "missing_api_key") {
          // Reachable only if the env var was set when the action started but
          // unset by the time the local handler ran — keep the same hint.
          console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
          process.exit(1);
        }
        // daemon_required: a daemon is already running. Two web servers in the
        // same project would conflict on autonomy state and likely on the port,
        // so the contract refuses uniformly and points the operator at the fix.
        console.error(
          "Cannot start `kota serve` while a daemon is running. Stop the daemon first (`kota daemon stop`) or run `kota serve` against a separate project directory.",
        );
        process.exit(1);
      });

    return [cmd];
  },

  routes: () => staticWebUiRoutes(),
  localClient: (ctx) => ({ web: localWebClient(ctx) }),
};

export default webModule;
