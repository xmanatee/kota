/**
 * Local-side handler for the `web` namespace.
 *
 * `kota serve` boots a long-running HTTP API server with SSE streaming and
 * the embedded web UI. The work is fundamentally local: it spins up a
 * server in the operator's address space, so the daemon-side handler
 * surfaces `daemon_required` and the local handler runs the boot logic
 * directly. The promise resolves when the server shuts down.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { warnUnknownConfigKeys } from "#core/config/config-warnings.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  WebClient,
  WebStartOptions,
  WebStartResult,
} from "#core/server/kota-client.js";
import { startServer } from "#core/server/server.js";
import { setWebUiDir } from "./static-routes.js";

export function localWebClient(ctx: ModuleContext): WebClient {
  return {
    async start(options: WebStartOptions): Promise<WebStartResult> {
      warnUnknownConfigKeys(ctx.cwd, (msg) => console.warn(msg), ctx.getRegisteredConfigKeys());

      const webUiDir = resolve(ctx.cwd, "clients/web/dist");
      const webUiBuilt = existsSync(webUiDir);
      if (!webUiBuilt) {
        console.warn("Warning: Web UI not built. Run `pnpm --filter @kota/web build` in the web client directory.");
      }
      setWebUiDir(webUiBuilt ? webUiDir : undefined);

      const moduleRoutes = ctx.getRoutes();

      startServer({
        port: options.port,
        model: options.model || ctx.config.model,
        verbose: (options.verbose ?? false) || ctx.config.verbose,
        config: ctx.config,
        noAuth: options.noAuth === true,
        defaultAutonomyMode: resolveChannelAutonomyMode(
          undefined,
          ctx.config,
          "web server",
        ),
        moduleRoutes,
      });
      return { ok: true };
    },
  };
}
