import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/index.js";
import { validateToolStructuredOutput } from "#core/tools/output-schema.js";
import { McpClient, type McpToolSchema } from "./client.js";

type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

type McpConfig = {
  mcpServers: Record<string, McpServerConfig>;
};

type McpToolEntry = {
  client: McpClient;
  originalName: string;
  tool: KotaTool;
};

const SEPARATOR = "__";

/** Build a namespaced tool name: mcp__<server>__<tool> */
export function namespaceTool(serverName: string, toolName: string): string {
  return `mcp${SEPARATOR}${serverName}${SEPARATOR}${toolName}`;
}

/** Parse a namespaced tool name back to server + tool. Returns null if not an MCP tool. */
export function parseToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith(`mcp${SEPARATOR}`)) return null;
  const parts = name.split(SEPARATOR);
  if (parts.length < 3) return null;
  return { server: parts[1], tool: parts.slice(2).join(SEPARATOR) };
}

/** Convert an MCP tool schema to a neutral KotaTool with namespaced name. */
function toKotaTool(serverName: string, tool: McpToolSchema): KotaTool {
  return {
    name: namespaceTool(serverName, tool.name),
    description: tool.description
      ? `[${serverName}] ${tool.description}`
      : `[${serverName}] ${tool.name}`,
    input_schema: {
      type: "object",
      properties: tool.inputSchema.properties ?? {},
      ...(tool.inputSchema.required && { required: tool.inputSchema.required }),
    },
    ...(tool.outputSchema ? { output_schema: tool.outputSchema } : {}),
  };
}

/**
 * Manages multiple MCP server connections and their tools.
 * Handles config loading, lifecycle, and tool routing.
 */
export class McpManager {
  private clients = new Map<string, McpClient>();
  private toolMap = new Map<string, McpToolEntry>();
  private kotaTools: KotaTool[] = [];

  /** Load MCP config from .kota/mcp.json in the given directory. */
  static loadConfig(cwd?: string): McpConfig | null {
    const dir = cwd || process.cwd();
    const configPath = join(dir, ".kota", "mcp.json");
    if (!existsSync(configPath)) return null;
    try {
      const raw = readFileSync(configPath, "utf-8");
      return JSON.parse(raw) as McpConfig;
    } catch (err) {
      console.error(`[kota] Warning: failed to parse ${configPath}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Connect to all configured MCP servers. Logs warnings for failures. */
  async initialize(config: McpConfig): Promise<void> {
    const entries = Object.entries(config.mcpServers || {});
    if (entries.length === 0) return;

    const results = await Promise.allSettled(
      entries.map(async ([name, serverConfig]) => {
        const client = new McpClient(
          serverConfig.command,
          serverConfig.args || [],
          serverConfig.env || {},
          name,
        );
        try {
          await client.connect();
          const tools = await client.listTools();
          return { name, client, tools };
        } catch (err) {
          console.error(
            `[kota] MCP server "${name}" failed to connect: ${(err as Error).message}`,
          );
          await client.close().catch(() => {});
          return null;
        }
      }),
    );

    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const { name, client, tools } = result.value;
      this.clients.set(name, client);

      for (const tool of tools) {
        const nsName = namespaceTool(name, tool.name);
        const kotaTool = toKotaTool(name, tool);
        this.toolMap.set(nsName, { client, originalName: tool.name, tool: kotaTool });
        this.kotaTools.push(kotaTool);
      }

      console.error(
        `[kota] MCP server "${name}" connected — ${tools.length} tool${tools.length !== 1 ? "s" : ""}`,
      );
    }
  }

  /** Get all MCP tools as neutral KotaTool entries. */
  getTools(): KotaTool[] {
    return this.kotaTools;
  }

  /** Check if a tool name belongs to an MCP server. */
  isMcpTool(name: string): boolean {
    return this.toolMap.has(name);
  }

  /** Execute an MCP tool by its namespaced name. */
  async executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const entry = this.toolMap.get(name);
    if (!entry) return { content: `Unknown MCP tool: ${name}`, is_error: true };

    if (!entry.client.isConnected()) {
      return { content: `MCP server disconnected for tool: ${name}`, is_error: true };
    }

    try {
      const result = await entry.client.callTool(entry.originalName, input);
      const toolResult: ToolResult = {
        content: result.text,
        blocks: result.blocks,
        ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
        ...(result._meta ? { _meta: result._meta } : {}),
        ...(result.isError !== undefined ? { is_error: result.isError } : {}),
      };
      const schemaError = validateToolStructuredOutput(entry.tool, toolResult);
      if (schemaError) {
        return { content: `MCP tool error: ${schemaError}`, is_error: true };
      }
      return toolResult;
    } catch (err) {
      if (!entry.client.isConnected()) {
        return { content: `MCP server disconnected for tool: ${name}`, is_error: true };
      }
      return { content: `MCP tool error: ${(err as Error).message}`, is_error: true };
    }
  }

  /** Disconnect all MCP servers. */
  async close(): Promise<void> {
    const closers = [...this.clients.values()].map((c) => c.close().catch(() => {}));
    await Promise.all(closers);
    this.clients.clear();
    this.toolMap.clear();
    this.kotaTools = [];
  }

  /** Get number of connected servers. */
  getServerCount(): number {
    return this.clients.size;
  }

  /** Get total number of MCP tools available. */
  getToolCount(): number {
    return this.toolMap.size;
  }
}
