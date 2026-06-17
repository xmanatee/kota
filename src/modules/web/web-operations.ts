/**
 * Local-side handler for the `web` namespace.
 *
 * `kota serve` boots a long-running HTTP API server with SSE streaming and
 * the embedded web UI. The work is fundamentally local: it spins up a
 * server in the operator's address space, so the daemon-side handler
 * surfaces `daemon_required` and the local handler runs the boot logic
 * directly. The promise resolves once the listener is ready to accept
 * requests, or rejects if the listener fails to bind.
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
import type { Server } from "node:http";
import { resolve } from "node:path";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import {
  warnIgnoredUntrustedProjectConfig,
  warnUnknownConfigKeys,
} from "#core/config/config-warnings.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { type ServerListeningInfo, startServer } from "#core/server/server.js";
import { line, span, stack } from "#modules/rendering/primitives.js";
import { print, printToStderr } from "#modules/rendering/transport.js";
import type { WebClient, WebStartOptions, WebStartResult } from "./client.js";

function printWebWarning(message: string): void {
  printToStderr(line(span(message, "warn")));
}

function formatEndpointLine(endpoint: ServerListeningInfo["apiEndpoints"][number]): string {
  const route = `${endpoint.method.padEnd(4)} ${endpoint.path}`;
  return `  ${route.padEnd(25)}— ${endpoint.description}`;
}

function renderServerListening(info: ServerListeningInfo): void {
  print(stack(
    line(span(`KOTA server listening on http://${info.host}:${info.port}`, "success")),
    ...(info.authToken !== undefined
      ? [
        line(span(`Auth token: ${info.authToken}`, "info")),
        line(span(`Web UI:     ${info.webUiUrl}`, "info")),
      ]
      : [
        line(span(`Web UI:     ${info.webUiUrl}`, "info")),
        line(span("Warning: auth disabled (--no-auth). Do not expose this server on a shared network.", "warn")),
      ]),
    line(span("API endpoints:", "muted")),
    ...info.apiEndpoints.map((endpoint) =>
      line(span(
        formatEndpointLine(endpoint),
        "muted",
      ))
    ),
  ));
}

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
        printWebWarning,
        runtimeLoader.getRegisteredConfigKeys(),
      );
      warnIgnoredUntrustedProjectConfig(ctx.cwd, printWebWarning);

      const webUiDir = resolve(ctx.cwd, "clients/web/dist");
      const webUiBuilt = existsSync(webUiDir);
      if (!webUiBuilt) {
        printWebWarning("Warning: Web UI not built. Run `pnpm --filter @kota/web build` in the web client directory.");
      }

      const moduleRoutes = runtimeLoader.getRoutes();

      const server = startServer({
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
        onListening: renderServerListening,
      });
      await waitForServerListening(server);
      return { ok: true };
    },
  };
}

function waitForServerListening(server: Server): Promise<void> {
  if (server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    function cleanup(): void {
      server.off("listening", onListening);
      server.off("error", onError);
    }

    function onListening(): void {
      cleanup();
      resolve();
    }

    function onError(err: Error): void {
      cleanup();
      reject(err);
    }

    server.once("listening", onListening);
    server.once("error", onError);
  });
}
