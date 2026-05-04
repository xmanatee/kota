/**
 * Local-side handler for the `web` namespace.
 *
 * `kota serve` boots a long-running HTTP API server with SSE streaming and
 * the embedded web UI. The work is fundamentally local: it spins up a
 * server in the operator's address space, so the daemon-side handler
 * surfaces `daemon_required` and the local handler runs the boot logic
 * directly. The promise resolves when the server shuts down.
 *
 * The CLI bootstraps a `"commands"` ModuleLoader for fast subcommand
 * registration, but the web server is a long-lived runtime host: serving
 * `/api/knowledge`, `/api/memory`, `/api/history`, `/recall`, `/answer`, and
 * any other module-contributed route requires every module's `onLoad` to
 * have registered its provider-backed seam. Drive a fresh runtime-mode load
 * here so the started server never reads contributions from the CLI's
 * partial state — the loader's typed accessors enforce this too.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import { warnUnknownConfigKeys } from "#core/config/config-warnings.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { startServer } from "#core/server/server.js";
import type { WebClient, WebStartOptions, WebStartResult } from "./client.js";
import { setWebUiDir } from "./static-routes.js";

export function localWebClient(ctx: ModuleContext): WebClient {
  return {
    async start(options: WebStartOptions): Promise<WebStartResult> {
      const verbose = (options.verbose ?? false) || ctx.config.verbose;
      const runtimeLoader = await loadRuntimeModules({
        config: ctx.config,
        cwd: ctx.cwd,
        verbose,
      });

      warnUnknownConfigKeys(
        ctx.cwd,
        (msg) => console.warn(msg),
        runtimeLoader.getRegisteredConfigKeys(),
      );

      const webUiDir = resolve(ctx.cwd, "clients/web/dist");
      const webUiBuilt = existsSync(webUiDir);
      if (!webUiBuilt) {
        console.warn("Warning: Web UI not built. Run `pnpm --filter @kota/web build` in the web client directory.");
      }
      setWebUiDir(webUiBuilt ? webUiDir : undefined);

      const moduleRoutes = runtimeLoader.getRoutes();

      startServer({
        port: options.port,
        model: options.model || ctx.config.model,
        verbose,
        config: ctx.config,
        noAuth: options.noAuth === true,
        resolveDefaultAutonomyMode: () =>
          resolveChannelAutonomyMode(undefined, ctx.config, "web server"),
        moduleRoutes,
        assembleDaemonHandlers: (transport) =>
          runtimeLoader.assembleDaemonClientHandlers(transport),
      });
      return { ok: true };
    },
  };
}
