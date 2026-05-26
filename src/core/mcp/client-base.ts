import type { ChildProcess } from "node:child_process";
import type { Interface } from "node:readline";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type {
  McpAuthorizationResolver,
  McpClientOptions,
  McpClientTransportConfig,
  McpOAuthResolvedClient,
  McpOAuthTokenBinding,
  NormalizedMcpClientTransport,
} from "./client-auth-types.js";
import {
  McpConnectionError,
  McpToolError,
} from "./client-auth-types.js";
import {
  authorizationContextKey,
  clientSecretBasicAuthorizationHeader,
  MCP_ENTERPRISE_MANAGED_AUTHORIZATION_EXTENSION_ID,
  MCP_OAUTH_CLIENT_CREDENTIALS_EXTENSION_ID,
  normalizeClientTransportConfig,
} from "./client-authorization-protocol.js";
import {
  escapeRegExp,
  isJsonObject,
  progressTokenKey,
} from "./client-decode-utils.js";
import { uniqueSupportedElicitationModes } from "./client-input-helpers.js";
import type {
  ActiveProgressRequest,
  DeprecatedMcpFeature,
  JsonRpcParams,
  JsonRpcRequest,
  McpElicitationMode,
  McpHeaderParameterSpec,
  McpLogMessageHandler,
  McpOperationRetry,
  McpProgressToken,
  McpPromptListChangedHandler,
  McpProtocolVersion,
  McpRequestProgressOptions,
  McpResourceListChangedHandler,
  McpResultKind,
  McpToolListChangedHandler,
  McpToolResultContract,
  McpToolSchema,
  PendingRequest,
} from "./client-protocol.js";
import {
  DEFAULT_MAX_PROGRESS_EVENTS,
  KOTA_MCP_CLIENT_INFO,
  MCP_CURRENT_PROTOCOL_VERSION,
  MCP_META_CLIENT_CAPABILITIES_KEY,
  MCP_META_CLIENT_INFO_KEY,
  MCP_META_PROTOCOL_VERSION_KEY,
  MCP_TASKS_EXTENSION_ID,
  mcpProtocolSupports,
} from "./client-protocol.js";
import { decodeMcpToolInputResponses } from "./client-result-decoders.js";
import {
  collectMcpHeaderParameters,
  mcpParamHeaderValue,
} from "./client-tool-list-decoders.js";

export abstract class McpClientBase {
  protected readonly transport: NormalizedMcpClientTransport;
  protected readonly cacheAuthorizationContextKey: string;
  protected proc: ChildProcess | null = null;
  protected rl: Interface | null = null;
  protected nextId = 1;
  protected pending = new Map<number, PendingRequest>();
  protected connected = false;
  protected connecting = false;
  protected closing = false;
  protected killTimer: ReturnType<typeof setTimeout> | null = null;
  protected serverName: string;
  protected protocolVersion: McpProtocolVersion | null = null;
  protected toolResultContract: McpToolResultContract | null = null;
  protected toolsSupported = true;
  protected toolsListChanged = false;
  protected resourcesSupported = false;
  protected resourcesListChanged = false;
  protected promptsSupported = false;
  protected promptsListChanged = false;
  protected tasksSupported = false;
  protected skillsSupported = false;
  protected httpListSubscriptionAbort: AbortController | null = null;
  protected toolListSubscriptionId: number | null = null;
  protected streamingRequestIds = new Set<number>();
  protected toolListChangedHandlers = new Set<McpToolListChangedHandler>();
  protected resourceListChangedHandlers = new Set<McpResourceListChangedHandler>();
  protected promptListChangedHandlers = new Set<McpPromptListChangedHandler>();
  protected activeProgressByRequestId = new Map<number, string>();
  protected activeProgressByToken = new Map<string, ActiveProgressRequest>();
  protected progressWarningCount = 0;
  protected readonly deprecatedCapabilityWarnings = new Set<DeprecatedMcpFeature>();
  protected readonly headerParametersByTool = new Map<string, McpHeaderParameterSpec[]>();
  protected readonly supportedElicitationModes: readonly McpElicitationMode[];
  protected readonly remoteTasksEnabled: boolean;
  protected readonly authorizationResolver?: McpAuthorizationResolver;
  protected readonly logMessageHandler?: McpLogMessageHandler;
  protected oauthTokenBinding: McpOAuthTokenBinding | null = null;
  protected readonly oauthClients = new Map<string, McpOAuthResolvedClient>();
  protected readonly oauthClientAssertions = new Set<string>();

  constructor(
    command: string,
    args?: string[],
    env?: Record<string, string>,
    name?: string,
    options?: McpClientOptions,
  );
  constructor(
    transport: McpClientTransportConfig,
    name?: string,
    options?: McpClientOptions,
  );
  constructor(
    commandOrTransport: string | McpClientTransportConfig,
    argsOrName?: string[] | string,
    envOrOptions?: Record<string, string> | McpClientOptions,
    name?: string,
    options?: McpClientOptions,
  );
  constructor(
    commandOrTransport: string | McpClientTransportConfig,
    argsOrName: string[] | string = [],
    envOrOptions: Record<string, string> | McpClientOptions = {},
    name?: string,
    options: McpClientOptions = {},
  ) {
    let resolvedOptions: McpClientOptions;
    if (typeof commandOrTransport === "string") {
      const args = Array.isArray(argsOrName) ? argsOrName : [];
      const env = envOrOptions as Record<string, string>;
      this.transport = {
        type: "stdio",
        command: commandOrTransport,
        args,
        env,
      };
      this.serverName = name || commandOrTransport;
      resolvedOptions = options;
    } else {
      this.transport = normalizeClientTransportConfig(commandOrTransport);
      const explicitName = typeof argsOrName === "string" ? argsOrName : undefined;
      this.serverName = explicitName || this.defaultServerNameForTransport();
      resolvedOptions = envOrOptions as McpClientOptions;
    }
    this.cacheAuthorizationContextKey = authorizationContextKey(this.transport);
    this.supportedElicitationModes = uniqueSupportedElicitationModes(
      resolvedOptions.supportedElicitationModes,
    );
    this.remoteTasksEnabled = resolvedOptions.enableRemoteTasks === true;
    this.authorizationResolver = resolvedOptions.authorizationResolver;
    this.logMessageHandler = resolvedOptions.onLogMessage;
  }

  getName(): string {
    return this.serverName;
  }

  getCacheAuthorizationContextKey(): string {
    return this.cacheAuthorizationContextKey;
  }

  getProtocolVersion(): McpProtocolVersion | null {
    return this.protocolVersion;
  }

  getToolResultContract(): McpToolResultContract | null {
    return this.toolResultContract;
  }

  supportsToolListChanged(): boolean {
    return this.toolsListChanged;
  }

  supportsTools(): boolean {
    return this.toolsSupported;
  }

  supportsResources(): boolean {
    return this.resourcesSupported;
  }

  supportsResourceListChanged(): boolean {
    return this.resourcesListChanged;
  }

  supportsPrompts(): boolean {
    return this.promptsSupported;
  }

  supportsPromptListChanged(): boolean {
    return this.promptsListChanged;
  }

  supportsTasks(): boolean {
    return this.remoteTasksEnabled &&
      this.tasksSupported &&
      this.protocolVersion !== null &&
      mcpProtocolSupports(this.protocolVersion, "tasksExtension");
  }

  supportsSkills(): boolean {
    return this.skillsSupported &&
      this.resourcesSupported &&
      this.protocolVersion !== null &&
      mcpProtocolSupports(this.protocolVersion, "skillsExtension");
  }

  onToolListChanged(handler: McpToolListChangedHandler): () => void {
    this.toolListChangedHandlers.add(handler);
    return () => {
      this.toolListChangedHandlers.delete(handler);
    };
  }

  onResourceListChanged(handler: McpResourceListChangedHandler): () => void {
    this.resourceListChangedHandlers.add(handler);
    return () => {
      this.resourceListChangedHandlers.delete(handler);
    };
  }

  onPromptListChanged(handler: McpPromptListChangedHandler): () => void {
    this.promptListChangedHandlers.add(handler);
    return () => {
      this.promptListChangedHandlers.delete(handler);
    };
  }

  isConnected(): boolean {
    return this.connected;
  }


  protected applyInputRetryParams(
    params: NonNullable<JsonRpcRequest["params"]>,
    retry: McpOperationRetry | undefined,
    kind: McpResultKind,
  ): void {
    if (!retry) return;
    if (retry.requestState === undefined && retry.inputResponses === undefined) {
      throw new Error(
        `Malformed MCP ${kind} retry: must include inputResponses or requestState`,
      );
    }
    if (retry.requestState !== undefined) {
      if (retry.requestState.length === 0) {
        throw new Error(`Malformed MCP ${kind} retry: requestState must be a non-empty string`);
      }
      params.requestState = retry.requestState;
    }
    if (retry.inputResponses !== undefined) {
      params.inputResponses = decodeMcpToolInputResponses(
        retry.inputResponses,
        retry.inputRequests,
        kind,
      );
    }
  }


  protected clientCapabilitiesForProtocol(
    protocolVersion: McpProtocolVersion | null = this.protocolVersion,
  ): KotaJsonObject {
    const capabilities: KotaJsonObject = {};
    const extensions: KotaJsonObject = {};
    if (
      this.transport.type === "http" &&
      this.transport.authorization?.type === "oauth-client-credentials"
    ) {
      extensions[MCP_OAUTH_CLIENT_CREDENTIALS_EXTENSION_ID] = {};
    } else if (
      this.transport.type === "http" &&
      this.transport.authorization?.type === "enterprise-managed"
    ) {
      extensions[MCP_ENTERPRISE_MANAGED_AUTHORIZATION_EXTENSION_ID] = {};
    }
    if (
      protocolVersion !== null &&
      mcpProtocolSupports(protocolVersion, "tasksExtension") &&
      this.remoteTasksEnabled
    ) {
      extensions[MCP_TASKS_EXTENSION_ID] = {};
    }
    if (Object.keys(extensions).length > 0) {
      capabilities.extensions = extensions;
    }
    if (
      protocolVersion !== null &&
      mcpProtocolSupports(protocolVersion, "elicitation") &&
      this.supportedElicitationModes.length > 0
    ) {
      const elicitation: KotaJsonObject = {};
      for (const mode of this.supportedElicitationModes) {
        elicitation[mode] = {};
      }
      capabilities.elicitation = elicitation;
    }
    return capabilities;
  }

  protected protocolRequestMeta(): KotaJsonObject {
    return {
      [MCP_META_PROTOCOL_VERSION_KEY]: this.protocolVersion ?? MCP_CURRENT_PROTOCOL_VERSION,
      [MCP_META_CLIENT_INFO_KEY]: KOTA_MCP_CLIENT_INFO,
      [MCP_META_CLIENT_CAPABILITIES_KEY]: this.clientCapabilitiesForProtocol(),
    };
  }

  protected paramsWithProtocolMetadata(
    params: JsonRpcParams,
    progressToken?: McpProgressToken,
  ): JsonRpcParams {
    if (
      this.protocolVersion === null ||
      !mcpProtocolSupports(this.protocolVersion, "requestMetadata")
    ) return params;
    const rawMeta = params?._meta;
    if (rawMeta !== undefined && !isJsonObject(rawMeta)) {
      throw new Error("Malformed MCP request params: _meta must be an object");
    }
    return {
      ...(params ?? {}),
      _meta: {
        ...(rawMeta ?? {}),
        ...(progressToken !== undefined ? { progressToken } : {}),
        ...this.protocolRequestMeta(),
      },
    };
  }


  protected cacheHeaderParameters(tools: readonly McpToolSchema[]): void {
    this.headerParametersByTool.clear();
    for (const tool of tools) {
      const specs = collectMcpHeaderParameters(tool);
      if (specs.length === 0) continue;
      this.headerParametersByTool.set(tool.name, specs);
    }
  }

  protected setHttpParamHeaders(
    headers: Headers,
    method: string,
    params: JsonRpcParams,
  ): void {
    if (method !== "tools/call") return;
    const toolName = typeof params?.name === "string" ? params.name : null;
    if (toolName === null) return;
    const specs = this.headerParametersByTool.get(toolName);
    if (!specs) return;
    const args = isJsonObject(params?.arguments) ? params.arguments : {};
    for (const spec of specs) {
      const value = mcpParamHeaderValue(args[spec.paramName]);
      if (value === null) continue;
      headers.set(`Mcp-Param-${spec.headerName}`, value);
    }
  }

  protected httpMcpNameForRequest(
    method: string,
    params: JsonRpcParams,
  ): string | null {
    if (method === "tools/call" || method === "prompts/get") {
      return typeof params?.name === "string" ? params.name : "";
    }
    if (method === "resources/read") {
      return typeof params?.uri === "string" ? params.uri : "";
    }
    if (
      method === "tasks/get" ||
      method === "tasks/update" ||
      method === "tasks/cancel"
    ) {
      return typeof params?.taskId === "string" ? params.taskId : "";
    }
    return null;
  }

  protected sensitiveValuesForRedaction(): string[] {
    const values: string[] = [];
    const add = (value: string | undefined) => {
      if (value && value.length > 0) values.push(value);
    };
    if (this.transport.type === "http") {
      for (const [key, value] of Object.entries(this.transport.headers ?? {})) {
        if (key.toLowerCase() !== "authorization") continue;
        add(value);
        const bearer = /^Bearer\s+(.+)$/i.exec(value);
        add(bearer?.[1]);
      }
      const client = this.transport.authorization?.client;
      if (client?.kind === "registered") {
        if ("clientSecret" in client && client.clientSecret !== undefined) {
          add(client.clientSecret);
          add(clientSecretBasicAuthorizationHeader(client.clientId, client.clientSecret));
        }
        if ("privateKeyPem" in client) add(client.privateKeyPem);
      }
      const subjectToken = this.transport.authorization?.type === "enterprise-managed"
        ? this.transport.authorization.subjectToken
        : undefined;
      if (subjectToken?.source.kind === "static") add(subjectToken.source.token);
      if (subjectToken?.source.kind === "env") add(process.env[subjectToken.source.name]);
    }
    for (const assertion of this.oauthClientAssertions) add(assertion);
    add(this.oauthTokenBinding?.token.accessToken);
    add(this.oauthTokenBinding?.token.refreshToken);
    return [...new Set(values)].sort((left, right) => right.length - left.length);
  }

  protected redactSensitiveErrorMessage(message: string): string {
    let redacted = message;
    for (const value of this.sensitiveValuesForRedaction()) {
      redacted = redacted.replace(new RegExp(escapeRegExp(value), "g"), "[redacted]");
    }
    return redacted;
  }

  protected requestErrorForMethod(method: string, message: string): Error {
    const redactedMessage = this.redactSensitiveErrorMessage(message);
    if (
      method === "tools/call" ||
      method === "resources/read" ||
      method === "prompts/get" ||
      method === "tasks/get" ||
      method === "tasks/update" ||
      method === "tasks/cancel"
    ) {
      return new McpToolError(this.serverName, method, redactedMessage);
    }
    return new McpConnectionError(this.serverName, method, redactedMessage);
  }

  protected defaultServerNameForTransport(): string {
    if (this.transport.type === "stdio") return this.transport.command;
    return this.transport.url;
  }

  protected trackProgressRequest(
    requestId: number,
    progressToken: McpProgressToken,
    options: McpRequestProgressOptions,
  ): void {
    const key = progressTokenKey(progressToken);
    if (this.activeProgressByToken.has(key)) {
      throw new Error(`MCP progress token is already active: ${String(progressToken)}`);
    }
    const maxEvents = options.maxEvents ?? DEFAULT_MAX_PROGRESS_EVENTS;
    if (!Number.isInteger(maxEvents) || maxEvents <= 0) {
      throw new Error("MCP progress maxEvents must be a positive integer");
    }
    this.activeProgressByRequestId.set(requestId, key);
    this.activeProgressByToken.set(key, {
      requestId,
      progressToken,
      lastProgress: null,
      sequence: 0,
      maxEvents,
      droppedEvents: 0,
      dropWarningEmitted: false,
      onProgress: options.onProgress,
    });
  }

  protected clearProgressForRequest(requestId: number): void {
    const key = this.activeProgressByRequestId.get(requestId);
    if (!key) return;
    this.activeProgressByRequestId.delete(requestId);
    this.activeProgressByToken.delete(key);
  }

  protected clearAllProgress(): void {
    this.activeProgressByRequestId.clear();
    this.activeProgressByToken.clear();
  }
}
