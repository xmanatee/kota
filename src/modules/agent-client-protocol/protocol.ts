import { isAbsolute } from "node:path";

export const ACP_PROTOCOL_VERSION = 1;
export const ACP_AGENT_NAME = "kota";
export const ACP_AGENT_TITLE = "KOTA";
export const ACP_AGENT_VERSION = "0.1.0";

export type JsonScalar = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };
export type JsonValue = JsonScalar | JsonArray | JsonObject;
export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  kind: "request";
  id: JsonRpcId;
  method: string;
  params?: JsonValue;
};

export type JsonRpcNotification = {
  kind: "notification";
  method: string;
  params?: JsonValue;
};

export type JsonRpcPeerResponse = {
  kind: "response";
};

export type JsonRpcIncoming =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcPeerResponse;

export type Decoded<T> =
  | { ok: true; value: T }
  | { ok: false; error: AcpProtocolError };

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const ACP_RESOURCE_NOT_FOUND = -32002;
export const ACP_UNSUPPORTED = -32099;

export class AcpProtocolError extends Error {
  readonly rpcCode: number;
  readonly data: JsonObject;

  constructor(rpcCode: number, message: string, data: JsonObject = {}) {
    super(message);
    this.name = "AcpProtocolError";
    this.rpcCode = rpcCode;
    this.data = data;
  }
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonLine(line: string): Decoded<JsonValue> {
  try {
    return { ok: true, value: JSON.parse(line) as JsonValue };
  } catch {
    return {
      ok: false,
      error: new AcpProtocolError(
        JSON_RPC_PARSE_ERROR,
        "Parse error",
        { code: "parse_error" },
      ),
    };
  }
}

function isJsonRpcId(value: JsonValue | undefined): value is JsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number";
}

function hasOwn(obj: JsonObject, key: string): boolean {
  return Object.hasOwn(obj, key);
}

export function decodeJsonRpcIncoming(value: JsonValue): Decoded<JsonRpcIncoming> {
  if (!isJsonObject(value)) {
    return invalidRequest("JSON-RPC message must be an object");
  }
  if (value.jsonrpc !== "2.0") {
    return invalidRequest('jsonrpc must be "2.0"');
  }
  const method = value.method;
  if (typeof method !== "string") {
    if (hasOwn(value, "id") && (hasOwn(value, "result") || hasOwn(value, "error"))) {
      return { ok: true, value: { kind: "response" } };
    }
    return invalidRequest("method must be a string");
  }
  const idValue = value.id;
  if (!hasOwn(value, "id")) {
    return {
      ok: true,
      value: { kind: "notification", method, params: value.params },
    };
  }
  if (!isJsonRpcId(idValue)) {
    return invalidRequest("id must be a string, number, or null");
  }
  return {
    ok: true,
    value: { kind: "request", id: idValue, method, params: value.params },
  };
}

function invalidRequest(message: string): Decoded<JsonRpcIncoming> {
  return {
    ok: false,
    error: new AcpProtocolError(
      JSON_RPC_INVALID_REQUEST,
      message,
      { code: "invalid_request" },
    ),
  };
}

export function makeJsonRpcResponse(id: JsonRpcId, result: JsonValue): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

export function makeJsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data: JsonObject = {},
): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  };
}

export function makeJsonRpcNotification(
  method: string,
  params: JsonObject,
): JsonObject {
  return { jsonrpc: "2.0", method, params };
}

export function initializeResponse(): JsonObject {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: {
        image: false,
        audio: false,
        embeddedContext: false,
      },
      mcpCapabilities: {
        http: false,
        sse: false,
      },
      sessionCapabilities: {
        close: {},
      },
    },
    agentInfo: {
      name: ACP_AGENT_NAME,
      title: ACP_AGENT_TITLE,
      version: ACP_AGENT_VERSION,
    },
    authMethods: [],
  };
}

export type InitializeParams = {
  protocolVersion: number;
};

export function decodeInitializeParams(params: JsonValue | undefined): InitializeParams {
  if (!isJsonObject(params)) {
    throw invalidParams("initialize params must be an object");
  }
  const version = params.protocolVersion;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw invalidParams("protocolVersion must be a positive integer");
  }
  return { protocolVersion: version };
}

export type NewSessionParams = {
  cwd: string;
};

export function decodeNewSessionParams(params: JsonValue | undefined): NewSessionParams {
  if (!isJsonObject(params)) {
    throw invalidParams("session/new params must be an object");
  }
  const cwd = params.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw invalidParams("cwd must be a non-empty string");
  }
  if (!isAbsolute(cwd)) {
    throw invalidParams("cwd must be an absolute path");
  }
  const mcpServers = params.mcpServers;
  if (!Array.isArray(mcpServers)) {
    throw invalidParams("mcpServers must be an array");
  }
  if (mcpServers.length > 0) {
    throw unsupportedFeature("mcpServers", "Client-supplied MCP handoff is not supported by this adapter");
  }
  return { cwd };
}

export type PromptParams = {
  sessionId: string;
  text: string;
};

export function decodePromptParams(params: JsonValue | undefined): PromptParams {
  if (!isJsonObject(params)) {
    throw invalidParams("session/prompt params must be an object");
  }
  const sessionId = params.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw invalidParams("sessionId must be a non-empty string");
  }
  const prompt = params.prompt;
  if (!Array.isArray(prompt)) {
    throw invalidParams("prompt must be an array of content blocks");
  }
  const parts = prompt.map(contentBlockToPromptText);
  const text = parts.join("\n\n").trim();
  if (text.length === 0) {
    throw invalidParams("prompt must contain at least one text or resource_link block");
  }
  return { sessionId, text };
}

export type SessionIdParams = {
  sessionId: string;
};

export function decodeSessionIdParams(params: JsonValue | undefined, method: string): SessionIdParams {
  if (!isJsonObject(params)) {
    throw invalidParams(`${method} params must be an object`);
  }
  const sessionId = params.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw invalidParams("sessionId must be a non-empty string");
  }
  return { sessionId };
}

function contentBlockToPromptText(block: JsonValue): string {
  if (!isJsonObject(block)) {
    throw invalidParams("content block must be an object");
  }
  const type = block.type;
  if (type === "text") {
    const text = block.text;
    if (typeof text !== "string") {
      throw invalidParams("text content block requires string text");
    }
    return text;
  }
  if (type === "resource_link") {
    const uri = block.uri;
    const name = block.name;
    if (typeof uri !== "string" || typeof name !== "string") {
      throw invalidParams("resource_link content block requires string uri and name");
    }
    const title = typeof block.title === "string" ? block.title : name;
    const description = typeof block.description === "string" ? `\n${block.description}` : "";
    return `Resource link: ${title}\n${uri}${description}`;
  }
  const label = typeof type === "string" ? type : "unknown";
  throw unsupportedFeature(
    `prompt.${label}`,
    `Prompt content block type "${label}" is not supported`,
  );
}

export function agentMessageUpdate(sessionId: string, text: string): JsonObject {
  return sessionUpdate(sessionId, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });
}

export function agentThoughtUpdate(sessionId: string, text: string): JsonObject {
  return sessionUpdate(sessionId, {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text },
  });
}

export function sessionUpdate(sessionId: string, update: JsonObject): JsonObject {
  return makeJsonRpcNotification("session/update", {
    sessionId,
    update,
  });
}

export function invalidParams(message: string): AcpProtocolError {
  return new AcpProtocolError(
    JSON_RPC_INVALID_PARAMS,
    message,
    { code: "invalid_params" },
  );
}

export function methodNotFound(method: string): AcpProtocolError {
  return new AcpProtocolError(
    JSON_RPC_METHOD_NOT_FOUND,
    `Unsupported ACP method: ${method}`,
    { code: "unsupported_method", method },
  );
}

export function unsupportedFeature(feature: string, message: string): AcpProtocolError {
  return new AcpProtocolError(
    ACP_UNSUPPORTED,
    message,
    { code: "unsupported_feature", feature },
  );
}

export function notInitialized(): AcpProtocolError {
  return new AcpProtocolError(
    ACP_UNSUPPORTED,
    "ACP connection is not initialized for protocol version 1",
    { code: "not_initialized" },
  );
}

export function daemonUnavailable(): AcpProtocolError {
  return new AcpProtocolError(
    JSON_RPC_INTERNAL_ERROR,
    "KOTA daemon is not reachable",
    { code: "daemon_unavailable" },
  );
}

export function sessionNotFound(sessionId: string): AcpProtocolError {
  return new AcpProtocolError(
    ACP_RESOURCE_NOT_FOUND,
    "Session not found",
    { code: "session_not_found", sessionId },
  );
}

export function sessionBusy(sessionId: string): AcpProtocolError {
  return new AcpProtocolError(
    ACP_UNSUPPORTED,
    "Session is already processing a prompt",
    { code: "session_busy", sessionId },
  );
}
