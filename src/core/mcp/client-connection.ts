import { McpAuthorizationError, McpConnectionError } from "./client-auth-types.js";
import {
  isUnsupportedProtocolVersionError,
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
  mcpProtocolSupports,
  mcpToolResultContractForProtocol,
} from "./client-protocol.js";
import { McpClientStdioRuntime } from "./client-stdio-runtime.js";

export abstract class McpClientConnection extends McpClientStdioRuntime {
  /** Connect the configured transport and complete the MCP handshake. */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error(`MCP server "${this.serverName}" is already connected`);
    }
    if (this.connecting) {
      throw new Error(`MCP server "${this.serverName}" is already connecting`);
    }
    if (this.closing) {
      throw new Error(`MCP server "${this.serverName}" is closed`);
    }

    this.connecting = true;
    try {
      const result = this.transport.type === "http"
        ? await this.connectHttp()
        : await this.connectStdio();
      if (this.closing) {
        throw new Error(`MCP server "${this.serverName}" was closed during connection`);
      }
      this.applyInitializeResult(result);
    } finally {
      this.connecting = false;
    }
  }

  protected async connectHttp(): Promise<McpInitializeResult> {
    this.protocolVersion = MCP_CURRENT_PROTOCOL_VERSION;
    this.toolResultContract = "complete-tool-result";
    try {
      return decodeDiscoverResult(await this.request("server/discover"));
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

  protected async initializeServer(): Promise<McpInitializeResult> {
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
  ): Promise<JsonRpcResult> {
    if (this.transport.type === "http") {
      return this.httpRequest(method, params, timeout, progress);
    }
    return this.stdioRequest(method, params, timeout, progress).catch((err) => {
      if (method === "initialize") throw err;
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
