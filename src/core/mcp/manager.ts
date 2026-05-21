import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  KotaJsonObject,
  KotaJsonValue,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/index.js";
import { validateToolStructuredOutput } from "#core/tools/output-schema.js";
import {
  type McpCallToolResult,
  McpClient,
  type McpClientTransportConfig,
  type McpElicitationMode,
  type McpInputRequiredCallToolResult,
  type McpProgressEvent,
  type McpStdioClientTransportConfig,
  type McpStreamableHttpClientTransportConfig,
  McpToolError,
  type McpToolInputRequests,
  type McpToolInputResponses,
  type McpToolSchema,
} from "./client.js";

export type McpServerStdioConfig = McpStdioClientTransportConfig;
export type McpServerHttpConfig = McpStreamableHttpClientTransportConfig;
export type McpServerConfig = McpServerStdioConfig | McpServerHttpConfig;

type McpConfig = {
  mcpServers: Record<string, McpServerConfig>;
};

export type McpManagerInitializeOptions = {
  inputResolverAvailable?: boolean;
};

type McpToolEntry = {
  client: McpClient;
  originalName: string;
  tool: KotaTool;
};

export type McpRemoteInputRequest = {
  server: string;
  tool: string;
  inputRequests: McpToolInputRequests;
  requestState?: string;
  resultMeta?: KotaJsonObject;
};

export type McpInputResolverResult =
  | { kind: "respond"; inputResponses: McpToolInputResponses }
  | { kind: "unavailable"; reason: string };

export type McpInputResolver = (
  request: McpRemoteInputRequest,
) => Promise<McpInputResolverResult>;

export type McpRemoteProgressEvent = McpProgressEvent & {
  server: string;
  tool: string;
};

export type McpProgressResolver = (event: McpRemoteProgressEvent) => void;

export type McpExecuteToolOptions = {
  inputResolver?: McpInputResolver;
  progressResolver?: McpProgressResolver;
  maxProgressEvents?: number;
};

const SEPARATOR = "__";
const MCP_CONFIG_FIELDS = new Set(["type", "command", "args", "env", "url", "headers"]);
const MCP_STDIO_FIELDS = ["command", "args", "env"] as const;
const MCP_HTTP_FIELDS = ["url", "headers"] as const;

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

function inputRequiredDiagnostics(
  entry: McpToolEntry,
  result: McpInputRequiredCallToolResult,
): KotaJsonObject {
  return {
    resultType: "input_required",
    protocolVersion: result.protocolVersion,
    server: entry.client.getName(),
    tool: entry.originalName,
    ...(result.inputRequests ? { inputRequests: result.inputRequests } : {}),
    ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
    ...(result._meta ? { resultMeta: result._meta } : {}),
  };
}

function unsupportedInputRequiredResult(
  entry: McpToolEntry,
  result: McpInputRequiredCallToolResult,
  reason?: string,
): ToolResult {
  const detail = reason
    ? ` ${reason}`
    : " this KOTA runtime cannot route remote input_required results yet.";
  return {
    content:
      `MCP tool error: remote MCP tool "${entry.originalName}" on server ` +
      `"${entry.client.getName()}" requires additional input, but${detail}`,
    is_error: true,
    _meta: { mcp: inputRequiredDiagnostics(entry, result) },
  };
}

function isJsonObject(value: McpServerConfig | KotaJsonValue): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function presentFields(raw: KotaJsonObject, fields: readonly string[]): string[] {
  return fields.filter((field) => raw[field] !== undefined);
}

function assertNoUnknownConfigFields(serverName: string, raw: KotaJsonObject): void {
  const unknownFields = Object.keys(raw).filter((field) => !MCP_CONFIG_FIELDS.has(field));
  if (unknownFields.length === 0) return;
  throw new Error(
    `Invalid MCP server config for "${serverName}": unexpected field${unknownFields.length === 1 ? "" : "s"} ${unknownFields.join(", ")}`,
  );
}

function decodeTransportType(
  serverName: string,
  value: KotaJsonValue | undefined,
): "stdio" | "http" {
  if (value === undefined) return "stdio";
  if (value === "stdio" || value === "http") return value;
  throw new Error(
    `Invalid MCP server config for "${serverName}": type must be "stdio" or "http"`,
  );
}

function optionalStringArray(
  value: KotaJsonValue | undefined,
  label: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value];
}

function optionalStringRecord(
  value: KotaJsonValue | undefined,
  label: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    throw new Error(`${label} must be an object with string values`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error(`${label}.${key} must be a string`);
    }
    out[key] = entry;
  }
  return out;
}

function normalizeMcpServerConfig(
  serverName: string,
  config: McpServerConfig,
): McpClientTransportConfig {
  if (!isJsonObject(config)) {
    throw new Error(`Invalid MCP server config for "${serverName}": config must be an object`);
  }
  const raw = config as KotaJsonObject;
  assertNoUnknownConfigFields(serverName, raw);
  const type = decodeTransportType(serverName, raw.type);
  if (type === "stdio") {
    const httpFields = presentFields(raw, MCP_HTTP_FIELDS);
    if (httpFields.length > 0) {
      throw new Error(
        `Invalid MCP server config for "${serverName}": stdio transport cannot define http field${httpFields.length === 1 ? "" : "s"} ${httpFields.join(", ")}`,
      );
    }
    if (typeof raw.command !== "string" || raw.command.length === 0) {
      throw new Error(
        `Invalid MCP server config for "${serverName}": stdio transport requires command`,
      );
    }
    const args = optionalStringArray(raw.args, "args");
    const env = optionalStringRecord(raw.env, "env");
    return {
      type: "stdio",
      command: raw.command,
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
    };
  }
  if (type === "http") {
    const stdioFields = presentFields(raw, MCP_STDIO_FIELDS);
    if (stdioFields.length > 0) {
      throw new Error(
        `Invalid MCP server config for "${serverName}": http transport cannot also define stdio fields`,
      );
    }
    if (typeof raw.url !== "string" || raw.url.length === 0) {
      throw new Error(
        `Invalid MCP server config for "${serverName}": http transport requires url`,
      );
    }
    const headers = optionalStringRecord(raw.headers, "headers");
    return {
      type: "http",
      url: raw.url,
      ...(headers ? { headers } : {}),
    };
  }
  throw new Error(
    `Invalid MCP server config for "${serverName}": type must be "stdio" or "http"`,
  );
}

function toToolResult(entry: McpToolEntry, result: McpCallToolResult): ToolResult {
  if (result.resultType === "input_required") {
    return unsupportedInputRequiredResult(
      entry,
      result,
      "the remote server requested additional input again after the retry.",
    );
  }
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
}

/**
 * Manages multiple MCP server connections and their tools.
 * Handles config loading, lifecycle, and tool routing.
 */
export class McpManager {
  private clients = new Map<string, McpClient>();
  private serverTools = new Map<string, McpToolEntry[]>();
  private toolMap = new Map<string, McpToolEntry>();
  private kotaTools: KotaTool[] = [];
  private toolListUnsubscribers = new Map<string, () => void>();
  private initializingServers = new Set<string>();
  private pendingServerRefreshes = new Set<string>();
  private refreshQueues = new Map<string, Promise<void>>();

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
  async initialize(
    config: McpConfig,
    options: McpManagerInitializeOptions = {},
  ): Promise<void> {
    const entries = Object.entries(config.mcpServers || {});
    if (entries.length === 0) return;
    const supportedElicitationModes: readonly McpElicitationMode[] =
      options.inputResolverAvailable === true ? ["form", "url"] : [];

    const results = await Promise.allSettled(
      entries.map(async ([name, serverConfig]) => {
        let client: McpClient | null = null;
        try {
          const transport = normalizeMcpServerConfig(name, serverConfig);
          client = new McpClient(
            transport,
            name,
            { supportedElicitationModes },
          );
          this.serverTools.set(name, []);
          await client.connect();
          this.clients.set(name, client);
          this.initializingServers.add(name);
          const unsubscribe = client.onToolListChanged(() => {
            this.queueServerToolRefresh(name);
          });
          this.toolListUnsubscribers.set(name, unsubscribe);
          const tools = await client.listTools();
          this.replaceServerTools(name, client, tools);
          this.initializingServers.delete(name);
          if (this.pendingServerRefreshes.delete(name)) {
            this.queueServerToolRefresh(name);
          }
          return { name, tools };
        } catch (err) {
          console.error(
            `[kota] MCP server "${name}" failed to connect: ${(err as Error).message}`,
          );
          this.initializingServers.delete(name);
          this.pendingServerRefreshes.delete(name);
          this.refreshQueues.delete(name);
          this.toolListUnsubscribers.get(name)?.();
          this.toolListUnsubscribers.delete(name);
          this.clients.delete(name);
          this.serverTools.delete(name);
          await client?.close().catch(() => {});
          return null;
        }
      }),
    );

    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const { name, tools } = result.value;

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
  async executeTool(
    name: string,
    input: Record<string, unknown>,
    options: McpExecuteToolOptions = {},
  ): Promise<ToolResult> {
    const entry = this.toolMap.get(name);
    if (!entry) return { content: `Unknown MCP tool: ${name}`, is_error: true };

    if (!entry.client.isConnected()) {
      return { content: `MCP server disconnected for tool: ${name}`, is_error: true };
    }

    try {
      const progress = this.progressOptionsFor(entry, options);
      const result = await entry.client.callTool(
        entry.originalName,
        input,
        undefined,
        progress,
      );
      if (result.resultType === "input_required") {
        if (!result.inputRequests) {
          if (result.requestState === undefined) {
            return unsupportedInputRequiredResult(
              entry,
              result,
              "the remote server returned input_required without inputRequests or requestState.",
            );
          }
          const retried = await entry.client.callTool(
            entry.originalName,
            input,
            { requestState: result.requestState },
            progress,
          );
          return toToolResult(entry, retried);
        }
        if (!options.inputResolver) {
          return unsupportedInputRequiredResult(entry, result);
        }
        const routed = await options.inputResolver({
          server: entry.client.getName(),
          tool: entry.originalName,
          inputRequests: result.inputRequests,
          ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
          ...(result._meta ? { resultMeta: result._meta } : {}),
        });
        if (routed.kind === "unavailable") {
          return unsupportedInputRequiredResult(entry, result, routed.reason);
        }
        const retry = {
          inputResponses: routed.inputResponses,
          inputRequests: result.inputRequests,
          ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
        };
        const retried = await entry.client.callTool(entry.originalName, input, retry, progress);
        return toToolResult(entry, retried);
      }
      return toToolResult(entry, result);
    } catch (err) {
      if (!entry.client.isConnected()) {
        return { content: `MCP server disconnected for tool: ${name}`, is_error: true };
      }
      const message = err instanceof McpToolError
        ? err.message
        : `MCP tool error: ${(err as Error).message}`;
      return { content: message, is_error: true };
    }
  }

  /** Disconnect all MCP servers. */
  async close(): Promise<void> {
    for (const unsubscribe of this.toolListUnsubscribers.values()) {
      unsubscribe();
    }
    this.toolListUnsubscribers.clear();
    this.initializingServers.clear();
    this.pendingServerRefreshes.clear();
    this.refreshQueues.clear();
    const closers = [...this.clients.values()].map((c) => c.close().catch(() => {}));
    await Promise.all(closers);
    this.clients.clear();
    this.serverTools.clear();
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

  private replaceServerTools(
    serverName: string,
    client: McpClient,
    tools: McpToolSchema[],
  ): void {
    const entries = tools.map((tool) => {
      const kotaTool = toKotaTool(serverName, tool);
      return { client, originalName: tool.name, tool: kotaTool };
    });
    const nextToolMap = new Map(this.toolMap);
    for (const entry of this.serverTools.get(serverName) ?? []) {
      nextToolMap.delete(entry.tool.name);
    }
    for (const entry of entries) {
      nextToolMap.set(entry.tool.name, entry);
    }
    this.serverTools.set(serverName, entries);
    this.toolMap = nextToolMap;
    this.kotaTools = [...this.serverTools.values()].flatMap((serverEntries) =>
      serverEntries.map((entry) => entry.tool),
    );
  }

  private progressOptionsFor(
    entry: McpToolEntry,
    options: McpExecuteToolOptions,
  ): Parameters<McpClient["callTool"]>[3] {
    if (!options.progressResolver) return {};
    return {
      progress: {
        ...(options.maxProgressEvents !== undefined
          ? { maxEvents: options.maxProgressEvents }
          : {}),
        onProgress: (event) => {
          options.progressResolver?.({
            ...event,
            server: entry.client.getName(),
            tool: entry.originalName,
          });
        },
      },
    };
  }

  private queueServerToolRefresh(serverName: string): void {
    if (this.initializingServers.has(serverName)) {
      this.pendingServerRefreshes.add(serverName);
      return;
    }
    const previous = this.refreshQueues.get(serverName) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.refreshServerTools(serverName))
      .finally(() => {
        if (this.refreshQueues.get(serverName) === next) {
          this.refreshQueues.delete(serverName);
        }
      });
    this.refreshQueues.set(serverName, next);
  }

  private async refreshServerTools(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client) return;
    if (!client.isConnected()) {
      console.error(
        `[kota] Warning: MCP server "${serverName}" tool refresh skipped: server is disconnected`,
      );
      return;
    }
    let tools: McpToolSchema[];
    try {
      tools = await client.listTools();
    } catch (err) {
      console.error(
        `[kota] Warning: MCP server "${serverName}" tool refresh failed; keeping previous registry: ${(err as Error).message}`,
      );
      return;
    }
    if (this.clients.get(serverName) !== client || !client.isConnected()) {
      return;
    }
    this.replaceServerTools(serverName, client, tools);
    console.error(
      `[kota] MCP server "${serverName}" tool registry refreshed — ${tools.length} tool${tools.length !== 1 ? "s" : ""}`,
    );
  }
}
