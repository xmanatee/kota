import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  KotaJsonObject,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { ToolResult } from "#core/tools/index.js";
import type { ToolResultContentProvenance } from "#core/tools/tool-middleware.js";
import {
  type McpAuthorizationResolver,
  type McpElicitationMode,
  McpToolError,
  type McpToolSchema,
} from "./client.js";
import {
  createMcpManagerClient,
  type McpManagerClient,
  type McpManagerClientFactory,
} from "./manager-client-port.js";
import {
  type McpServerConfig,
  normalizeMcpServerConfig,
} from "./manager-config.js";
import type { McpExecuteToolOptions } from "./manager-execution-types.js";
import { McpOperationCache } from "./manager-operation-cache.js";
import { McpOperationExecutor } from "./manager-operation-executor.js";
import { McpRemoteTaskRuntime } from "./manager-remote-task-runtime.js";
import {
  type McpToolDeclarationDriftDiagnostic,
  McpToolRegistry,
} from "./manager-tool-registry.js";
import { toToolResult, unsupportedInputRequiredResult } from "./manager-tool-result.js";
import type { McpToolEntry } from "./remote-task-entry-resolution.js";
import type { McpRemoteTaskResumeResult } from "./remote-task-results.js";
import {
  type RemoteMcpServerIdentity,
  remoteMcpServerIdentity,
} from "./remote-task-server-identity.js";
import {
  FileRemoteMcpTaskStore,
  MemoryRemoteMcpTaskStore,
  type RemoteMcpTaskStore,
} from "./remote-task-store.js";

export type {
  McpServerConfig,
  McpServerHttpConfig,
  McpServerStdioConfig,
} from "./manager-config.js";
export type { McpRemoteTaskResumeResult } from "./remote-task-results.js";
export { namespaceTool, parseToolName } from "./tool-namespace.js";

type McpConfig = {
  mcpServers: Record<string, McpServerConfig>;
};

export type McpManagerInitializeOptions = {
  inputResolverAvailable?: boolean;
  remoteTaskConsumptionAvailable?: boolean;
  authorizationResolver?: McpAuthorizationResolver;
};

export type McpManagerOptions = {
  scopeRoot?: string;
  remoteTaskStore?: RemoteMcpTaskStore;
  clientFactory?: McpManagerClientFactory;
};


export type {
  McpExecuteToolOptions,
  McpInputResolver,
  McpInputResolverResult,
  McpProgressResolver,
  McpRemoteInputRequest,
  McpRemoteProgressEvent,
} from "./manager-execution-types.js";
export type { McpToolDeclarationDriftDiagnostic } from "./manager-tool-registry.js";

export type McpDeclarationBoundToolExecutionResult =
  | { ok: true; result: ToolResult }
  | {
    ok: false;
    reason: "tool_missing" | "declaration_mismatch";
  };

type McpToolInput = Record<string, unknown>;

/**
 * Manages multiple MCP server connections and their tools.
 * Handles config loading, lifecycle, and tool routing.
 */
export class McpManager {
  private clients = new Map<string, McpManagerClient>();
  private readonly registry = new McpToolRegistry();
  private readonly operationCache = new McpOperationCache();
  private readonly operationExecutor = new McpOperationExecutor(this.operationCache);
  private readonly remoteTaskRuntime: McpRemoteTaskRuntime;
  private toolListUnsubscribers = new Map<string, () => void>();
  private initializingServers = new Set<string>();
  private pendingServerRefreshes = new Set<string>();
  private refreshQueues = new Map<string, Promise<void>>();
  private readonly clientFactory: McpManagerClientFactory;

  constructor(options: McpManagerOptions = {}) {
    this.clientFactory = options.clientFactory ?? createMcpManagerClient;
    const remoteTaskStore = options.remoteTaskStore ??
      (options.scopeRoot
        ? new FileRemoteMcpTaskStore(options.scopeRoot)
        : new MemoryRemoteMcpTaskStore());
    this.remoteTaskRuntime = new McpRemoteTaskRuntime(
      remoteTaskStore,
      this.registry,
      this.clients,
    );
  }

  /** Load MCP config from .kota/mcp.json in the given directory. */
  static loadConfig(cwd?: string): McpConfig | null {
    const dir = cwd || process.cwd();
    const configPath = join(dir, ".kota", "mcp.json");
    if (!existsSync(configPath)) return null;
    try {
      const raw = readFileSync(configPath, "utf-8");
      return JSON.parse(raw) as McpConfig;
    } catch (err) {
      printTerminalDiagnostic(
        `[kota] Warning: failed to parse ${configPath}:`,
        "warn",
        (err as Error).message,
      );
      return null;
    }
  }

  /** Connect to all configured MCP servers. Logs warnings for failures. */
  async initialize(
    config: McpConfig,
    options: McpManagerInitializeOptions = {},
  ): Promise<void> {
    const entries = Object.entries(config.mcpServers || {});
    this.remoteTaskRuntime.reset();
    if (entries.length === 0) {
      await this.remoteTaskRuntime.resumePersisted();
      return;
    }
    const supportedElicitationModes: readonly McpElicitationMode[] =
      options.inputResolverAvailable === true ? ["form", "url"] : [];
    const enableRemoteTasks = options.remoteTaskConsumptionAvailable ??
      options.inputResolverAvailable === true;

    const results = await Promise.allSettled(
      entries.map(async ([name, serverConfig]) => {
        let client: McpManagerClient | null = null;
        try {
          const transport = normalizeMcpServerConfig(name, serverConfig);
          this.remoteTaskRuntime.registerServerIdentity(
            name,
            remoteMcpServerIdentity(transport),
          );
          client = this.clientFactory(
            transport,
            name,
            {
              supportedElicitationModes,
              enableRemoteTasks,
              ...(options.authorizationResolver
                ? { authorizationResolver: options.authorizationResolver }
                : {}),
            },
          );
          this.registry.initializeServer(name);
          await client.connect();
          this.clients.set(name, client);
          this.initializingServers.add(name);
          const unsubscribeTool = client.onToolListChanged(() => {
            this.queueServerToolRefresh(name);
          });
          const unsubscribeResource = client.onResourceListChanged(() => {
            this.operationCache.invalidateLists(name, ["resources/list", "resources/templates/list"]);
            this.operationCache.invalidateSkills(name);
            printTerminalDiagnostic(
              `[kota] MCP server "${name}" resource catalog changed — explicit resource and skill operations will read fresh data on their next call`,
              "warn",
            );
          });
          const unsubscribePrompt = client.onPromptListChanged(() => {
            this.operationCache.invalidateLists(name, ["prompts/list"]);
            printTerminalDiagnostic(
              `[kota] MCP server "${name}" prompt catalog changed — explicit prompt operations will read fresh data on their next call`,
              "warn",
            );
          });
          this.toolListUnsubscribers.set(name, () => {
            unsubscribeTool();
            unsubscribeResource();
            unsubscribePrompt();
          });
          const tools = client.supportsTools() ? await client.listTools() : [];
          this.registry.replaceServerTools(name, client, tools);
          this.initializingServers.delete(name);
          if (this.pendingServerRefreshes.delete(name)) {
            this.queueServerToolRefresh(name);
          }
          return { name, tools };
        } catch (err) {
          printTerminalDiagnostic(
            `[kota] MCP server "${name}" failed to connect: ${(err as Error).message}`,
            "error",
          );
          this.initializingServers.delete(name);
          this.pendingServerRefreshes.delete(name);
          this.refreshQueues.delete(name);
          this.toolListUnsubscribers.get(name)?.();
          this.toolListUnsubscribers.delete(name);
          this.clients.delete(name);
          this.registry.removeServer(name);
          await client?.close().catch(() => {});
          return null;
        }
      }),
    );

    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const { name, tools } = result.value;

      printTerminalDiagnostic(
        `[kota] MCP server "${name}" connected — ${tools.length} tool${tools.length !== 1 ? "s" : ""}`,
      );
    }

    await this.remoteTaskRuntime.resumePersisted();
  }

  /** Get all MCP tools as neutral KotaTool entries. */
	getTools(): KotaTool[] {
		return [...this.registry.getTools()];
	}

	/** Structured declarations for diagnostics that need server identity and annotations. */
	getMcpToolEntries(): readonly McpToolEntry[] {
		return this.registry.getToolEntries();
	}

  getRemoteTaskResumeResults(): readonly McpRemoteTaskResumeResult[] {
    return this.remoteTaskRuntime.getResumeResults();
  }

  getToolDeclarationFingerprint(name: string): string | undefined {
    return this.registry.getTool(name)?.declaration.fingerprint;
  }

  getToolServerTransportIdentity(name: string): RemoteMcpServerIdentity | undefined {
    const serverName = this.registry.getTool(name)?.serverConfigName ??
      this.registry.getOperation(name)?.serverName;
    return serverName === undefined
      ? undefined
      : this.remoteTaskRuntime.getServerIdentity(serverName);
  }

  getToolServerTransportIdentityFingerprint(name: string): string | undefined {
    return this.getToolServerTransportIdentity(name)?.fingerprint;
  }

  getToolDeclarationDriftDiagnostics(): readonly McpToolDeclarationDriftDiagnostic[] {
    return this.registry.getDiagnostics();
  }

  /** Check if a tool name belongs to an MCP server. */
  isMcpTool(name: string): boolean {
    return this.registry.has(name);
  }

  /** Check whether a remote MCP tool explicitly advertised read-only behavior. */
  isToolReadOnly(name: string): boolean {
    return this.registry.getTool(name)?.annotations?.readOnlyHint === true;
  }

  /** Return the external-content provenance for an MCP-managed tool or operation. */
  getToolResultContentProvenance(
    name: string,
  ): ToolResultContentProvenance | undefined {
    const tool = this.registry.getTool(name);
    if (tool) {
      return {
        kind: "external-mcp",
        serverName: tool.serverConfigName,
        source: "tool",
        name: tool.originalName,
        declarationFingerprint: tool.declaration.fingerprint,
      };
    }
    const operation = this.registry.getOperation(name);
    if (operation) {
      return {
        kind: "external-mcp",
        serverName: operation.serverName,
        source: "operation",
        name: operation.kind,
      };
    }
    return undefined;
  }

  /**
   * Execute only when the current tool entry matches the expected declaration.
   * Entry selection and fingerprint validation stay synchronous so a registry
   * refresh cannot interleave before dispatch is bound to the captured entry.
   */
  executeToolWithDeclarationFingerprint(
    name: string,
    input: McpToolInput,
    expectedDeclarationFingerprint: string,
    options: McpExecuteToolOptions = {},
  ): Promise<McpDeclarationBoundToolExecutionResult> {
    const entry = this.registry.getTool(name);
    if (!entry) {
      return Promise.resolve({ ok: false, reason: "tool_missing" });
    }
    if (entry.declaration.fingerprint !== expectedDeclarationFingerprint) {
      return Promise.resolve({ ok: false, reason: "declaration_mismatch" });
    }
    return this.executeToolEntry(name, entry, input, options).then(
      (result): McpDeclarationBoundToolExecutionResult => ({ ok: true, result }),
    );
  }

  /** Execute an MCP tool by its namespaced name. */
  async executeTool(
    name: string,
    input: McpToolInput,
    options: McpExecuteToolOptions = {},
  ): Promise<ToolResult> {
    const entry = this.registry.getTool(name);
    if (!entry) {
      const operation = this.registry.getOperation(name);
      if (operation) {
        return this.operationExecutor.execute(operation, input as KotaJsonObject, options);
      }
      return { content: `Unknown MCP tool: ${name}`, is_error: true };
    }

    return this.executeToolEntry(name, entry, input, options);
  }

  private async executeToolEntry(
    name: string,
    entry: McpToolEntry,
    input: McpToolInput,
    options: McpExecuteToolOptions,
  ): Promise<ToolResult> {
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
      if (result.resultType === "task") {
        return await this.remoteTaskRuntime.resolve(entry, result, options);
      }
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
    this.registry.clear();
    this.operationCache.clear();
  }

  /** Get number of connected servers. */
  getServerCount(): number {
    return this.clients.size;
  }

  /** Get total number of MCP tools available. */
  getToolCount(): number {
    return this.registry.getToolCount();
  }

  private progressOptionsFor(
    entry: McpToolEntry,
    options: McpExecuteToolOptions,
  ): Parameters<McpManagerClient["callTool"]>[3] {
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
      printTerminalDiagnostic(
        `[kota] Warning: MCP server "${serverName}" tool refresh skipped: server is disconnected`,
        "warn",
      );
      return;
    }
    let tools: McpToolSchema[];
    try {
      tools = await client.listTools();
    } catch (err) {
      printTerminalDiagnostic(
        `[kota] Warning: MCP server "${serverName}" tool refresh failed; keeping previous registry: ${(err as Error).message}`,
        "warn",
      );
      return;
    }
    if (this.clients.get(serverName) !== client || !client.isConnected()) {
      return;
    }
    try {
      this.registry.replaceServerTools(serverName, client, tools);
    } catch (err) {
      printTerminalDiagnostic(
        `[kota] Warning: MCP server "${serverName}" tool refresh failed; keeping previous registry: ${(err as Error).message}`,
        "warn",
      );
      return;
    }
    printTerminalDiagnostic(
      `[kota] MCP server "${serverName}" tool registry refreshed — ${tools.length} tool${tools.length !== 1 ? "s" : ""}`,
    );
  }
}
