/**
 * Local-side handler for the `mcpServer` namespace.
 *
 * `kota mcp-server` boots a JSON-RPC stdio MCP server so any MCP-compatible
 * host (Claude Code, Cursor, VS Code) can use KOTA's tools. The work is
 * fundamentally local: it spins up a server in the operator's address
 * space using stdin/stdout, so the daemon-side handler returns
 * `daemon_required` and the local handler runs the boot logic directly.
 *
 * The server requires fully-loaded modules (lifecycle mode `"runtime"`,
 * not `"commands"`) because tool dispatch needs every contributed tool
 * registered and provider-backed routes need their `onLoad` to have run.
 * The shared `loadRuntimeModules` helper drives that lifecycle for any
 * long-lived host.
 */
import { loadConfig } from "#core/config/config.js";
import type { ModelClient } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import type {
  McpServerClient,
  McpServerStartOptions,
  McpServerStartResult,
} from "./client.js";

export function localMcpServerClient(): McpServerClient {
  return {
    async start(options: McpServerStartOptions): Promise<McpServerStartResult> {
      const { McpServer } = await import("./server.js");

      const config = loadConfig(process.cwd());
      await loadRuntimeModules({ config, cwd: process.cwd() });

      const samplingEnabled = config.mcp?.sampling?.enabled === true;
      let modelClient: ModelClient | undefined;
      if (samplingEnabled) {
        const { createModelClient } = await import("#core/model/model-client.js");
        modelClient = createModelClient({
          model:
            config.model || resolveActivePresetFromConfig(config).defaultModel,
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
