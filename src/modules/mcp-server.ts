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
import type { ExtensionContext, KotaExtension } from "../extension-types.js";

const mcpServerModule: KotaExtension = {
	name: "mcp-server",
	version: "1.0.0",
	description: "Expose KOTA tools via the Model Context Protocol (stdio)",

	commands: (_ctx: ExtensionContext) => {
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
				const { ExtensionLoader } = await import("../extension-loader.js");
				const { builtinExtensions } = await import("./index.js");
				const { discoverExtensions } = await import(
					"../extension-discovery.js"
				);

				const config = loadConfig(process.cwd());

				// Load modules to register their tools (commandsOnly=false)
				const loader = new ExtensionLoader(config, false);
				const pluginModules = await discoverExtensions(process.cwd());
				await loader.loadAll([...builtinExtensions, ...pluginModules]);

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
