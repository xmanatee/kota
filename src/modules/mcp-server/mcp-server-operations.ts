/**
 * Local-side handler for the `mcpServer` namespace.
 *
 * `kota mcp-server` boots a JSON-RPC stdio MCP server so any MCP-compatible
 * host (Claude Code, Cursor, VS Code) can use KOTA's tools. The work is
 * fundamentally local: it spins up a server in the operator's address
 * space using stdin/stdout, so the daemon-side handler returns
 * `daemon_required` and the local handler runs the boot logic directly.
 *
 * The server requires fully-loaded modules (not commandsOnly), because
 * tool dispatch needs every contributed tool to be registered. The
 * operations file therefore re-loads the module set in non-commandsOnly
 * mode to mirror the existing pre-namespace behavior.
 */
import { loadConfig } from "#core/config/config.js";
import { discoverModules } from "#core/modules/module-discovery.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { discoverProjectModules } from "#core/modules/project-discovery.js";
import type {
  McpServerClient,
  McpServerStartOptions,
  McpServerStartResult,
} from "#core/server/kota-client.js";

export function localMcpServerClient(): McpServerClient {
  return {
    async start(options: McpServerStartOptions): Promise<McpServerStartResult> {
      const { McpServer } = await import("./server.js");

      const config = loadConfig(process.cwd());
      const loader = new ModuleLoader(config, false);
      const projectModules = await discoverProjectModules();
      const modules = await discoverModules(process.cwd());
      await loader.loadAll(projectModules, modules);

      const samplingEnabled = config.mcp?.sampling?.enabled === true;
      let modelClient;
      if (samplingEnabled) {
        const { createModelClient } = await import("#core/model/model-client.js");
        modelClient = createModelClient({
          model: config.model || "claude-sonnet-4-6",
        }).client;
      }

      const server = new McpServer({
        ...(options.toolFilter !== undefined && { toolFilter: options.toolFilter }),
        name: options.name,
        samplingEnabled,
        modelClient,
        ...(config.model !== undefined && { samplingModel: config.model }),
      });

      process.on("SIGINT", () => {
        server.stop();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        server.stop();
        process.exit(0);
      });

      await server.start();
      return { ok: true };
    },
  };
}
