import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  KotaJsonObject,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { ToolResult } from "#core/tools/index.js";
import { validateToolStructuredOutput } from "#core/tools/output-schema.js";
import type { ToolResultContentProvenance } from "#core/tools/tool-middleware.js";
import {
  type McpAuthorizationResolver,
  type McpCacheHints,
  type McpCallToolResult,
  McpClient,
  type McpCreateTaskResult,
  type McpElicitationMode,
  type McpGetPromptResult,
  type McpGetTaskResult,
  type McpInputRequiredCallToolResult,
  type McpInputRequiredResult,
  type McpListPromptsPage,
  type McpListResourcesPage,
  type McpListResourceTemplatesPage,
  type McpProgressEvent,
  type McpReadResourceResult,
  McpToolError,
  type McpToolInputRequests,
  type McpToolInputResponses,
  type McpToolSchema,
} from "./client.js";
import {
  assertValidRemoteSkillResourceUri,
  type McpRemoteSkillCatalog,
  type McpRemoteSkillCatalogEntry,
  type McpRemoteSkillReadResult,
  type McpRemoteSkillSource,
  resolveRemoteSkillRelativeUri,
} from "./client-remote-skills.js";
import { decodeCallToolResult } from "./client-result-decoders.js";
import {
  type McpServerConfig,
  normalizeMcpServerConfig,
} from "./manager-config.js";
import { isJsonObject } from "./manager-config-utils.js";
import {
  entryForPersistedRemoteTask,
  type McpToolEntry,
} from "./remote-task-entry-resolution.js";
import {
  formatRemoteTaskResumeResult,
  type McpRemoteTaskResumeResult,
  type McpRemoteTaskStats,
  remoteTaskErrorResult,
  remoteTaskPollingErrorMessage,
  remoteTaskStatsForPersistedHandle,
  withRemoteTaskDiagnostics,
} from "./remote-task-results.js";
import {
  type RemoteMcpServerIdentity,
  remoteMcpServerIdentity,
} from "./remote-task-server-identity.js";
import {
  FileRemoteMcpTaskStore,
  MemoryRemoteMcpTaskStore,
  type PersistedRemoteMcpTaskHandle,
  type RemoteMcpTaskStore,
  remoteMcpTaskHandleId,
} from "./remote-task-store.js";
import {
  changedMcpToolDeclarationFacets,
  fingerprintMcpToolDeclaration,
  type McpToolDeclarationFacet,
} from "./tool-declaration-fingerprint.js";
import {
  firstDuplicateMcpToolName,
  namespacePromptOperation,
  namespaceResourceOperation,
  namespaceResourceTemplateOperation,
  namespaceSkillOperation,
  namespaceTool,
} from "./tool-namespace.js";

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
  projectDir?: string;
  remoteTaskStore?: RemoteMcpTaskStore;
};

export type McpToolDeclarationDriftDiagnostic = {
  serverConfigName: string;
  serverDisplayName: string;
  toolName: string;
  previousFingerprint: string;
  currentFingerprint: string;
  changedFacets: McpToolDeclarationFacet[];
};

type McpOperationKind =
  | "resources/list"
  | "resources/templates/list"
  | "resources/read"
  | "skills/list"
  | "skills/read"
  | "prompts/list"
  | "prompts/get";

type McpCachedListOperationKind =
  | "resources/list"
  | "resources/templates/list"
  | "prompts/list";

type McpOperationEntry = {
  serverName: string;
  client: McpClient;
  kind: McpOperationKind;
  tool: KotaTool;
};

type McpCacheableListPage =
  | McpListResourcesPage
  | McpListResourceTemplatesPage
  | McpListPromptsPage;

type McpListCacheEntry<TPage extends McpCacheableListPage> = {
  page: TPage;
  receivedAtMs: number;
};

type McpListCacheSource = "cache" | "server";

type McpListCacheReason =
  | "fresh"
  | "missing"
  | "expired"
  | "ttl-not-positive"
  | "list_changed";

type McpListCacheMetadata = McpCacheHints & {
  server: string;
  operation: McpCachedListOperationKind;
  cursor: string | null;
  source: McpListCacheSource;
  reason: McpListCacheReason;
  receivedAt: string;
  expiresAt: string | null;
};

type McpRemoteSkillCatalogCacheEntry = {
  catalog: Extract<McpRemoteSkillCatalog, { status: "enumerated" }>;
  receivedAtMs: number;
};

type McpRemoteSkillCatalogCacheReason =
  | "fresh"
  | "missing"
  | "expired"
  | "ttl-not-positive"
  | "list_changed";

type McpRemoteSkillCatalogCacheMetadata = McpCacheHints & {
  server: string;
  operation: "skills/list";
  source: McpListCacheSource;
  reason: McpRemoteSkillCatalogCacheReason;
  receivedAt: string;
  expiresAt: string | null;
};

type McpRemoteSkillReadTarget = {
  uri: string;
  source: McpRemoteSkillSource;
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
  signal?: AbortSignal;
};

export type McpDeclarationBoundToolExecutionResult =
  | { ok: true; result: ToolResult }
  | {
    ok: false;
    reason: "tool_missing" | "declaration_mismatch";
  };

type McpToolInput = Record<string, unknown>;

const DEFAULT_REMOTE_TASK_POLL_INTERVAL_MS = 1_000;
const MAX_TOOL_DECLARATION_DRIFT_DIAGNOSTICS = 100;

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

function operationTool(name: string, description: string, input_schema: KotaTool["input_schema"]): KotaTool {
  return {
    name,
    description,
    input_schema,
  };
}

function toKotaOperations(serverName: string, client: McpClient): McpOperationEntry[] {
  const entries: McpOperationEntry[] = [];
  if (client.supportsResources()) {
    entries.push({
      serverName,
      client,
      kind: "resources/list",
      tool: operationTool(
        namespaceResourceOperation(serverName, "list"),
        `[${serverName}] List remote MCP resources exposed by this server.`,
        { type: "object", properties: {} },
      ),
    });
    entries.push({
      serverName,
      client,
      kind: "resources/templates/list",
      tool: operationTool(
        namespaceResourceTemplateOperation(serverName),
        `[${serverName}] List remote MCP resource templates exposed by this server.`,
        { type: "object", properties: {} },
      ),
    });
    entries.push({
      serverName,
      client,
      kind: "resources/read",
      tool: operationTool(
        namespaceResourceOperation(serverName, "read"),
        `[${serverName}] Read one remote MCP resource by URI.`,
        {
          type: "object",
          properties: { uri: { type: "string" } },
          required: ["uri"],
        },
      ),
    });
    entries.push({
      serverName,
      client,
      kind: "skills/list",
      tool: operationTool(
        namespaceSkillOperation(serverName, "list"),
        `[${serverName}] List remote MCP-served skills from skill://index.json when available.`,
        { type: "object", properties: {} },
      ),
    });
    entries.push({
      serverName,
      client,
      kind: "skills/read",
      tool: operationTool(
        namespaceSkillOperation(serverName, "read"),
        `[${serverName}] Read one remote MCP-served skill by name or skill:// URI as untrusted resource content.`,
        {
          type: "object",
          properties: {
            name: { type: "string" },
            uri: { type: "string" },
            relativePath: { type: "string" },
          },
        },
      ),
    });
  }
  if (client.supportsPrompts()) {
    entries.push({
      serverName,
      client,
      kind: "prompts/list",
      tool: operationTool(
        namespacePromptOperation(serverName, "list"),
        `[${serverName}] List remote MCP prompts exposed by this server.`,
        { type: "object", properties: {} },
      ),
    });
    entries.push({
      serverName,
      client,
      kind: "prompts/get",
      tool: operationTool(
        namespacePromptOperation(serverName, "get"),
        `[${serverName}] Get one remote MCP prompt by name and arguments.`,
        {
          type: "object",
          properties: {
            name: { type: "string" },
            arguments: { type: "object" },
          },
          required: ["name"],
        },
      ),
    });
  }
  return entries;
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

function hasSamplingInputRequest(result: McpInputRequiredResult): boolean {
  return Object.values(result.inputRequests ?? {}).some(
    (request) => request.method === "sampling/createMessage",
  );
}

function inputRequiredUnavailableDetail(result: McpInputRequiredResult): string {
  if (hasSamplingInputRequest(result)) {
    return " the remote server requested sampling/createMessage, but no operator-approved sampling bridge is configured.";
  }
  return " this KOTA runtime cannot route remote input_required results yet.";
}

function operationInputRequiredDiagnostics(
  entry: McpOperationEntry,
  result: McpInputRequiredResult,
): KotaJsonObject {
  return {
    resultType: "input_required",
    protocolVersion: result.protocolVersion,
    server: entry.client.getName(),
    tool: entry.kind,
    ...(result.inputRequests ? { inputRequests: result.inputRequests } : {}),
    ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
    ...(result._meta ? { resultMeta: result._meta } : {}),
  };
}

function sleepUntilNextPoll(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error("MCP task polling aborted"));
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("MCP task polling aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function unsupportedInputRequiredResult(
  entry: McpToolEntry,
  result: McpInputRequiredCallToolResult,
  reason?: string,
): ToolResult {
  const detail = reason
    ? ` ${reason}`
    : inputRequiredUnavailableDetail(result);
  return {
    content:
      `MCP tool error: remote MCP tool "${entry.originalName}" on server ` +
      `"${entry.client.getName()}" requires additional input, but${detail}`,
    is_error: true,
    _meta: { mcp: inputRequiredDiagnostics(entry, result) },
  };
}

function unsupportedOperationInputRequiredResult(
  entry: McpOperationEntry,
  result: McpInputRequiredResult,
  reason?: string,
): ToolResult {
  const detail = reason
    ? ` ${reason}`
    : inputRequiredUnavailableDetail(result);
  return {
    content:
      `MCP operation error: remote MCP operation "${entry.kind}" on server ` +
      `"${entry.client.getName()}" requires additional input, but${detail}`,
    is_error: true,
    _meta: { mcp: operationInputRequiredDiagnostics(entry, result) },
  };
}

function toToolResult(entry: McpToolEntry, result: McpCallToolResult): ToolResult {
  if (result.resultType === "task") {
    return {
      content:
        `MCP tool error: remote MCP task "${result.taskId}" for tool ` +
        `"${entry.originalName}" was not resolved by the manager`,
      is_error: true,
      _meta: {
        mcpTask: {
          resultType: "task",
          protocolVersion: result.protocolVersion,
          server: entry.client.getName(),
          tool: entry.originalName,
          taskId: result.taskId,
          status: result.status,
        },
      },
    };
  }
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

function toStructuredContent(value: object): KotaJsonObject {
  return JSON.parse(JSON.stringify(value)) as KotaJsonObject;
}

function toOperationResult(value: KotaJsonObject, meta?: KotaJsonObject): ToolResult {
  return {
    content: JSON.stringify(value, null, 2),
    structuredContent: value,
    ...(meta ? { _meta: meta } : {}),
  };
}

function stringInput(
  input: KotaJsonObject,
  key: string,
  operationName: string,
): { ok: true; value: string } | { ok: false; result: ToolResult } {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    return {
      ok: false,
      result: {
        content: `MCP operation error: ${operationName} requires non-empty string input "${key}"`,
        is_error: true,
      },
    };
  }
  return { ok: true, value };
}

function promptArgumentsInput(
  input: KotaJsonObject,
): { ok: true; value: KotaJsonObject } | { ok: false; result: ToolResult } {
  const value = input.arguments;
  if (value === undefined) return { ok: true, value: {} };
  if (!isJsonObject(value)) {
    return {
      ok: false,
      result: {
        content: 'MCP operation error: prompts/get input "arguments" must be an object',
        is_error: true,
      },
    };
  }
  return { ok: true, value };
}

/**
 * Manages multiple MCP server connections and their tools.
 * Handles config loading, lifecycle, and tool routing.
 */
export class McpManager {
  private readonly remoteTaskStore: RemoteMcpTaskStore;
  private clients = new Map<string, McpClient>();
  private serverTools = new Map<string, McpToolEntry[]>();
  private serverOperations = new Map<string, McpOperationEntry[]>();
  private toolMap = new Map<string, McpToolEntry>();
  private operationMap = new Map<string, McpOperationEntry>();
  private listCache = new Map<string, McpListCacheEntry<McpCacheableListPage>>();
  private listCacheInvalidations = new Map<string, "list_changed">();
  private remoteSkillCatalogCache = new Map<string, McpRemoteSkillCatalogCacheEntry>();
  private remoteSkillCatalogInvalidations = new Map<string, "list_changed">();
  private kotaTools: KotaTool[] = [];
  private toolListUnsubscribers = new Map<string, () => void>();
  private initializingServers = new Set<string>();
  private pendingServerRefreshes = new Set<string>();
  private refreshQueues = new Map<string, Promise<void>>();
  private remoteTaskServerIdentities = new Map<string, RemoteMcpServerIdentity>();
  private remoteTaskResumeResults: McpRemoteTaskResumeResult[] = [];
  private toolDeclarationDriftDiagnostics: McpToolDeclarationDriftDiagnostic[] = [];

  constructor(options: McpManagerOptions = {}) {
    this.remoteTaskStore = options.remoteTaskStore ??
      (options.projectDir
        ? new FileRemoteMcpTaskStore(options.projectDir)
        : new MemoryRemoteMcpTaskStore());
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
    this.remoteTaskServerIdentities.clear();
    this.remoteTaskResumeResults = [];
    if (entries.length === 0) {
      await this.resumePersistedRemoteTasks();
      return;
    }
    const supportedElicitationModes: readonly McpElicitationMode[] =
      options.inputResolverAvailable === true ? ["form", "url"] : [];
    const enableRemoteTasks = options.remoteTaskConsumptionAvailable ??
      options.inputResolverAvailable === true;

    const results = await Promise.allSettled(
      entries.map(async ([name, serverConfig]) => {
        let client: McpClient | null = null;
        try {
          const transport = normalizeMcpServerConfig(name, serverConfig);
          this.remoteTaskServerIdentities.set(name, remoteMcpServerIdentity(transport));
          client = new McpClient(
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
          this.serverTools.set(name, []);
          await client.connect();
          this.clients.set(name, client);
          this.initializingServers.add(name);
          const unsubscribeTool = client.onToolListChanged(() => {
            this.queueServerToolRefresh(name);
          });
          const unsubscribeResource = client.onResourceListChanged(() => {
            this.invalidateListCache(name, ["resources/list", "resources/templates/list"]);
            this.invalidateRemoteSkillCatalogCache(name);
            printTerminalDiagnostic(
              `[kota] MCP server "${name}" resource catalog changed — explicit resource and skill operations will read fresh data on their next call`,
              "warn",
            );
          });
          const unsubscribePrompt = client.onPromptListChanged(() => {
            this.invalidateListCache(name, ["prompts/list"]);
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
          this.replaceServerTools(name, client, tools);
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
          this.serverTools.delete(name);
          this.serverOperations.delete(name);
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

    await this.resumePersistedRemoteTasks();
  }

  /** Get all MCP tools as neutral KotaTool entries. */
  getTools(): KotaTool[] {
    return this.kotaTools;
  }

  getRemoteTaskResumeResults(): readonly McpRemoteTaskResumeResult[] {
    return this.remoteTaskResumeResults;
  }

  getToolDeclarationFingerprint(name: string): string | undefined {
    return this.toolMap.get(name)?.declaration.fingerprint;
  }

  getToolServerTransportIdentity(name: string): RemoteMcpServerIdentity | undefined {
    const serverName = this.toolMap.get(name)?.serverConfigName ??
      this.operationMap.get(name)?.serverName;
    return serverName === undefined
      ? undefined
      : this.remoteTaskServerIdentities.get(serverName);
  }

  getToolServerTransportIdentityFingerprint(name: string): string | undefined {
    return this.getToolServerTransportIdentity(name)?.fingerprint;
  }

  getToolDeclarationDriftDiagnostics(): readonly McpToolDeclarationDriftDiagnostic[] {
    return this.toolDeclarationDriftDiagnostics.map((diagnostic) => ({
      ...diagnostic,
      changedFacets: [...diagnostic.changedFacets],
    }));
  }

  /** Check if a tool name belongs to an MCP server. */
  isMcpTool(name: string): boolean {
    return this.toolMap.has(name) || this.operationMap.has(name);
  }

  /** Check whether a remote MCP tool explicitly advertised read-only behavior. */
  isToolReadOnly(name: string): boolean {
    return this.toolMap.get(name)?.annotations?.readOnlyHint === true;
  }

  /** Return the external-content provenance for an MCP-managed tool or operation. */
  getToolResultContentProvenance(
    name: string,
  ): ToolResultContentProvenance | undefined {
    const tool = this.toolMap.get(name);
    if (tool) {
      return {
        kind: "external-mcp",
        serverName: tool.serverConfigName,
        source: "tool",
        name: tool.originalName,
        declarationFingerprint: tool.declaration.fingerprint,
      };
    }
    const operation = this.operationMap.get(name);
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
    const entry = this.toolMap.get(name);
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
    const entry = this.toolMap.get(name);
    if (!entry) {
      const operation = this.operationMap.get(name);
      if (operation) {
        return this.executeOperation(operation, input as KotaJsonObject, options);
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
        return await this.resolveRemoteTaskToolResult(entry, result, options);
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

  private async resolveRemoteTaskToolResult(
    entry: McpToolEntry,
    created: McpCreateTaskResult,
    options: McpExecuteToolOptions,
  ): Promise<ToolResult> {
    const now = Date.now();
    const stats: McpRemoteTaskStats = {
      protocolVersion: created.protocolVersion,
      toolDeclarationFingerprint: entry.declaration.fingerprint,
      pollCount: 0,
      inputUpdateCount: 0,
      startedAtMs: now,
      deadlineAtMs: created.ttlMs === null ? null : now + created.ttlMs,
    };
    await this.persistRemoteTaskHandle(entry, created, stats);
    return this.pollRemoteTaskToolResult(entry, created, stats, options);
  }

  private async pollRemoteTaskToolResult(
    entry: McpToolEntry,
    initial: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
    options: McpExecuteToolOptions,
  ): Promise<ToolResult> {
    let current: McpCreateTaskResult | McpGetTaskResult = initial;
    while (true) {
      if (options.signal?.aborted) {
        return await this.cancelRemoteTaskAfterAbort(entry, current, stats);
      }
      if (current.status === "completed") {
        const decoded = decodeCallToolResult(
          current.result,
          stats.protocolVersion,
        );
        if (decoded.resultType === "task") {
          await this.clearPersistedRemoteTaskHandle(entry, current);
          return remoteTaskErrorResult(
            entry,
            current,
            stats,
            "completed with a nested task result",
          );
        }
        await this.clearPersistedRemoteTaskHandle(entry, current);
        return withRemoteTaskDiagnostics(
          toToolResult(entry, decoded),
          entry,
          current,
          stats,
        );
      }
      if (current.status === "failed") {
        await this.clearPersistedRemoteTaskHandle(entry, current);
        return remoteTaskErrorResult(
          entry,
          current,
          stats,
          "failed",
          current.error?.code,
        );
      }
      if (current.status === "cancelled") {
        await this.clearPersistedRemoteTaskHandle(entry, current);
        return remoteTaskErrorResult(entry, current, stats, "was cancelled");
      }
      if (stats.deadlineAtMs !== null && Date.now() >= stats.deadlineAtMs) {
        await this.clearPersistedRemoteTaskHandle(entry, current);
        return remoteTaskErrorResult(
          entry,
          current,
          stats,
          `exceeded its ttlMs=${current.ttlMs} polling window`,
        );
      }
      if (current.status === "input_required") {
        await this.persistRemoteTaskHandle(entry, current, stats);
        const handled = await this.handleRemoteTaskInputRequired(
          entry,
          current,
          stats,
          options,
        );
        if (handled.kind === "result") return handled.result;
        current = await this.pollRemoteTaskOnce(entry, current, stats);
        continue;
      }
      const remainingMs = stats.deadlineAtMs === null
        ? null
        : Math.max(0, stats.deadlineAtMs - Date.now());
      const pollIntervalMs = current.pollIntervalMs ?? DEFAULT_REMOTE_TASK_POLL_INTERVAL_MS;
      const delayMs = remainingMs === null
        ? pollIntervalMs
        : Math.min(pollIntervalMs, remainingMs);
      if (delayMs <= 0) {
        await this.clearPersistedRemoteTaskHandle(entry, current);
        return remoteTaskErrorResult(
          entry,
          current,
          stats,
          `exceeded its ttlMs=${current.ttlMs} polling window`,
        );
      }
      try {
        await sleepUntilNextPoll(delayMs, options.signal);
      } catch {
        return await this.cancelRemoteTaskAfterAbort(entry, current, stats);
      }
      current = await this.pollRemoteTaskOnce(entry, current, stats);
    }
  }

  private async pollRemoteTaskOnce(
    entry: McpToolEntry,
    current: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
  ): Promise<McpGetTaskResult> {
    try {
      const next = await entry.client.getTask(current.taskId);
      stats.pollCount += 1;
      await this.persistRemoteTaskHandle(entry, next, stats);
      return next;
    } catch (err) {
      await this.persistRemoteTaskHandle(
        entry,
        current,
        stats,
        remoteTaskPollingErrorMessage(err as Error),
      );
      throw err;
    }
  }

  private async persistRemoteTaskHandle(
    entry: McpToolEntry,
    task: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
    lastDiagnostic?: string,
  ): Promise<void> {
    const identity = this.remoteTaskServerIdentities.get(entry.serverConfigName);
    if (!identity) return;
    const handle: PersistedRemoteMcpTaskHandle = {
      id: remoteMcpTaskHandleId(entry.serverConfigName, task.taskId),
      serverConfigName: entry.serverConfigName,
      serverDisplayName: entry.client.getName(),
      serverFingerprint: identity.fingerprint,
      serverMatch: identity.match,
      toolName: entry.originalName,
      toolDeclarationFingerprint: stats.toolDeclarationFingerprint,
      taskId: task.taskId,
      protocolVersion: stats.protocolVersion,
      status: task.status,
      createdAt: task.createdAt,
      lastUpdatedAt: task.lastUpdatedAt,
      ttlMs: task.ttlMs,
      ...(task.pollIntervalMs !== undefined ? { pollIntervalMs: task.pollIntervalMs } : {}),
      pollCount: stats.pollCount,
      inputUpdateCount: stats.inputUpdateCount,
      startedAt: new Date(stats.startedAtMs).toISOString(),
      deadlineAt: stats.deadlineAtMs === null
        ? null
        : new Date(stats.deadlineAtMs).toISOString(),
      updatedAt: new Date().toISOString(),
      ...(lastDiagnostic !== undefined ? { lastDiagnostic } : {}),
    };
    await this.remoteTaskStore.upsert(handle);
  }

  private async clearPersistedRemoteTaskHandle(
    entry: McpToolEntry,
    task: McpCreateTaskResult | McpGetTaskResult,
  ): Promise<void> {
    await this.remoteTaskStore.remove(
      remoteMcpTaskHandleId(entry.serverConfigName, task.taskId),
    );
  }

  private async resumePersistedRemoteTasks(): Promise<void> {
    for (const handle of await this.remoteTaskStore.list()) {
      const result = await this.resumePersistedRemoteTask(handle);
      this.remoteTaskResumeResults.push(result);
      printTerminalDiagnostic(formatRemoteTaskResumeResult(result), "warn");
    }
  }

  private async resumePersistedRemoteTask(
    handle: PersistedRemoteMcpTaskHandle,
  ): Promise<McpRemoteTaskResumeResult> {
    const currentIdentity = this.remoteTaskServerIdentities.get(handle.serverConfigName);
    if (!currentIdentity) {
      return await this.remoteTaskResumeDiagnostic(
        handle,
        `configured MCP server "${handle.serverConfigName}" is not present; remote task was not resumed`,
      );
    }
    if (currentIdentity.fingerprint !== handle.serverFingerprint) {
      return await this.remoteTaskResumeDiagnostic(
        handle,
        `configured MCP server "${handle.serverConfigName}" no longer matches the persisted remote task handle; remote task was not resumed`,
      );
    }
    if (currentIdentity.match.kind === "ambiguous") {
      return await this.remoteTaskResumeDiagnostic(handle, currentIdentity.match.reason);
    }

    const client = this.clients.get(handle.serverConfigName);
    if (!client?.isConnected()) {
      return await this.remoteTaskResumeDiagnostic(
        handle,
        `configured MCP server "${handle.serverConfigName}" is not connected; remote task was not resumed`,
      );
    }
    if (!client.supportsTasks()) {
      return await this.remoteTaskResumeDiagnostic(
        handle,
        `configured MCP server "${handle.serverConfigName}" did not negotiate io.modelcontextprotocol/tasks; remote task was not resumed`,
      );
    }

    try {
      const resolvedEntry = entryForPersistedRemoteTask({
        handle,
        client,
        entries: this.serverTools.get(handle.serverConfigName),
      });
      if (resolvedEntry.kind === "diagnostic") {
        return await this.remoteTaskResumeDiagnostic(handle, resolvedEntry.message);
      }
      const entry = resolvedEntry.entry;
      const stats = remoteTaskStatsForPersistedHandle(handle);
      const current = await client.getTask(handle.taskId);
      stats.pollCount += 1;
      await this.persistRemoteTaskHandle(entry, current, stats);
      const result = await this.pollRemoteTaskToolResult(
        entry,
        current,
        stats,
        {},
      );
      return {
        kind: "result",
        serverConfigName: handle.serverConfigName,
        serverDisplayName: client.getName(),
        tool: handle.toolName,
        taskId: handle.taskId,
        result,
      };
    } catch (err) {
      const message = err instanceof McpToolError
        ? err.message
        : `MCP remote task resume error: ${(err as Error).message}`;
      return await this.remoteTaskResumeDiagnostic(handle, message);
    }
  }

  private async remoteTaskResumeDiagnostic(
    handle: PersistedRemoteMcpTaskHandle,
    message: string,
  ): Promise<McpRemoteTaskResumeResult> {
    await this.remoteTaskStore.upsert({
      ...handle,
      lastDiagnostic: message,
      updatedAt: new Date().toISOString(),
    });
    return {
      kind: "diagnostic",
      serverConfigName: handle.serverConfigName,
      serverDisplayName: handle.serverDisplayName,
      tool: handle.toolName,
      taskId: handle.taskId,
      message,
    };
  }

  private async handleRemoteTaskInputRequired(
    entry: McpToolEntry,
    task: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
    options: McpExecuteToolOptions,
  ): Promise<{ kind: "continue" } | { kind: "result"; result: ToolResult }> {
    if (!task.inputRequests) {
      await this.persistRemoteTaskHandle(
        entry,
        task,
        stats,
        "remote task entered input_required without inputRequests",
      );
      return {
        kind: "result",
        result: remoteTaskErrorResult(
          entry,
          task,
          stats,
          "entered input_required without inputRequests",
        ),
      };
    }
    if (!options.inputResolver) {
      await this.persistRemoteTaskHandle(
        entry,
        task,
        stats,
        "remote task entered input_required, but no input resolver is available",
      );
      return {
        kind: "result",
        result: withRemoteTaskDiagnostics(
          unsupportedInputRequiredResult(entry, {
            resultType: "input_required",
            protocolVersion: stats.protocolVersion,
            inputRequests: task.inputRequests,
            ...(task.requestState !== undefined ? { requestState: task.requestState } : {}),
            ...(task._meta ? { _meta: task._meta } : {}),
          }),
          entry,
          task,
          stats,
        ),
      };
    }
    const routed = await options.inputResolver({
      server: entry.client.getName(),
      tool: entry.originalName,
      inputRequests: task.inputRequests,
      ...(task.requestState !== undefined ? { requestState: task.requestState } : {}),
      ...(task._meta ? { resultMeta: task._meta } : {}),
    });
    if (routed.kind === "unavailable") {
      await this.persistRemoteTaskHandle(entry, task, stats, routed.reason);
      return {
        kind: "result",
        result: withRemoteTaskDiagnostics(
          unsupportedInputRequiredResult(entry, {
            resultType: "input_required",
            protocolVersion: stats.protocolVersion,
            inputRequests: task.inputRequests,
            ...(task.requestState !== undefined ? { requestState: task.requestState } : {}),
            ...(task._meta ? { _meta: task._meta } : {}),
          }, routed.reason),
          entry,
          task,
          stats,
        ),
      };
    }
    await entry.client.updateTask(task.taskId, {
      inputRequests: task.inputRequests,
      inputResponses: routed.inputResponses,
      ...(task.requestState !== undefined ? { requestState: task.requestState } : {}),
    });
    stats.inputUpdateCount += 1;
    return { kind: "continue" };
  }

  private async cancelRemoteTaskAfterAbort(
    entry: McpToolEntry,
    task: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
  ): Promise<ToolResult> {
    try {
      await entry.client.cancelTask(task.taskId);
      await this.clearPersistedRemoteTaskHandle(entry, task);
      return remoteTaskErrorResult(
        entry,
        task,
        stats,
        "was aborted by the operator and cancellation was requested",
      );
    } catch {
      await this.persistRemoteTaskHandle(
        entry,
        task,
        stats,
        "operator aborted polling; cancellation could not be confirmed",
      );
      return remoteTaskErrorResult(
        entry,
        task,
        stats,
        "was aborted by the operator; cancellation could not be confirmed",
      );
    }
  }

  private listCacheOperationPrefix(
    serverName: string,
    operation: McpCachedListOperationKind,
  ): string {
    return `${serverName}\u0000${operation}\u0000`;
  }

  private listCacheAuthPrefix(
    entry: McpOperationEntry,
    operation: McpCachedListOperationKind,
  ): string {
    return `${this.listCacheOperationPrefix(entry.serverName, operation)}${entry.client.getCacheAuthorizationContextKey()}\u0000`;
  }

  private listCacheKey(
    entry: McpOperationEntry,
    operation: McpCachedListOperationKind,
    cursor: string | undefined,
  ): string {
    return `${this.listCacheAuthPrefix(entry, operation)}${cursor ?? ""}`;
  }

  private invalidateListCache(
    serverName: string,
    operations: McpCachedListOperationKind[],
  ): void {
    for (const operation of operations) {
      const operationPrefix = this.listCacheOperationPrefix(serverName, operation);
      for (const key of [...this.listCache.keys()]) {
        if (key.startsWith(operationPrefix)) {
          this.listCache.delete(key);
        }
      }
      this.listCacheInvalidations.set(operationPrefix, "list_changed");
    }
  }

  private listCacheMetadata(args: {
    entry: McpOperationEntry;
    operation: McpCachedListOperationKind;
    cursor: string | undefined;
    source: McpListCacheSource;
    reason: McpListCacheReason;
    page: McpCacheableListPage;
    receivedAtMs: number;
  }): McpListCacheMetadata {
    const expiresAtMs = args.receivedAtMs + args.page.cache.ttlMs;
    return {
      server: args.entry.serverName,
      operation: args.operation,
      cursor: args.cursor ?? null,
      source: args.source,
      reason: args.reason,
      ttlMs: args.page.cache.ttlMs,
      cacheScope: args.page.cache.cacheScope,
      receivedAt: new Date(args.receivedAtMs).toISOString(),
      expiresAt: args.page.cache.ttlMs > 0 ? new Date(expiresAtMs).toISOString() : null,
    };
  }

  private async cachedListPage<TPage extends McpCacheableListPage>(
    entry: McpOperationEntry,
    operation: McpCachedListOperationKind,
    cursor: string | undefined,
    fetchPage: (cursor: string | undefined) => Promise<TPage>,
  ): Promise<{ page: TPage; cache: McpListCacheMetadata }> {
    const key = this.listCacheKey(entry, operation, cursor);
    const operationPrefix = this.listCacheOperationPrefix(entry.serverName, operation);
    const cached = this.listCache.get(key) as McpListCacheEntry<TPage> | undefined;
    const now = Date.now();
    if (cached && cached.page.cache.ttlMs > 0) {
      const expiresAtMs = cached.receivedAtMs + cached.page.cache.ttlMs;
      if (now < expiresAtMs) {
        return {
          page: cached.page,
          cache: this.listCacheMetadata({
            entry,
            operation,
            cursor,
            source: "cache",
            reason: "fresh",
            page: cached.page,
            receivedAtMs: cached.receivedAtMs,
          }),
        };
      }
    }

    const invalidated = this.listCacheInvalidations.get(operationPrefix);
    const reason: McpListCacheReason = invalidated
      ?? (cached
        ? cached.page.cache.ttlMs <= 0 ? "ttl-not-positive" : "expired"
        : "missing");
    const page = await fetchPage(cursor);
    const receivedAtMs = Date.now();
    if (page.cache.ttlMs > 0) {
      this.listCache.set(key, { page, receivedAtMs });
    } else {
      this.listCache.delete(key);
    }
    this.listCacheInvalidations.delete(operationPrefix);
    return {
      page,
      cache: this.listCacheMetadata({
        entry,
        operation,
        cursor,
        source: "server",
        reason: page.cache.ttlMs <= 0 && reason === "missing" ? "ttl-not-positive" : reason,
        page,
        receivedAtMs,
      }),
    };
  }

  private async cachedListPages<TPage extends McpCacheableListPage>(
    entry: McpOperationEntry,
    operation: McpCachedListOperationKind,
    fetchPage: (cursor: string | undefined) => Promise<TPage>,
  ): Promise<{ pages: TPage[]; cache: McpListCacheMetadata[] }> {
    const pages: TPage[] = [];
    const cache: McpListCacheMetadata[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const result = await this.cachedListPage(entry, operation, cursor, fetchPage);
      pages.push(result.page);
      cache.push(result.cache);
      cursor = result.page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(`Malformed MCP ${operation} result: repeated nextCursor`);
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);

    return { pages, cache };
  }

  private listCacheResultMeta(cache: McpListCacheMetadata[]): KotaJsonObject {
    return toStructuredContent({ mcp: { cache } });
  }

  private remoteSkillCatalogCachePrefix(serverName: string): string {
    return `${serverName}\u0000skills/list\u0000`;
  }

  private remoteSkillCatalogCacheKey(entry: McpOperationEntry): string {
    return `${this.remoteSkillCatalogCachePrefix(entry.serverName)}${entry.client.getCacheAuthorizationContextKey()}`;
  }

  private invalidateRemoteSkillCatalogCache(serverName: string): void {
    const prefix = this.remoteSkillCatalogCachePrefix(serverName);
    for (const key of [...this.remoteSkillCatalogCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.remoteSkillCatalogCache.delete(key);
      }
    }
    this.remoteSkillCatalogInvalidations.set(prefix, "list_changed");
  }

  private remoteSkillCatalogCacheMetadata(args: {
    entry: McpOperationEntry;
    source: McpListCacheSource;
    reason: McpRemoteSkillCatalogCacheReason;
    catalog: Extract<McpRemoteSkillCatalog, { status: "enumerated" }>;
    receivedAtMs: number;
  }): McpRemoteSkillCatalogCacheMetadata {
    const expiresAtMs = args.receivedAtMs + args.catalog.cache.ttlMs;
    return {
      server: args.entry.serverName,
      operation: "skills/list",
      source: args.source,
      reason: args.reason,
      ttlMs: args.catalog.cache.ttlMs,
      cacheScope: args.catalog.cache.cacheScope,
      receivedAt: new Date(args.receivedAtMs).toISOString(),
      expiresAt: args.catalog.cache.ttlMs > 0 ? new Date(expiresAtMs).toISOString() : null,
    };
  }

  private async cachedRemoteSkillCatalog(
    entry: McpOperationEntry,
  ): Promise<{ catalog: McpRemoteSkillCatalog; cache?: McpRemoteSkillCatalogCacheMetadata }> {
    const key = this.remoteSkillCatalogCacheKey(entry);
    const prefix = this.remoteSkillCatalogCachePrefix(entry.serverName);
    const cached = this.remoteSkillCatalogCache.get(key);
    const now = Date.now();
    if (cached && cached.catalog.cache.ttlMs > 0) {
      const expiresAtMs = cached.receivedAtMs + cached.catalog.cache.ttlMs;
      if (now < expiresAtMs) {
        return {
          catalog: cached.catalog,
          cache: this.remoteSkillCatalogCacheMetadata({
            entry,
            source: "cache",
            reason: "fresh",
            catalog: cached.catalog,
            receivedAtMs: cached.receivedAtMs,
          }),
        };
      }
    }

    const invalidated = this.remoteSkillCatalogInvalidations.get(prefix);
    const reason: McpRemoteSkillCatalogCacheReason = invalidated
      ?? (cached
        ? cached.catalog.cache.ttlMs <= 0 ? "ttl-not-positive" : "expired"
        : "missing");
    const catalog = await entry.client.listRemoteSkills();
    if (catalog.status !== "enumerated") {
      this.remoteSkillCatalogCache.delete(key);
      this.remoteSkillCatalogInvalidations.delete(prefix);
      return { catalog };
    }

    const receivedAtMs = Date.now();
    if (catalog.cache.ttlMs > 0) {
      this.remoteSkillCatalogCache.set(key, { catalog, receivedAtMs });
    } else {
      this.remoteSkillCatalogCache.delete(key);
    }
    this.remoteSkillCatalogInvalidations.delete(prefix);
    return {
      catalog,
      cache: this.remoteSkillCatalogCacheMetadata({
        entry,
        source: "server",
        reason: catalog.cache.ttlMs <= 0 && reason === "missing" ? "ttl-not-positive" : reason,
        catalog,
        receivedAtMs,
      }),
    };
  }

  private remoteSkillCatalogResultMeta(
    cache: McpRemoteSkillCatalogCacheMetadata | undefined,
  ): KotaJsonObject | undefined {
    return cache ? toStructuredContent({ mcp: { cache: [cache] } }) : undefined;
  }

  private async executeOperation(
    entry: McpOperationEntry,
    input: KotaJsonObject,
    options: McpExecuteToolOptions,
  ): Promise<ToolResult> {
    if (!entry.client.isConnected()) {
      return {
        content: `MCP server disconnected for operation: ${entry.tool.name}`,
        is_error: true,
      };
    }

    try {
      if (entry.kind === "resources/list") {
        const result = await this.cachedListPages(
          entry,
          "resources/list",
          (cursor) => entry.client.listResourcesPage(cursor),
        );
        const resources = result.pages.flatMap((page) => page.resources);
        return toOperationResult(
          toStructuredContent({ resources }),
          this.listCacheResultMeta(result.cache),
        );
      }
      if (entry.kind === "resources/templates/list") {
        const result = await this.cachedListPages(
          entry,
          "resources/templates/list",
          (cursor) => entry.client.listResourceTemplatesPage(cursor),
        );
        const resourceTemplates = result.pages.flatMap((page) => page.resourceTemplates);
        return toOperationResult(
          toStructuredContent({ resourceTemplates }),
          this.listCacheResultMeta(result.cache),
        );
      }
      if (entry.kind === "resources/read") {
        const uri = stringInput(input, "uri", entry.tool.name);
        if (!uri.ok) return uri.result;
        const result = await entry.client.readResource(uri.value);
        return this.toOperationInvocationResult(entry, result, input, options);
      }
      if (entry.kind === "skills/list") {
        const result = await this.cachedRemoteSkillCatalog(entry);
        return toOperationResult(
          toStructuredContent({
            server: entry.serverName,
            displayName: entry.client.getName(),
            ...result.catalog,
          }),
          this.remoteSkillCatalogResultMeta(result.cache),
        );
      }
      if (entry.kind === "skills/read") {
        const target = await this.remoteSkillReadTarget(entry, input);
        if (!target.ok) return target.result;
        const result = await entry.client.readRemoteSkill(target.value.uri, target.value.source);
        return await this.toRemoteSkillReadInvocationResult(
          entry,
          result,
          input,
          options,
          target.value,
        );
      }
      if (entry.kind === "prompts/list") {
        const result = await this.cachedListPages(
          entry,
          "prompts/list",
          (cursor) => entry.client.listPromptsPage(cursor),
        );
        const prompts = result.pages.flatMap((page) => page.prompts);
        return toOperationResult(
          toStructuredContent({ prompts }),
          this.listCacheResultMeta(result.cache),
        );
      }
      const name = stringInput(input, "name", entry.tool.name);
      if (!name.ok) return name.result;
      const args = promptArgumentsInput(input);
      if (!args.ok) return args.result;
      const result = await entry.client.getPrompt(name.value, args.value);
      return this.toOperationInvocationResult(entry, result, input, options);
    } catch (err) {
      if (!entry.client.isConnected()) {
        return {
          content: `MCP server disconnected for operation: ${entry.tool.name}`,
          is_error: true,
        };
      }
      const message = err instanceof McpToolError
        ? err.message
        : `MCP operation error: ${(err as Error).message}`;
      return { content: message, is_error: true };
    }
  }

  private async remoteSkillReadTarget(
    entry: McpOperationEntry,
    input: KotaJsonObject,
  ): Promise<
    | { ok: true; value: McpRemoteSkillReadTarget }
    | { ok: false; result: ToolResult }
  > {
    const name = input.name;
    const uri = input.uri;
    const hasName = typeof name === "string" && name.length > 0;
    const hasUri = typeof uri === "string" && uri.length > 0;
    if (hasName === hasUri) {
      return {
        ok: false,
        result: {
          content: `MCP operation error: ${entry.tool.name} requires exactly one non-empty string input "name" or "uri"`,
          is_error: true,
        },
      };
    }
    const relativePath = input.relativePath;
    if (relativePath !== undefined && (typeof relativePath !== "string" || relativePath.length === 0)) {
      return {
        ok: false,
        result: {
          content: `MCP operation error: ${entry.tool.name} input "relativePath" must be a non-empty string when provided`,
          is_error: true,
        },
      };
    }
    try {
      if (hasUri) {
        const baseUri = uri as string;
        const readUri = relativePath === undefined
          ? baseUri
          : resolveRemoteSkillRelativeUri(baseUri, relativePath);
        assertValidRemoteSkillResourceUri(readUri);
        return { ok: true, value: { uri: readUri, source: "direct" } };
      }

      const catalog = await this.cachedRemoteSkillCatalog(entry);
      if (catalog.catalog.status !== "enumerated") {
        return {
          ok: false,
          result: {
            content:
              `MCP operation error: remote skill catalog for server "${entry.serverName}" ` +
              `is unavailable; read by skill:// URI instead. Reason: ${catalog.catalog.reason}`,
            is_error: true,
          },
        };
      }
      const matches = catalog.catalog.skills.filter(
        (skill): skill is Extract<McpRemoteSkillCatalogEntry, { type: "skill-md" }> =>
          skill.type === "skill-md" && skill.name === name,
      );
      if (matches.length === 0) {
        return {
          ok: false,
          result: {
            content: `MCP operation error: remote skill "${name as string}" was not found on server "${entry.serverName}"`,
            is_error: true,
          },
        };
      }
      const baseUri = matches[0].uri;
      const readUri = relativePath === undefined
        ? baseUri
        : resolveRemoteSkillRelativeUri(baseUri, relativePath);
      return { ok: true, value: { uri: readUri, source: "enumerated" } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        result: {
          content: `MCP operation error: ${message}`,
          is_error: true,
        },
      };
    }
  }

  private async toRemoteSkillReadInvocationResult(
    entry: McpOperationEntry,
    result: McpRemoteSkillReadResult,
    _input: KotaJsonObject,
    options: McpExecuteToolOptions,
    target: McpRemoteSkillReadTarget,
  ): Promise<ToolResult> {
    if (result.resultType !== "input_required") {
      return toOperationResult(toStructuredContent(result));
    }
    if (!result.inputRequests) {
      if (result.requestState === undefined) {
        return unsupportedOperationInputRequiredResult(
          entry,
          result,
          "the remote server returned input_required without inputRequests or requestState.",
        );
      }
      const retried = await entry.client.readRemoteSkill(
        target.uri,
        target.source,
        { requestState: result.requestState },
      );
      return retried.resultType === "input_required"
        ? unsupportedOperationInputRequiredResult(
          entry,
          retried,
          "the remote server requested additional input again after the retry.",
        )
        : toOperationResult(toStructuredContent(retried));
    }
    if (!options.inputResolver) {
      return unsupportedOperationInputRequiredResult(entry, result);
    }
    const routed = await options.inputResolver({
      server: entry.client.getName(),
      tool: entry.kind,
      inputRequests: result.inputRequests,
      ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
      ...(result._meta ? { resultMeta: result._meta } : {}),
    });
    if (routed.kind === "unavailable") {
      return unsupportedOperationInputRequiredResult(entry, result, routed.reason);
    }
    const retry = {
      inputResponses: routed.inputResponses,
      inputRequests: result.inputRequests,
      ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
    };
    const retried = await entry.client.readRemoteSkill(
      target.uri,
      target.source,
      retry,
    );
    return retried.resultType === "input_required"
      ? unsupportedOperationInputRequiredResult(
        entry,
        retried,
        "the remote server requested additional input again after the retry.",
      )
      : toOperationResult(toStructuredContent(retried));
  }

  private async toOperationInvocationResult(
    entry: McpOperationEntry,
    result: McpReadResourceResult | McpGetPromptResult,
    input: KotaJsonObject,
    options: McpExecuteToolOptions,
  ): Promise<ToolResult> {
    if (result.resultType !== "input_required") {
      return toOperationResult(toStructuredContent(result));
    }
    if (!result.inputRequests) {
      if (result.requestState === undefined) {
        return unsupportedOperationInputRequiredResult(
          entry,
          result,
          "the remote server returned input_required without inputRequests or requestState.",
        );
      }
      const retried = await this.retryOperation(entry, input, {
        requestState: result.requestState,
      });
      return retried.resultType === "input_required"
        ? unsupportedOperationInputRequiredResult(
          entry,
          retried,
          "the remote server requested additional input again after the retry.",
        )
        : toOperationResult(toStructuredContent(retried));
    }
    if (!options.inputResolver) {
      return unsupportedOperationInputRequiredResult(entry, result);
    }
    const routed = await options.inputResolver({
      server: entry.client.getName(),
      tool: entry.kind,
      inputRequests: result.inputRequests,
      ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
      ...(result._meta ? { resultMeta: result._meta } : {}),
    });
    if (routed.kind === "unavailable") {
      return unsupportedOperationInputRequiredResult(entry, result, routed.reason);
    }
    const retry = {
      inputResponses: routed.inputResponses,
      inputRequests: result.inputRequests,
      ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
    };
    const retried = await this.retryOperation(entry, input, retry);
    return retried.resultType === "input_required"
      ? unsupportedOperationInputRequiredResult(
        entry,
        retried,
        "the remote server requested additional input again after the retry.",
      )
      : toOperationResult(toStructuredContent(retried));
  }

  private async retryOperation(
    entry: McpOperationEntry,
    input: KotaJsonObject,
    retry: Parameters<McpClient["readResource"]>[1],
  ): Promise<McpReadResourceResult | McpGetPromptResult> {
    if (entry.kind === "resources/read") {
      const uri = stringInput(input, "uri", entry.tool.name);
      if (!uri.ok) {
        throw new Error(uri.result.content);
      }
      return entry.client.readResource(uri.value, retry);
    }
    if (entry.kind === "prompts/get") {
      const name = stringInput(input, "name", entry.tool.name);
      if (!name.ok) {
        throw new Error(name.result.content);
      }
      const args = promptArgumentsInput(input);
      if (!args.ok) {
        throw new Error(args.result.content);
      }
      return entry.client.getPrompt(name.value, args.value, retry);
    }
    throw new Error(`MCP operation ${entry.kind} does not support input retry`);
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
    this.serverOperations.clear();
    this.toolMap.clear();
    this.operationMap.clear();
    this.listCache.clear();
    this.listCacheInvalidations.clear();
    this.remoteSkillCatalogCache.clear();
    this.remoteSkillCatalogInvalidations.clear();
    this.toolDeclarationDriftDiagnostics = [];
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
    const previousByOriginalName = new Map(
      (this.serverTools.get(serverName) ?? []).map((entry) => [entry.originalName, entry]),
    );
    const entries = tools.map((tool) => {
      const kotaTool = toKotaTool(serverName, tool);
      return {
        serverConfigName: serverName,
        client,
        originalName: tool.name,
        tool: kotaTool,
        declaration: fingerprintMcpToolDeclaration({
          serverConfigName: serverName,
          serverDisplayName: client.getName(),
          tool,
          tasksSupported: client.supportsTasks(),
        }),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      };
    });
    const nextToolMap = new Map(this.toolMap);
    for (const entry of this.serverTools.get(serverName) ?? []) {
      nextToolMap.delete(entry.tool.name);
    }
    const duplicate = firstDuplicateMcpToolName([
      ...nextToolMap.keys(),
      ...entries.map((entry) => entry.tool.name),
    ]);
    if (duplicate) {
      throw new Error(
        `Invalid MCP tool registry for server "${serverName}": duplicate generated MCP tool name "${duplicate}"`,
      );
    }
    this.recordToolDeclarationDrift(previousByOriginalName, entries);
    for (const entry of entries) nextToolMap.set(entry.tool.name, entry);
    this.serverTools.set(serverName, entries);
    this.toolMap = nextToolMap;
    this.replaceServerOperations(serverName, client);
    this.rebuildKotaTools();
  }

  private recordToolDeclarationDrift(
    previousByOriginalName: Map<string, McpToolEntry>,
    entries: McpToolEntry[],
  ): void {
    const diagnostics: McpToolDeclarationDriftDiagnostic[] = [];
    for (const entry of entries) {
      const previous = previousByOriginalName.get(entry.originalName);
      if (!previous) continue;
      if (previous.declaration.fingerprint === entry.declaration.fingerprint) continue;
      const changedFacets = changedMcpToolDeclarationFacets(
        previous.declaration,
        entry.declaration,
      );
      diagnostics.push({
        serverConfigName: entry.serverConfigName,
        serverDisplayName: entry.client.getName(),
        toolName: entry.originalName,
        previousFingerprint: previous.declaration.fingerprint,
        currentFingerprint: entry.declaration.fingerprint,
        changedFacets,
      });
    }
    if (diagnostics.length === 0) return;
    this.toolDeclarationDriftDiagnostics = [
      ...this.toolDeclarationDriftDiagnostics,
      ...diagnostics,
    ].slice(-MAX_TOOL_DECLARATION_DRIFT_DIAGNOSTICS);
    for (const diagnostic of diagnostics) {
      printTerminalDiagnostic(
        `[kota] Warning: MCP server "${diagnostic.serverConfigName}" tool declaration changed for ` +
          `"${diagnostic.toolName}" (${diagnostic.previousFingerprint.slice(0, 12)} -> ` +
          `${diagnostic.currentFingerprint.slice(0, 12)}; facets: ` +
          `${diagnostic.changedFacets.join(", ") || "fingerprint"})`,
        "warn",
      );
    }
  }

  private replaceServerOperations(serverName: string, client: McpClient): void {
    const entries = toKotaOperations(serverName, client);
    const nextOperationMap = new Map(this.operationMap);
    for (const entry of this.serverOperations.get(serverName) ?? []) {
      nextOperationMap.delete(entry.tool.name);
    }
    for (const entry of entries) {
      nextOperationMap.set(entry.tool.name, entry);
    }
    this.serverOperations.set(serverName, entries);
    this.operationMap = nextOperationMap;
  }

  private rebuildKotaTools(): void {
    const remoteTools = [...this.serverTools.values()].flatMap((serverEntries) =>
      serverEntries.map((entry) => entry.tool),
    );
    const remoteOperations = [...this.serverOperations.values()].flatMap((serverEntries) =>
      serverEntries.map((entry) => entry.tool),
    );
    this.kotaTools = [...remoteTools, ...remoteOperations];
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
      this.replaceServerTools(serverName, client, tools);
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
