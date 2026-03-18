/**
 * MCP Server module — expose KOTA tools via the Model Context Protocol.
 *
 * Registers:
 * - `kota mcp-server` CLI command (starts stdio MCP server)
 *
 * Any MCP-compatible host (Claude Code, Cursor, VS Code) can connect
 * and use KOTA's tools without a custom integration.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "../module-types.js";

const mcpServerModule: KotaModule = {
	name: "mcp-server",
	version: "1.0.0",
	description: "Expose KOTA tools via the Model Context Protocol (stdio)",

	commands: (_ctx: ModuleContext) => {
		const cmd = new Command("mcp-server")
			.description("Start an MCP server exposing KOTA tools over stdio")
			.option(
				"--tools <names>",
				"Comma-separated list of tool names to expose (default: all)",
			)
			.option("--name <name>", "Server name reported to MCP clients", "kota")
			.action(async (opts) => {
				const { McpServer } = await import("../mcp/server.js");
				const { loadConfig } = await import("../config.js");
				const { ModuleLoader } = await import("../module-loader.js");
				const { builtinModules } = await import("./index.js");
				const { discoverPluginModules } = await import(
					"../plugin-loader.js"
				);

				const config = loadConfig(process.cwd());

				// Load modules to register their tools (commandsOnly=false)
				const loader = new ModuleLoader(config, false);
				const pluginModules = await discoverPluginModules(process.cwd());
				await loader.loadAll([...builtinModules, ...pluginModules]);

				const toolFilter = opts.tools
					? (opts.tools as string).split(",").map((s: string) => s.trim())
					: undefined;

				const server = new McpServer({
					toolFilter,
					name: opts.name,
				});

				// Graceful shutdown
				process.on("SIGINT", () => {
					server.stop();
					process.exit(0);
				});
				process.on("SIGTERM", () => {
					server.stop();
					process.exit(0);
				});

				await server.start();
			});

		return [cmd];
	},
};

export default mcpServerModule;
