/**
 * MCP Server module — expose KOTA tools via the Model Context Protocol.
 *
 * Contributes the `mcpServer` namespace and its `start` operation. The
 * `kota mcp-server` CLI is the contract's only consumer today: it routes
 * the boot request through `ctx.client.mcpServer.start(opts)`. The local
 * handler does the actual stdio or Streamable HTTP server start; the
 * daemon-side handler returns `daemon_required` because the daemon cannot
 * start a local MCP server in the operator's process.
 */

import { Command, InvalidArgumentError } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { McpServerClient } from "./client.js";
import { mcpConfigSlice } from "./config-slice.js";
import { localMcpServerClient } from "./mcp-server-operations.js";

const mcpServerModule: KotaModule = {
	name: "mcp-server",
	version: "1.0.0",
	description: "Expose KOTA tools via the Model Context Protocol",
	dependencies: ["prompt-templates", "repo-tasks"],
	configSlices: [mcpConfigSlice],

	commands: (ctx: ModuleContext) => {
		const cmd = new Command("mcp-server")
			.description("Start an MCP server exposing KOTA tools")
			.option(
				"--tools <names>",
				"Comma-separated list of tool names to expose (default: all)",
			)
			.option("--name <name>", "Server name reported to MCP clients", "kota")
			.option("--http", "Expose Streamable HTTP instead of stdio")
			.option("--host <host>", "Streamable HTTP bind host (localhost only)", "127.0.0.1")
			.option("--port <port>", "Streamable HTTP bind port (default: random free port)", parsePort)
			.action(async (opts) => {
				const toolFilter = opts.tools
					? (opts.tools as string).split(",").map((s: string) => s.trim())
					: undefined;
				const result = await ctx.client.mcpServer.start({
					name: opts.name,
					...(toolFilter !== undefined && { toolFilter }),
					...(opts.http
						? {
							transport: "http" as const,
							host: opts.host as string,
							port: (opts.port as number | undefined) ?? 0,
						}
						: {}),
				});
				if (result.ok) {
					if ("transport" in result && result.transport === "http") {
						console.log(`MCP Streamable HTTP endpoint: ${result.url}`);
					}
					return;
				}
				console.error(
					"Cannot start `kota mcp-server` while a daemon is running. Stop the daemon first (`kota daemon stop`) before exposing the local MCP surface.",
				);
				process.exit(1);
			});

		return [cmd];
	},

	localClient: () => ({ mcpServer: localMcpServerClient() }),

	daemonClient: (_link: DaemonTransport) => ({
		mcpServer: buildMcpServerDaemonHandler(),
	}),
};

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
		throw new InvalidArgumentError("port must be an integer between 0 and 65535");
	}
	return port;
}

/**
 * Daemon-side `McpServerClient` — a stub-only handler that never reaches
 * into the typed `DaemonTransport`. The capability under this namespace is
 * a long-running stdio MCP server in the operator's address space; the
 * daemon cannot start one on the operator's behalf, so the handler refuses
 * uniformly with `{ ok: false, reason: "daemon_required" }`. The CLI maps
 * that to a clear "stop the daemon first" hint. The `_link` parameter on
 * the factory is intentionally unused: this validates that the foundation
 * hook supports namespaces whose entire daemon contract is a constant
 * refusal, mirroring the eventual shape for `web` and any future namespace
 * whose semantics are inherently local-only.
 */
function buildMcpServerDaemonHandler(): McpServerClient {
	return {
		start: async () => ({ ok: false, reason: "daemon_required" as const }),
	};
}

export default mcpServerModule;
