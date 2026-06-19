import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import { McpClientAuthorizationRuntime } from "./client-authorization-runtime.js";
import {
  formatJsonRpcId,
  generatedProgressToken,
  isJsonRpcId,
} from "./client-decode-utils.js";
import type {
  JsonRpcIncomingMessage,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcResult,
  McpRequestProgressOptions,
} from "./client-protocol.js";
import {
  CONNECT_TIMEOUT,
  MCP_CURRENT_PROTOCOL_VERSION,
} from "./client-protocol.js";
import {
  assertMcpResponseContentLength,
  assertMcpTextWithinByteLimit,
  formatMcpBytes,
  MCP_HTTP_RESPONSE_BODY_MAX_BYTES,
  MCP_HTTP_SSE_MESSAGE_MAX_BYTES,
  MCP_HTTP_SSE_RESPONSE_BODY_MAX_BYTES,
  McpResponseBodyLimitError,
  mcpUtf8ByteLength,
  readMcpResponseTextWithLimit,
} from "./client-response-body-limit.js";

export abstract class McpClientHttpRuntime extends McpClientAuthorizationRuntime {
  protected async httpRequest(
    method: string,
    params?: JsonRpcParams,
    timeout = CONNECT_TIMEOUT,
    progress?: McpRequestProgressOptions,
  ): Promise<JsonRpcResult> {
    if (this.closing) {
      throw new Error(`MCP server "${this.serverName}" is closed`);
    }
    if (method !== "server/discover" && !this.connected) {
      throw new Error(`MCP server "${this.serverName}" is not connected`);
    }
    if (this.transport.type !== "http") {
      throw new Error(`MCP server "${this.serverName}" is not an HTTP transport`);
    }
    const transport = this.transport;
    let latestRequestId: number | null = null;

    const send = async (
      skipRefresh: boolean,
    ): Promise<{
      response: Response;
      id: number;
      complete: () => void;
      timedOut: () => boolean;
    }> => {
      if (!skipRefresh) {
        await this.refreshExpiredOAuthTokenIfNeeded();
      }
      const id = this.nextId++;
      latestRequestId = id;
      const progressToken = progress ? progress.token ?? generatedProgressToken(id) : undefined;
      const requestParams = this.paramsWithProtocolMetadata(params, progressToken);
      const msg: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        ...(requestParams && { params: requestParams }),
      };
      if (progress && progressToken !== undefined) {
        try {
          this.trackProgressRequest(id, progressToken, progress);
        } catch (err) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);
      try {
        const response = await fetch(transport.url, {
          method: "POST",
          headers: this.httpHeadersForRequest(method, requestParams),
          body: JSON.stringify(msg),
          signal: controller.signal,
        });
        return {
          id,
          response,
          complete: () => clearTimeout(timer),
          timedOut: () => timedOut,
        };
      } catch (err) {
        clearTimeout(timer);
        const message = err instanceof Error && err.name === "AbortError"
          ? `request timed out after ${timeout}ms`
          : err instanceof Error ? err.message : String(err);
        throw this.requestErrorForMethod(method, message);
      }
    };

    try {
      let sent = await send(false);
      try {
        const authorizationError = await this.authorizationErrorForHttpResponse(
          sent.response,
          method,
        );
        if (authorizationError && await this.authorizeForHttpChallenge(authorizationError)) {
          sent.complete();
          this.clearProgressForRequest(sent.id);
          sent = await send(true);
        } else if (authorizationError) {
          throw authorizationError;
        }
        return await this.decodeHttpResponse(sent.response, method, sent.id);
      } catch (err) {
        if (sent.timedOut() || (err instanceof Error && err.name === "AbortError")) {
          throw this.requestErrorForMethod(method, `request timed out after ${timeout}ms`);
        }
        throw err;
      } finally {
        sent.complete();
      }
    } finally {
      if (latestRequestId !== null) {
        this.clearProgressForRequest(latestRequestId);
      }
    }
  }

  protected httpHeadersForRequest(
    method: string,
    params: JsonRpcParams,
  ): Headers {
    if (this.transport.type !== "http") {
      throw new Error(`MCP server "${this.serverName}" is not an HTTP transport`);
    }
    const headers = new Headers(this.transport.headers ?? {});
    const token = this.oauthTokenBinding?.token.accessToken;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json, text/event-stream");
    headers.set("Content-Type", "application/json");
    headers.set("MCP-Protocol-Version", this.protocolVersion ?? MCP_CURRENT_PROTOCOL_VERSION);
    headers.set("Mcp-Method", method);
    const name = this.httpMcpNameForRequest(method, params);
    if (name !== null) headers.set("Mcp-Name", name);
    this.setHttpParamHeaders(headers, method, params);
    return headers;
  }

  protected async decodeHttpResponse(
    response: Response,
    method: string,
    requestId: number,
  ): Promise<JsonRpcResult> {
    const authorizationError = await this.authorizationErrorForHttpResponse(response, method);
    if (authorizationError) throw authorizationError;

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
      const text = !response.ok
        ? await this.readMcpHttpResponseText(response, method, "MCP HTTP error response")
        : "";
      if (!response.ok) {
        throw this.requestErrorForMethod(
          method,
          `HTTP ${response.status}: ${text || response.statusText || "empty response"}`,
        );
      }
      throw this.requestErrorForMethod(
        method,
        `unsupported response content-type "${contentType || "(missing)"}"`,
      );
    }
    let responseText: string | null = null;
    const message = contentType.includes("text/event-stream")
      ? await this.decodeHttpSseResponse(response, method, requestId)
      : this.parseJsonRpcHttpMessage(
          (responseText = await this.readMcpHttpResponseText(
            response,
            method,
            "MCP HTTP JSON response",
          )),
          method,
        );
    if (this.isServerRequestMessage(message)) {
      throw this.unsupportedHttpServerRequestError(method, message, "HTTP response");
    }
    if (message.id !== undefined && !isJsonRpcId(message.id)) {
      throw this.requestErrorForMethod(
        method,
        "response id must be a string or integer",
      );
    }
    if (message.id !== undefined && message.id !== requestId) {
      throw this.requestErrorForMethod(
        method,
        `response id ${formatJsonRpcId(message.id)} did not match request id ${requestId}`,
      );
    }
    if (message.error) {
      throw this.requestErrorForMethod(
        method,
        `HTTP ${response.status}: MCP error ${message.error.code}: ${message.error.message}`,
      );
    }
    if (!response.ok) {
      throw this.requestErrorForMethod(
        method,
        `HTTP ${response.status}: ${responseText || response.statusText || "empty response"}`,
      );
    }
    return message.result;
  }

  protected async decodeHttpSseResponse(
    response: Response,
    method: string,
    requestId: number,
  ): Promise<JsonRpcIncomingMessage> {
    this.assertMcpHttpResponseContentLength(
      response,
      method,
      "MCP HTTP SSE response",
      MCP_HTTP_SSE_RESPONSE_BODY_MAX_BYTES,
    );
    let finalMessage: JsonRpcIncomingMessage | null = null;
    await this.consumeSseJsonRpcMessageStream(response, method, (message) => {
      if (this.isServerRequestMessage(message)) {
        throw this.unsupportedHttpServerRequestError(method, message, "HTTP SSE response stream");
      }
      if (message.id !== undefined && !isJsonRpcId(message.id)) {
        throw this.requestErrorForMethod(
          method,
          "SSE response stream included a JSON-RPC message with invalid id: id must be a string or integer",
        );
      }
      if (typeof message.method === "string") {
        this.handleNotification(message);
        return;
      }
      if (typeof message.id !== "number") {
        throw this.requestErrorForMethod(
          method,
          "SSE response stream included a JSON-RPC message without method or numeric id",
        );
      }
      if (message.id !== requestId) {
        throw this.requestErrorForMethod(
          method,
          `response id ${formatJsonRpcId(message.id)} did not match request id ${requestId}`,
        );
      }
      if (finalMessage !== null) {
        throw this.requestErrorForMethod(
          method,
          `SSE response stream included multiple final JSON-RPC responses for request id ${requestId}`,
        );
      }
      finalMessage = message;
      return true;
    });
    if (finalMessage === null) {
      throw this.requestErrorForMethod(
        method,
        `SSE response stream ended without a final JSON-RPC response for request id ${requestId}`,
      );
    }
    return finalMessage;
  }

  protected async readMcpHttpResponseText(
    response: Response,
    method: string,
    label: string,
    maxBytes = MCP_HTTP_RESPONSE_BODY_MAX_BYTES,
  ): Promise<string> {
    try {
      return await readMcpResponseTextWithLimit(response, maxBytes, label);
    } catch (err) {
      if (err instanceof McpResponseBodyLimitError) {
        throw this.requestErrorForMethod(method, err.message);
      }
      throw err;
    }
  }

  protected assertMcpHttpResponseContentLength(
    response: Response,
    method: string,
    label: string,
    maxBytes: number,
  ): void {
    try {
      assertMcpResponseContentLength(response, maxBytes, label);
    } catch (err) {
      if (err instanceof McpResponseBodyLimitError) {
        throw this.requestErrorForMethod(method, err.message);
      }
      throw err;
    }
  }


  protected parseJsonRpcHttpMessage(text: string, method: string): JsonRpcIncomingMessage {
    try {
      const parsed = JSON.parse(text) as JsonRpcIncomingMessage;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("response body must be a JSON-RPC object");
      }
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw this.requestErrorForMethod(method, `malformed JSON response: ${message}`);
    }
  }

  protected parseSseJsonRpcResponse(
    text: string,
    method: string,
    requestId: number,
  ): JsonRpcIncomingMessage {
    const messages = this.parseSseDataMessages(text);
    let finalMessage: JsonRpcIncomingMessage | null = null;
    for (const data of messages) {
      const message = this.parseJsonRpcHttpMessage(data, method);
      if (this.isServerRequestMessage(message)) {
        throw this.unsupportedHttpServerRequestError(method, message, "HTTP SSE response stream");
      }
      if (message.id !== undefined && !isJsonRpcId(message.id)) {
        throw this.requestErrorForMethod(
          method,
          "SSE response stream included a JSON-RPC message with invalid id: id must be a string or integer",
        );
      }
      if (typeof message.method === "string") {
        this.handleNotification(message);
        continue;
      }
      if (typeof message.id !== "number") {
        throw this.requestErrorForMethod(
          method,
          "SSE response stream included a JSON-RPC message without method or numeric id",
        );
      }
      if (message.id !== requestId) {
        throw this.requestErrorForMethod(
          method,
          `response id ${formatJsonRpcId(message.id)} did not match request id ${requestId}`,
        );
      }
      if (finalMessage !== null) {
        throw this.requestErrorForMethod(
          method,
          `SSE response stream included multiple final JSON-RPC responses for request id ${requestId}`,
        );
      }
      finalMessage = message;
    }
    if (finalMessage === null) {
      throw this.requestErrorForMethod(
        method,
        `SSE response stream ended without a final JSON-RPC response for request id ${requestId}`,
      );
    }
    return finalMessage;
  }

  protected parseSseDataMessages(text: string): string[] {
    const messages: string[] = [];
    let dataLines: string[] = [];
    let dataBytes = 0;
    const flush = () => {
      if (dataLines.length === 0) return;
      messages.push(dataLines.join("\n"));
      dataLines = [];
      dataBytes = 0;
    };
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) {
        flush();
        continue;
      }
      if (line.startsWith("data:")) {
        const data = line.slice(5).trimStart();
        const nextDataBytes =
          dataBytes + (dataLines.length === 0 ? 0 : 1) + mcpUtf8ByteLength(data);
        if (nextDataBytes > MCP_HTTP_SSE_MESSAGE_MAX_BYTES) {
          throw new McpResponseBodyLimitError(
            `MCP HTTP SSE event data exceeded ${formatMcpBytes(MCP_HTTP_SSE_MESSAGE_MAX_BYTES)}.`,
          );
        }
        dataLines.push(data);
        dataBytes = nextDataBytes;
      }
    }
    flush();
    return messages;
  }


  protected openHttpListChangedSubscription(): void {
    if (this.transport.type !== "http" || this.httpListSubscriptionAbort !== null) return;
    const id = this.nextId++;
    this.toolListSubscriptionId = id;
    const notifications = {
      ...(this.toolsListChanged ? { toolsListChanged: true } : {}),
      ...(this.resourcesListChanged ? { resourcesListChanged: true } : {}),
      ...(this.promptsListChanged ? { promptsListChanged: true } : {}),
    };
    const params: JsonRpcParams = {
      _meta: this.protocolRequestMeta(),
      notifications,
    };
    const msg: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "subscriptions/listen",
      params,
    };
    const controller = new AbortController();
    this.httpListSubscriptionAbort = controller;
    void this.runHttpListChangedSubscription(id, msg, params, controller).catch((err) => {
      if (this.closing || controller.signal.aborted) return;
      this.httpListSubscriptionAbort = null;
      this.toolListSubscriptionId = null;
      const message = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(
        `[kota] Warning: MCP server "${this.serverName}" failed to open subscription: ${message}`,
        "warn",
      );
    });
  }

  protected async runHttpListChangedSubscription(
    id: number,
    msg: JsonRpcRequest,
    params: JsonRpcParams,
    controller: AbortController,
  ): Promise<void> {
    if (this.transport.type !== "http") return;
    await this.refreshExpiredOAuthTokenIfNeeded();
    let response: Response;
    try {
      response = await fetch(this.transport.url, {
        method: "POST",
        headers: this.httpHeadersForRequest("subscriptions/listen", params),
        body: JSON.stringify(msg),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      throw err instanceof Error ? err : new Error(String(err));
    }
    const authorizationError = await this.authorizationErrorForHttpResponse(
      response,
      "subscriptions/listen",
    );
    if (authorizationError) throw authorizationError;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/event-stream")) {
      throw this.requestErrorForMethod(
        "subscriptions/listen",
        `unsupported response content-type "${contentType || "(missing)"}"`,
      );
    }
    if (!response.ok) {
      const text = await this.readMcpHttpResponseText(
        response,
        "subscriptions/listen",
        "MCP HTTP subscription error response",
      );
      throw this.requestErrorForMethod(
        "subscriptions/listen",
        `HTTP ${response.status}: ${text || response.statusText || "empty response"}`,
      );
    }
    this.assertMcpHttpResponseContentLength(
      response,
      "subscriptions/listen",
      "MCP HTTP subscription SSE response",
      MCP_HTTP_SSE_RESPONSE_BODY_MAX_BYTES,
    );
    await this.consumeSseJsonRpcMessageStream(
      response,
      "subscriptions/listen",
      (message) => {
        if (this.isServerRequestMessage(message)) {
          throw this.unsupportedHttpServerRequestError(
            "subscriptions/listen",
            message,
            "HTTP SSE response stream",
          );
        }
        if (message.id !== undefined && !isJsonRpcId(message.id)) {
          throw this.requestErrorForMethod(
            "subscriptions/listen",
            "SSE response stream included a JSON-RPC message with invalid id: id must be a string or integer",
          );
        }
        if (typeof message.id === "number" && message.id === id) {
          this.handleStreamingRequestResponse(message);
          return;
        }
        if (typeof message.method === "string") {
          this.handleNotification(message);
        }
      },
      { ignoreAbort: true, maxTotalBytes: null },
    );
    if (this.httpListSubscriptionAbort === controller) {
      this.httpListSubscriptionAbort = null;
      this.toolListSubscriptionId = null;
    }
  }

  protected unsupportedHttpServerRequestError(
    requestMethod: string,
    message: JsonRpcIncomingMessage & { id: NonNullable<JsonRpcIncomingMessage["id"]>; method: string },
    path: string,
  ): Error {
    return this.requestErrorForMethod(
      requestMethod,
      `server-to-client request "${message.method}" with id ${formatJsonRpcId(message.id)} arrived on ${path}; ${path} cannot send JSON-RPC responses`,
    );
  }

  protected async consumeSseJsonRpcMessageStream(
    response: Response,
    method: string,
    onMessage: (message: JsonRpcIncomingMessage) => boolean | void,
    options: { ignoreAbort?: boolean; maxTotalBytes?: number | null } = {},
  ): Promise<void> {
    if (!response.body) {
      try {
        const text = await this.readMcpHttpResponseText(
          response,
          method,
          "MCP HTTP SSE response",
          MCP_HTTP_SSE_RESPONSE_BODY_MAX_BYTES,
        );
        for (const data of this.parseSseDataMessages(text)) {
          if (onMessage(this.parseJsonRpcHttpMessage(data, method)) === true) return;
        }
      } catch (err) {
        if (err instanceof McpResponseBodyLimitError) {
          throw this.requestErrorForMethod(method, err.message);
        }
        throw err;
      }
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const maxTotalBytes = options.maxTotalBytes === undefined
      ? MCP_HTTP_SSE_RESPONSE_BODY_MAX_BYTES
      : options.maxTotalBytes;
    let buffer = "";
    let dataLines: string[] = [];
    let totalBytes = 0;
    let dataBytes = 0;
    let shouldStop = false;
    const flush = () => {
      if (dataLines.length === 0) return;
      shouldStop =
        onMessage(this.parseJsonRpcHttpMessage(dataLines.join("\n"), method)) === true;
      dataLines = [];
      dataBytes = 0;
    };
    const appendDataLine = (data: string) => {
      const nextDataBytes =
        dataBytes + (dataLines.length === 0 ? 0 : 1) + mcpUtf8ByteLength(data);
      if (nextDataBytes > MCP_HTTP_SSE_MESSAGE_MAX_BYTES) {
        throw new McpResponseBodyLimitError(
          `MCP HTTP SSE event data exceeded ${formatMcpBytes(MCP_HTTP_SSE_MESSAGE_MAX_BYTES)}.`,
        );
      }
      dataLines.push(data);
      dataBytes = nextDataBytes;
    };
    const consumeLine = (line: string) => {
      if (line.length === 0) {
        flush();
        return;
      }
      if (line.startsWith("data:")) {
        appendDataLine(line.slice(5).trimStart());
      }
    };
    try {
      while (true) {
        if (shouldStop) break;
        const { done, value } = await reader.read();
        if (done) break;
        const nextTotalBytes = totalBytes + value.byteLength;
        if (maxTotalBytes !== null && nextTotalBytes > maxTotalBytes) {
          await reader.cancel().catch(() => undefined);
          throw new McpResponseBodyLimitError(
            `MCP HTTP SSE response exceeded ${formatMcpBytes(maxTotalBytes)} while streaming response.`,
          );
        }
        totalBytes = nextTotalBytes;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.search(/\r?\n/);
        while (newlineIndex !== -1 && !shouldStop) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          const newlineLength = buffer[newlineIndex] === "\r" && buffer[newlineIndex + 1] === "\n" ? 2 : 1;
          buffer = buffer.slice(newlineIndex + newlineLength);
          consumeLine(line);
          newlineIndex = buffer.search(/\r?\n/);
        }
        if (!shouldStop) {
          assertMcpTextWithinByteLimit(
            buffer,
            MCP_HTTP_SSE_MESSAGE_MAX_BYTES,
            "MCP HTTP SSE line buffer",
          );
        }
      }
      if (shouldStop) {
        await reader.cancel();
      } else {
        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.length > 0) {
          assertMcpTextWithinByteLimit(
            buffer,
            MCP_HTTP_SSE_MESSAGE_MAX_BYTES,
            "MCP HTTP SSE line buffer",
          );
          consumeLine(buffer);
        }
        flush();
      }
    } catch (err) {
      if (options.ignoreAbort && err instanceof Error && err.name === "AbortError") return;
      if (err instanceof McpResponseBodyLimitError) {
        await reader.cancel().catch(() => undefined);
        throw this.requestErrorForMethod(method, err.message);
      }
      throw err;
    } finally {
      reader.releaseLock();
    }
  }

}
