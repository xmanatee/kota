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
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { createWebReadinessSource } from "./capability-readiness.js";
import type { WebClient } from "./client.js";
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

  onLoad(ctx) {
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createWebReadinessSource({ projectDir: ctx.cwd }),
    );
  },

  commands: (ctx) => {
    const cmd = new Command("serve")
      .description("Start KOTA as an HTTP API server with SSE streaming")
      .option("-p, --port <port>", "Port to listen on", "3000")
      .option("-m, --model <model>", "Model to use")
      .option("-v, --verbose", "Show debug output")
      .option("--no-auth", "Disable bearer token auth (dev/localhost only)")
      .action(async (opts) => {
        const port = parseIntOption(opts.port, "port");
        const result = await ctx.client.web.start({
          port,
          ...(opts.model !== undefined && { model: opts.model }),
          ...(opts.verbose !== undefined && { verbose: opts.verbose }),
          ...(opts.auth === false && { noAuth: true }),
        });
        if (result.ok) return;
        if (result.reason === "missing_api_key") {
          console.error("Error: No API key configured. Set ANTHROPIC_API_KEY or configure a provider.");
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

  routes: (ctx) => staticWebUiRoutes({ projectDir: ctx.cwd }),
  localClient: (ctx) => ({ web: localWebClient(ctx) }),

  daemonClient: (_link: DaemonTransport) => ({
    web: buildWebDaemonHandler(),
  }),
};

/**
 * Daemon-side `WebClient` — a stub-only handler that never reaches into
 * the typed `DaemonTransport`. The capability under this namespace is a
 * long-running HTTP API server with SSE streaming and the embedded web UI
 * in the operator's address space; the daemon cannot start one on the
 * operator's behalf, so the handler refuses uniformly with
 * `{ ok: false, reason: "daemon_required" }`. The CLI maps that to a
 * clear "stop the daemon first" hint. The `_link` parameter on the
 * factory is intentionally unused: this is the second namespace (after
 * mcp-server) whose entire daemon contract is a constant refusal,
 * generalizing the precedent that the foundation hook supports stub-only
 * contributions whose semantics are inherently local-only.
 */
function buildWebDaemonHandler(): WebClient {
  return {
    start: async () => ({ ok: false, reason: "daemon_required" as const }),
  };
}

export default webModule;
