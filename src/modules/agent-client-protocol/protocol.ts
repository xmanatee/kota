import { isAbsolute } from "node:path";
import { isSensitiveToolInputKey } from "#core/tools/approval-redaction.js";

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
  id: JsonRpcId;
  result?: JsonValue;
  error?: JsonObject;
};

export type JsonRpcMalformedPeerResponse = {
  kind: "malformed_response";
  id: JsonRpcId;
  error: AcpProtocolError;
};

export type JsonRpcIncoming =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcPeerResponse
  | JsonRpcMalformedPeerResponse;

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
    if (method === undefined && hasOwn(value, "id")) {
      return decodePeerResponse(value);
    }
    if (hasOwn(value, "id") && (hasOwn(value, "result") || hasOwn(value, "error"))) {
      return decodePeerResponse(value);
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

function decodePeerResponse(value: JsonObject): Decoded<JsonRpcIncoming> {
  const id = value.id;
  if (!isJsonRpcId(id)) return invalidRequest("response id must be a string, number, or null");
  if (!hasOwn(value, "result") && !hasOwn(value, "error")) {
    return malformedPeerResponse(id, "response must include result or error");
  }
  if (hasOwn(value, "result") && hasOwn(value, "error")) {
    return malformedPeerResponse(id, "response cannot include both result and error");
  }
  const response: JsonRpcPeerResponse = {
    kind: "response",
    id,
  };
  if (hasOwn(value, "result")) response.result = value.result;
  if (hasOwn(value, "error")) {
    const error = value.error;
    if (!isJsonObject(error)) {
      return malformedPeerResponse(id, "response error must be an object");
    }
    response.error = error;
  }
  return {
    ok: true,
    value: response,
  };
}

function malformedPeerResponse(id: JsonRpcId, message: string): Decoded<JsonRpcIncoming> {
  return {
    ok: true,
    value: {
      kind: "malformed_response",
      id,
      error: new AcpProtocolError(
        JSON_RPC_INVALID_REQUEST,
        message,
        { code: "malformed_response" },
      ),
    },
  };
}

export function makeJsonRpcResponse(id: JsonRpcId, result: JsonValue): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

export function makeJsonRpcRequest(
  id: JsonRpcId,
  method: string,
  params: JsonObject,
): JsonObject {
  return { jsonrpc: "2.0", id, method, params };
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
        list: {},
        resume: {},
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
  const obj = objectParams(params, "session/new");
  const cwd = decodeAbsoluteCwd(obj.cwd);
  rejectUnsupportedMcpServers(obj);
  return { cwd };
}

export type ListSessionParams = {
  cwd?: string;
};

export function decodeListSessionParams(params: JsonValue | undefined): ListSessionParams {
  if (params === undefined) return {};
  const obj = objectParams(params, "session/list");
  if (obj.cursor !== undefined) {
    throw unsupportedFeature("session/list.cursor", "ACP session list pagination is not supported by this adapter");
  }
  if (obj.cwd === undefined) return {};
  return { cwd: decodeAbsoluteCwd(obj.cwd) };
}

export type ResumeSessionParams = {
  cwd: string;
  sessionId: string;
};

export function decodeResumeSessionParams(params: JsonValue | undefined): ResumeSessionParams {
  const obj = objectParams(params, "session/resume");
  const cwd = decodeAbsoluteCwd(obj.cwd);
  const sessionId = obj.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw invalidParams("sessionId must be a non-empty string");
  }
  rejectUnsupportedMcpServers(obj);
  return { cwd, sessionId };
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
  const obj = objectParams(params, method);
  const sessionId = obj.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw invalidParams("sessionId must be a non-empty string");
  }
  return { sessionId };
}

function objectParams(params: JsonValue | undefined, method: string): JsonObject {
  if (!isJsonObject(params)) {
    throw invalidParams(`${method} params must be an object`);
  }
  return params;
}

function decodeAbsoluteCwd(value: JsonValue | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams("cwd must be a non-empty string");
  }
  if (!isAbsolute(value)) {
    throw invalidParams("cwd must be an absolute path");
  }
  return value;
}

const ACP_MCP_STDIO_FIELDS = new Set(["type", "name", "command", "args", "env"]);
const ACP_MCP_HTTP_FIELDS = new Set(["type", "name", "url", "headers"]);
const ACP_MCP_SSE_FIELDS = ACP_MCP_HTTP_FIELDS;
const ACP_MCP_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function rejectUnsupportedMcpServers(params: JsonObject): void {
  const mcpServers = params.mcpServers;
  if (!Array.isArray(mcpServers)) {
    throw invalidParams("mcpServers must be an array");
  }
  if (mcpServers.length === 0) return;
  for (const [index, raw] of mcpServers.entries()) {
    rejectUnsupportedMcpServer(raw, index);
  }
}

function rejectUnsupportedMcpServer(
  value: JsonValue,
  index: number,
): void {
  if (!isJsonObject(value)) {
    throw invalidParams(`mcpServers[${index}] must be an object`);
  }
  const type = value.type;
  if (type === undefined || type === "stdio") {
    validateUnsupportedStdioMcpServer(value, index);
    throw unsupportedFeature(
      "mcpServers.stdio",
      "ACP stdio MCP handoff is not supported by this adapter; configure MCP servers in project config",
    );
  }
  if (type === "http") {
    validateUnsupportedHttpMcpServer(value, index);
    throw unsupportedFeature(
      "mcpServers.http",
      "ACP HTTP MCP handoff is not supported by this adapter",
    );
  }
  if (type === "sse") {
    validateUnsupportedSseMcpServer(value, index);
    throw unsupportedFeature(
      "mcpServers.sse",
      "ACP SSE MCP handoff is not supported by this adapter",
    );
  }
  throw invalidParams(`mcpServers[${index}].type must be "stdio", "http", or "sse"`);
}

function validateUnsupportedStdioMcpServer(
  value: JsonObject,
  index: number,
): void {
  rejectUnknownFields(value, ACP_MCP_STDIO_FIELDS, `mcpServers[${index}]`);
  decodeMcpServerName(value.name, `mcpServers[${index}].name`);
  decodeAbsoluteCommand(value.command, `mcpServers[${index}].command`);
  decodeRequiredStringArray(value.args, `mcpServers[${index}].args`);
  decodeOptionalNameValueArray(value.env, `mcpServers[${index}].env`);
}

function validateUnsupportedHttpMcpServer(value: JsonObject, index: number): void {
  rejectUnknownFields(value, ACP_MCP_HTTP_FIELDS, `mcpServers[${index}]`);
  decodeMcpServerName(value.name, `mcpServers[${index}].name`);
  decodeAbsoluteUrl(value.url, `mcpServers[${index}].url`);
  decodeRequiredNameValueArray(value.headers, `mcpServers[${index}].headers`);
}

function validateUnsupportedSseMcpServer(value: JsonObject, index: number): void {
  rejectUnknownFields(value, ACP_MCP_SSE_FIELDS, `mcpServers[${index}]`);
  decodeMcpServerName(value.name, `mcpServers[${index}].name`);
  decodeAbsoluteUrl(value.url, `mcpServers[${index}].url`);
  decodeRequiredNameValueArray(value.headers, `mcpServers[${index}].headers`);
}

function rejectUnknownFields(value: JsonObject, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length === 0) return;
  throw invalidParams(`${label} has unexpected field${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}`);
}

function decodeMcpServerName(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams(`${label} must be a non-empty string`);
  }
  if (!ACP_MCP_NAME_PATTERN.test(value) || value.includes("__")) {
    throw invalidParams(`${label} must contain only letters, numbers, dots, underscores, or hyphens`);
  }
  return value;
}

function decodeAbsoluteCommand(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams(`${label} must be a non-empty string`);
  }
  if (!isAbsolute(value)) {
    throw invalidParams(`${label} must be an absolute path`);
  }
  return value;
}

function decodeRequiredStringArray(value: JsonValue | undefined, label: string): string[] {
  if (!Array.isArray(value)) {
    throw invalidParams(`${label} must be an array of strings`);
  }
  const out: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      throw invalidParams(`${label}[${index}] must be a string`);
    }
    out.push(entry);
  }
  return out;
}

function decodeOptionalNameValueArray(
  value: JsonValue | undefined,
  label: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  return decodeRequiredNameValueArray(value, label);
}

function decodeRequiredNameValueArray(
  value: JsonValue | undefined,
  label: string,
): Record<string, string> {
  if (!Array.isArray(value)) {
    throw invalidParams(`${label} must be an array of name/value objects`);
  }
  const out: Record<string, string> = {};
  for (const [index, entry] of value.entries()) {
    if (!isJsonObject(entry)) {
      throw invalidParams(`${label}[${index}] must be an object`);
    }
    rejectUnknownFields(entry, new Set(["name", "value"]), `${label}[${index}]`);
    const name = entry.name;
    const entryValue = entry.value;
    if (typeof name !== "string" || name.length === 0) {
      throw invalidParams(`${label}[${index}].name must be a non-empty string`);
    }
    if (Object.hasOwn(out, name)) {
      throw invalidParams(`${label}[${index}].name duplicates "${name}"`);
    }
    if (typeof entryValue !== "string") {
      throw invalidParams(`${label}[${index}].value must be a string`);
    }
    out[name] = entryValue;
  }
  return out;
}

function decodeAbsoluteUrl(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams(`${label} must be a non-empty string`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidParams(`${label} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidParams(`${label} must use http or https`);
  }
  return value;
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

export type AcpPermissionToolContext = {
  sessionId: string;
  approvalId: string;
  toolUseId: string;
  toolName: string;
  input: JsonObject;
  risk: string;
  reason: string;
  timeoutMs: number;
};

export type AcpPermissionDecision =
  | { outcome: "allow" }
  | { outcome: "deny"; message: string }
  | { outcome: "cancelled"; message: string };

export function permissionRequestParams(request: AcpPermissionToolContext): JsonObject {
  return {
    sessionId: request.sessionId,
    toolCall: {
      toolCallId: request.toolUseId,
      title: requestTitle(request),
      kind: toolKind(request.toolName),
      status: "pending",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: `${request.risk}: ${request.reason}`,
          },
        },
      ],
      rawInput: redactPermissionInput(request.input),
    },
    options: [
      {
        optionId: "allow-once",
        name: "Allow once",
        kind: "allow_once",
      },
      {
        optionId: "reject-once",
        name: "Reject",
        kind: "reject_once",
      },
    ],
  };
}

export function decodePermissionResponse(result: JsonValue | undefined): AcpPermissionDecision {
  const obj = objectParams(result, "session/request_permission response");
  rejectUnknownFields(obj, new Set(["outcome"]), "session/request_permission response");
  const outcome = obj.outcome;
  if (!isJsonObject(outcome)) {
    throw invalidParams("session/request_permission response outcome must be an object");
  }
  const outcomeKind = outcome.outcome;
  if (outcomeKind === "cancelled") {
    rejectUnknownFields(outcome, new Set(["outcome"]), "session/request_permission response outcome");
    return {
      outcome: "cancelled",
      message: "ACP client cancelled the permission request",
    };
  }
  if (outcomeKind === "selected") {
    rejectUnknownFields(outcome, new Set(["outcome", "optionId"]), "session/request_permission response outcome");
    if (outcome.optionId === "allow-once") return { outcome: "allow" };
    if (outcome.optionId === "reject-once") {
      return {
        outcome: "deny",
        message: "ACP client rejected the tool call",
      };
    }
    throw invalidParams("session/request_permission selected outcome has an unsupported optionId");
  }
  throw invalidParams('session/request_permission outcome must be "selected" or "cancelled"');
}

function requestTitle(request: AcpPermissionToolContext): string {
  return `Allow ${request.toolName}`;
}

function toolKind(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (/(?:bash|shell|exec|process|terminal|command)/.test(normalized)) return "execute";
  if (/(?:delete|remove|unlink)/.test(normalized)) return "delete";
  if (/(?:move|rename)/.test(normalized)) return "move";
  if (/(?:edit|write|patch|replace|create|save)/.test(normalized)) return "edit";
  if (/(?:search|grep|glob|find|list)/.test(normalized)) return "search";
  if (/(?:fetch|http|web)/.test(normalized)) return "fetch";
  if (/(?:read|cat|open)/.test(normalized)) return "read";
  return "other";
}

function redactPermissionInput(input: JsonObject): JsonObject {
  return redactPermissionValue(input) as JsonObject;
}

function redactPermissionValue(value: JsonValue | undefined, key = ""): JsonValue {
  if (isSensitiveToolInputKey(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redactPermissionValue(entry));
  if (!isJsonObject(value)) return value ?? null;
  const out: JsonObject = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = redactPermissionValue(childValue, childKey);
  }
  return out;
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

export function sessionAlreadyLive(sessionId: string): AcpProtocolError {
  return new AcpProtocolError(
    ACP_UNSUPPORTED,
    "Session is already active on this ACP connection",
    { code: "session_already_live", sessionId },
  );
}
