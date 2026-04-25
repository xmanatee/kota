/**
 * MCP Server module — expose KOTA tools via the Model Context Protocol.
 *
 * Contributes the `mcpServer` namespace and its `start` operation. The
 * `kota mcp-server` CLI is the contract's only consumer today: it routes
 * the boot request through `ctx.client.mcpServer.start(opts)`. The local
 * handler does the actual stdio-server start; the daemon-side handler
 * returns `daemon_required` because the daemon cannot start a stdio MCP
 * server in another process.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { localMcpServerClient } from "./mcp-server-operations.js";

const mcpServerModule: KotaModule = {
	name: "mcp-server",
	version: "1.0.0",
	description: "Expose KOTA tools via the Model Context Protocol (stdio)",
	dependencies: ["repo-tasks"],
	configKeys: [{ key: "mcp", description: "MCP server and sampling configuration" }],

	commands: (ctx: ModuleContext) => {
		const cmd = new Command("mcp-server")
			.description("Start an MCP server exposing KOTA tools over stdio")
			.option(
				"--tools <names>",
				"Comma-separated list of tool names to expose (default: all)",
			)
			.option("--name <name>", "Server name reported to MCP clients", "kota")
			.action(async (opts) => {
				const toolFilter = opts.tools
					? (opts.tools as string).split(",").map((s: string) => s.trim())
					: undefined;
				const result = await ctx.client.mcpServer.start({
					name: opts.name,
					...(toolFilter !== undefined && { toolFilter }),
				});
				if (result.ok) return;
				console.error(
					"Cannot start `kota mcp-server` while a daemon is running. Stop the daemon first (`kota daemon stop`) before exposing the stdio MCP surface.",
				);
				process.exit(1);
			});

		return [cmd];
	},

	localClient: () => ({ mcpServer: localMcpServerClient() }),
};

export default mcpServerModule;
