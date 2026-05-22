import { McpClientBase } from "./client-base.js";
import {
  formatJsonRpcId,
  isJsonObject,
  isJsonRpcId,
  isMcpLogLevel,
  isMcpProgressToken,
  progressTokenKey,
} from "./client-decode-utils.js";
import type {
  DeprecatedMcpFeature,
  JsonRpcId,
  JsonRpcIncomingMessage,
  JsonRpcNotification,
  JsonRpcResponse,
  McpCallToolResult,
  McpGetPromptResult,
  McpInitializeResult,
  McpProtocolVersion,
  McpReadResourceResult,
} from "./client-protocol.js";
import {
  MAX_PROGRESS_WARNINGS,
} from "./client-protocol.js";

export abstract class McpClientNotifications extends McpClientBase {
  protected handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as JsonRpcIncomingMessage;
      if (msg.id !== undefined && !isJsonRpcId(msg.id)) {
        this.warnProgress("ignored JSON-RPC message with invalid id: id must be a string or integer");
        return;
      }
      if (this.isServerRequestMessage(msg)) {
        this.handleServerRequest(msg);
        return;
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        this.clearProgressForRequest(msg.id);
        if (msg.error) {
          reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          resolve(msg.result);
        }
        return;
      }
      if (typeof msg.id === "number" && this.streamingRequestIds.has(msg.id)) {
        this.handleStreamingRequestResponse(msg);
        return;
      }
      if (typeof msg.method === "string") {
        this.handleNotification(msg);
      }
    } catch {
      // Non-JSON lines (e.g. server startup messages) are ignored
    }
  }

  protected isServerRequestMessage(
    msg: JsonRpcIncomingMessage,
  ): msg is JsonRpcIncomingMessage & { id: JsonRpcId; method: string } {
    return typeof msg.method === "string" && msg.id !== undefined && isJsonRpcId(msg.id);
  }

  protected handleServerRequest(
    msg: JsonRpcIncomingMessage & { id: JsonRpcId; method: string },
  ): void {
    if (msg.method === "ping") {
      this.writeServerRequestResponse({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    }
    this.writeServerRequestResponse({
      jsonrpc: "2.0",
      id: msg.id,
      error: this.unsupportedServerRequestError(msg.method),
    });
  }

  protected unsupportedServerRequestError(
    method: string,
  ): NonNullable<JsonRpcResponse["error"]> {
    return {
      code: -32601,
      message: `Unsupported server-to-client MCP request method "${method}"`,
    };
  }

  protected writeServerRequestResponse(response: JsonRpcResponse): void {
    if (this.transport.type !== "stdio" || !this.proc?.stdin?.writable) {
      this.warnProgress(
        `cannot answer server-to-client request id ${formatJsonRpcId(response.id)}: transport is not writable`,
      );
      return;
    }
    this.proc.stdin.write(`${JSON.stringify(response)}\n`);
  }

  protected handleStreamingRequestResponse(msg: JsonRpcIncomingMessage): void {
    if (typeof msg.id !== "number") return;
    this.streamingRequestIds.delete(msg.id);
    if (msg.id === this.toolListSubscriptionId) {
      this.toolListSubscriptionId = null;
    }
    if (msg.error) {
      console.error(
        `[kota] Warning: MCP server "${this.serverName}" failed to open subscription: MCP error ${msg.error.code}: ${msg.error.message}`,
      );
    }
  }

  protected handleNotification(msg: JsonRpcIncomingMessage): void {
    if (msg.method === "notifications/progress") {
      this.handleProgressNotification(msg.params);
      return;
    }
    if (msg.method === "notifications/message") {
      this.handleLogMessageNotification(msg.params);
      return;
    }
    if (msg.method === "notifications/cancelled") {
      this.handleCancelledNotification(msg.params);
      return;
    }
    if (msg.method === "notifications/tools/list_changed") {
      if (!this.isToolListChangedNotificationForThisClient(msg.params)) return;
      for (const handler of this.toolListChangedHandlers) {
        handler();
      }
      return;
    }
    if (msg.method === "notifications/resources/list_changed") {
      if (!this.isToolListChangedNotificationForThisClient(msg.params)) return;
      for (const handler of this.resourceListChangedHandlers) {
        handler();
      }
      return;
    }
    if (msg.method === "notifications/prompts/list_changed") {
      if (!this.isToolListChangedNotificationForThisClient(msg.params)) return;
      for (const handler of this.promptListChangedHandlers) {
        handler();
      }
    }
  }

  protected handleLogMessageNotification(params: JsonRpcNotification["params"]): void {
    if (!this.logMessageHandler) return;
    if (!isJsonObject(params)) {
      this.warnProgress("ignored malformed message notification: params must be an object");
      return;
    }
    if (!isMcpLogLevel(params.level)) {
      this.warnProgress(
        "ignored malformed message notification: level must be a known MCP log level",
      );
      return;
    }
    if (params.logger !== undefined && typeof params.logger !== "string") {
      this.warnProgress("ignored malformed message notification: logger must be a string");
      return;
    }
    try {
      this.logMessageHandler({
        level: params.level,
        ...(params.data !== undefined ? { data: params.data } : {}),
        ...(params.logger !== undefined ? { logger: params.logger } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.warnProgress(`ignored MCP log callback error: ${message}`);
    }
  }

  protected isToolListChangedNotificationForThisClient(
    params: JsonRpcNotification["params"],
  ): boolean {
    if (this.toolListSubscriptionId === null) return true;
    const meta = params ? params._meta : undefined;
    if (!isJsonObject(meta)) return true;
    const subscriptionId = meta["io.modelcontextprotocol/subscriptionId"];
    if (subscriptionId === undefined) return true;
    return String(subscriptionId) === String(this.toolListSubscriptionId);
  }

  protected handleProgressNotification(params: JsonRpcNotification["params"]): void {
    if (!isJsonObject(params)) {
      this.warnProgress("ignored malformed progress notification: params must be an object");
      return;
    }
    const token = params.progressToken;
    if (!isMcpProgressToken(token)) {
      this.warnProgress(
        "ignored malformed progress notification: progressToken must be a string or integer",
      );
      return;
    }
    const state = this.activeProgressByToken.get(progressTokenKey(token));
    if (!state) {
      this.warnProgress(
        `ignored progress notification for inactive token "${String(token)}"`,
      );
      return;
    }
    if (typeof params.progress !== "number" || !Number.isFinite(params.progress)) {
      this.warnProgress(
        `ignored malformed progress notification for token "${String(token)}": progress must be a finite number`,
      );
      return;
    }
    if (
      params.total !== undefined &&
      (typeof params.total !== "number" || !Number.isFinite(params.total))
    ) {
      this.warnProgress(
        `ignored malformed progress notification for token "${String(token)}": total must be a finite number`,
      );
      return;
    }
    if (params.message !== undefined && typeof params.message !== "string") {
      this.warnProgress(
        `ignored malformed progress notification for token "${String(token)}": message must be a string`,
      );
      return;
    }
    if (state.lastProgress !== null && params.progress <= state.lastProgress) {
      this.warnProgress(
        `ignored non-monotonic progress notification for token "${String(token)}"`,
      );
      return;
    }

    state.lastProgress = params.progress;
    state.sequence += 1;
    if (state.sequence > state.maxEvents) {
      state.droppedEvents += 1;
      if (!state.dropWarningEmitted) {
        state.dropWarningEmitted = true;
        this.warnProgress(
          `coalescing progress notifications for token "${String(token)}" after ${state.maxEvents} event(s)`,
        );
      }
      return;
    }

    try {
      state.onProgress({
        requestId: state.requestId,
        progressToken: state.progressToken,
        progress: params.progress,
        sequence: state.sequence,
        ...(params.total !== undefined ? { total: params.total } : {}),
        ...(params.message !== undefined ? { message: params.message } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.warnProgress(`ignored MCP progress callback error: ${message}`);
    }
  }

  protected handleCancelledNotification(params: JsonRpcNotification["params"]): void {
    if (!isJsonObject(params)) return;
    const requestId = params.requestId;
    if (typeof requestId === "number" && Number.isInteger(requestId)) {
      this.clearProgressForRequest(requestId);
      return;
    }
    if (typeof requestId !== "string") return;
    const parsed = Number(requestId);
    if (Number.isInteger(parsed)) {
      this.clearProgressForRequest(parsed);
    }
  }


  protected warnDeprecatedServerCapabilities(result: McpInitializeResult): void {
    if (!result.loggingSupported) return;
    this.warnDeprecatedCapability(
      "logging",
      result.protocolVersion,
      "server logging capability",
    );
  }

  protected warnDeprecatedInputRequiredResult(
    result: McpCallToolResult | McpReadResourceResult | McpGetPromptResult,
  ): void {
    if (result.resultType !== "input_required" || !result.inputRequests) return;
    for (const request of Object.values(result.inputRequests)) {
      if (request.method === "roots/list") {
        this.warnDeprecatedCapability(
          "roots",
          result.protocolVersion,
          "remote roots/list input request",
        );
      } else if (request.method === "sampling/createMessage") {
        this.warnDeprecatedCapability(
          "sampling",
          result.protocolVersion,
          "remote sampling/createMessage input request",
        );
      }
    }
  }

  protected warnDeprecatedCapability(
    feature: DeprecatedMcpFeature,
    protocolVersion: McpProtocolVersion,
    source: string,
  ): void {
    if (this.deprecatedCapabilityWarnings.has(feature)) return;
    this.deprecatedCapabilityWarnings.add(feature);
    console.error(
      `[kota] Warning: MCP server "${this.serverName}" negotiated deprecated MCP ` +
        `capability feature "${feature}" using protocol ${protocolVersion}; ` +
        `${source} is compatibility-only during the SEP-2577 deprecation window.`,
    );
  }

  protected warnProgress(message: string): void {
    if (this.progressWarningCount < MAX_PROGRESS_WARNINGS) {
      console.error(`[kota] Warning: MCP server "${this.serverName}" ${message}`);
    } else if (this.progressWarningCount === MAX_PROGRESS_WARNINGS) {
      console.error(
        `[kota] Warning: MCP server "${this.serverName}" suppressed further progress warnings`,
      );
    }
    this.progressWarningCount += 1;
  }
}
