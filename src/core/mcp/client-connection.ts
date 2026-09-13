import { McpAuthorizationError, McpAuthorizationFlowError, McpConnectionError, McpToolError } from "./client-auth-types.js";
import {
  isUnsupportedProtocolVersionError,
  McpJsonRpcError,
  supportedVersionsForUnsupportedProtocolVersionError,
} from "./client-decode-utils.js";
import {
  decodeDiscoverResult,
  decodeInitializeResult,
} from "./client-initialize-decoders.js";
import type {
  JsonRpcParams,
  JsonRpcResult,
  McpInitializeResult,
  McpProtocolVersion,
  McpRequestProgressOptions,
} from "./client-protocol.js";
import {
  CONNECT_TIMEOUT,
  KOTA_MCP_CLIENT_INFO,
  MCP_CURRENT_PROTOCOL_VERSION,
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSIONS,
  MCP_STATELESS_PROTOCOL_VERSION,
  mcpProtocolSupports,
  mcpToolResultContractForProtocol,
} from "./client-protocol.js";
import { McpClientStdioRuntime } from "./client-stdio-runtime.js";

export abstract class McpClientConnection extends McpClientStdioRuntime {
  /** Connect the configured transport and complete the MCP handshake. */
  async connect(): Promise<void> {
    if (this.connected) {
      throw this.diagnosticError(`MCP server "${this.serverName}" is already connected`);
    }
    if (this.connecting) {
      throw this.diagnosticError(`MCP server "${this.serverName}" is already connecting`);
    }
    if (this.closing) {
      throw this.diagnosticError(`MCP server "${this.serverName}" is closed`);
    }

    this.connecting = true;
    try {
      const result = this.transport.type === "http"
        ? await this.connectHttp()
        : await this.connectStdio();
      if (this.closing) {
        throw this.diagnosticError(`MCP server "${this.serverName}" was closed during connection`);
      }
      this.applyInitializeResult(result);
    } catch (err) {
      if (this.transport.type !== "stdio") throw err;
      // Version negotiation needs the raw JSON-RPC error and its data until
      // fallback finishes. Only the terminal failure crosses the public boundary.
      const message = err instanceof Error ? err.message : String(err);
      throw this.requestErrorForMethod("initialize", message);
    } finally {
      this.connecting = false;
    }
  }

  protected async connectHttp(): Promise<McpInitializeResult> {
    this.protocolVersion = MCP_STATELESS_PROTOCOL_VERSION;
    this.toolResultContract = "complete-tool-result";
    try {
      return await this.discoverServer();
    } catch (err) {
      if (err instanceof McpConnectionError || err instanceof McpAuthorizationError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw this.requestErrorForMethod("server/discover", message);
    }
  }

  protected applyInitializeResult(result: McpInitializeResult): void {
    if (result.serverInfo?.name) {
      this.serverName = result.serverInfo.name;
    }
    this.warnDeprecatedServerCapabilities(result);
    this.protocolVersion = result.protocolVersion;
    this.toolResultContract = mcpToolResultContractForProtocol(result.protocolVersion);
    this.toolsSupported = result.toolsSupported;
    this.toolsListChanged = result.toolsListChanged;
    this.resourcesSupported = result.resourcesSupported;
    this.resourcesListChanged = result.resourcesListChanged;
    this.promptsSupported = result.promptsSupported;
    this.promptsListChanged = result.promptsListChanged;
    this.tasksSupported = result.tasksSupported;
    this.skillsSupported = result.skillsSupported;
    this.connected = true;
    if (
      mcpProtocolSupports(result.protocolVersion, "listChangedSubscriptions") &&
      (this.toolsListChanged || this.resourcesListChanged || this.promptsListChanged)
    ) {
      this.openListChangedSubscription();
    }
  }

  /** Gracefully shut down the server. */
  async close(): Promise<void> {
    if (this.transport.type === "http") {
      if (this.closing) return;
      this.closing = true;
      this.connected = false;
      this.httpListSubscriptionAbort?.abort();
      this.httpListSubscriptionAbort = null;
      this.streamingRequestIds.clear();
      this.clearAllProgress();
      this.toolListSubscriptionId = null;
      this.toolListChangedHandlers.clear();
      this.resourceListChangedHandlers.clear();
      this.promptListChangedHandlers.clear();
      return;
    }
    await this.closeStdio();
  }

  protected async discoverServer(): Promise<McpInitializeResult> {
    this.protocolVersion = MCP_STATELESS_PROTOCOL_VERSION;
    let result: JsonRpcResult;
    try {
      result = await this.request("server/discover");
    } catch (error) {
      if (!(error instanceof McpJsonRpcError) || !isUnsupportedProtocolVersionError(error)) throw error;
      const supported = supportedVersionsForUnsupportedProtocolVersionError(error);
      const version = MCP_MODERN_PROTOCOL_VERSIONS.find((candidate) =>
        candidate !== MCP_STATELESS_PROTOCOL_VERSION && supported?.includes(candidate));
      if (!version) throw error;
      this.protocolVersion = version;
      result = await this.request("server/discover");
    }
    return decodeDiscoverResult(result, this.protocolVersion);
  }

  protected async initializeServer(): Promise<McpInitializeResult> {
    try {
      return await this.discoverServer();
    } catch (error) {
      // Modern errors identify a modern peer; malformed successful discovery
      // also must not be hidden behind an initialization fallback.
      if (!(error instanceof McpJsonRpcError) &&
          !(error instanceof Error && /timed out/.test(error.message))) throw error;
      if (error instanceof McpJsonRpcError &&
          [-32020, -32021, -32022].includes(error.code)) throw error;
    }
    this.protocolVersion = null;
    try {
      return await this.requestInitialize(MCP_CURRENT_PROTOCOL_VERSION);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (!isUnsupportedProtocolVersionError(error)) throw err;
      return await this.requestInitialize(
        this.fallbackProtocolVersionForUnsupportedInitialize(error),
      );
    }
  }

  protected fallbackProtocolVersionForUnsupportedInitialize(
    error: Error,
  ): McpProtocolVersion {
    const supportedVersions = supportedVersionsForUnsupportedProtocolVersionError(error);
    if (supportedVersions === null) return MCP_LEGACY_PROTOCOL_VERSION;
    if (supportedVersions.includes(MCP_DRAFT_PROTOCOL_VERSION)) {
      return MCP_DRAFT_PROTOCOL_VERSION;
    }
    if (supportedVersions.includes(MCP_LEGACY_PROTOCOL_VERSION)) {
      return MCP_LEGACY_PROTOCOL_VERSION;
    }
    throw error;
  }

  protected async requestInitialize(
    protocolVersion: McpProtocolVersion,
  ): Promise<McpInitializeResult> {
    const result = await this.request("initialize", {
      protocolVersion,
      capabilities: this.clientCapabilitiesForProtocol(protocolVersion),
      clientInfo: KOTA_MCP_CLIENT_INFO,
    });
    return decodeInitializeResult(result);
  }

  protected request(
    method: string,
    params?: JsonRpcParams,
    timeout = CONNECT_TIMEOUT,
    progress?: McpRequestProgressOptions,
    signal?: AbortSignal,
  ): Promise<JsonRpcResult> {
    const response = this.transport.type === "http"
      ? this.httpRequest(method, params, timeout, progress, signal)
      : this.stdioRequest(method, params, timeout, progress, signal);
    return response.then((result) => {
      if (method !== "server/discover" && this.protocolVersion === MCP_STATELESS_PROTOCOL_VERSION) {
        if (typeof result !== "object" || result === null || !("resultType" in result) ||
            (result.resultType !== "complete" && result.resultType !== "input_required")) {
          throw new Error(`Malformed MCP ${method} result: unsupported or missing resultType`);
        }
        if (result.resultType === "complete" && ["tools/list", "resources/list", "resources/templates/list", "resources/read", "prompts/list"].includes(method) &&
            (!("ttlMs" in result) || !("cacheScope" in result))) {
          throw new Error(`Malformed MCP ${method} result: cache hints are required`);
        }
        if (result.resultType === "input_required" && !["tools/call", "resources/read", "prompts/get"].includes(method)) {
          throw new Error(`Malformed MCP ${method} result: input_required is not supported for this method`);
        }
      }
      return result;
    }).catch((err) => {
      if (this.transport.type === "http") {
        signal?.throwIfAborted();
        // Keep negotiation data intact until discovery chooses a fallback;
        // connectHttp redacts any terminal failure at the public boundary.
        if (method === "server/discover" && err instanceof McpJsonRpcError) throw err;
        // Typed errors already contain safe projections, including the private
        // challenge retained for OAuth retry. Other transport failures do not.
        if (
          err instanceof McpAuthorizationError || err instanceof McpAuthorizationFlowError ||
          err instanceof McpConnectionError || err instanceof McpToolError
        ) throw err;
        throw this.diagnosticError(err instanceof Error ? err.message : String(err));
      }
      if (method === "initialize" || method === "server/discover") throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw this.requestErrorForMethod(method, message);
    });
  }

  protected openListChangedSubscription(): void {
    if (this.transport.type === "http") {
      this.openHttpListChangedSubscription();
      return;
    }
    this.openStdioListChangedSubscription();
  }
}
