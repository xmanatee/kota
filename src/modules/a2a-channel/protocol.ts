export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };
export type JsonRpcId = string | number | null;

export const A2A_PROTOCOL_VERSION = "1.0";
export const A2A_LEGACY_PROTOCOL_VERSION = "0.3";
export const A2A_SUPPORTED_PROTOCOL_VERSIONS = [A2A_PROTOCOL_VERSION] as const;
export const A2A_RPC_PATH = "/api/a2a/rpc";
export const A2A_EXTENDED_CARD_PATH = "/api/a2a/agent-card.json";
export const A2A_WELL_KNOWN_CARD_PATH = "/.well-known/agent-card.json";
export const A2A_TEXT_MEDIA_TYPE = "text/plain";

export type A2ATaskState =
  | "TASK_STATE_UNSPECIFIED"
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_AUTH_REQUIRED";

export type A2ATextPart = JsonObject & {
  text: string;
  mediaType: "text/plain";
};

export type A2AMessage = JsonObject & {
  role: "ROLE_USER" | "ROLE_AGENT";
  messageId: string;
  parts: A2ATextPart[];
  taskId?: string;
  contextId?: string;
};

export type A2AArtifact = JsonObject & {
  artifactId: string;
  name: string;
  parts: A2ATextPart[];
};

export type A2ATask = JsonObject & {
  id: string;
  contextId: string;
  status: {
    state: A2ATaskState;
    timestamp: string;
    message: A2AMessage;
  };
  artifacts: A2AArtifact[];
  history: A2AMessage[];
  metadata: JsonObject;
};

export type A2ATaskListResponse = JsonObject & {
  tasks: A2ATask[];
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
};

export type A2ATaskStatusUpdateEvent = JsonObject & {
  taskId: string;
  contextId: string;
  status: A2ATask["status"];
  metadata?: JsonObject;
};

export type A2ATaskArtifactUpdateEvent = JsonObject & {
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: JsonObject;
};

export type A2AStreamResponse =
  | (JsonObject & { task: A2ATask })
  | (JsonObject & { message: A2AMessage })
  | (JsonObject & { statusUpdate: A2ATaskStatusUpdateEvent })
  | (JsonObject & { artifactUpdate: A2ATaskArtifactUpdateEvent });

export type A2ASendMessageResponse =
  | (JsonObject & { task: A2ATask })
  | (JsonObject & { message: A2AMessage });

export type A2ATaskUpdate = A2AStreamResponse;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params: JsonObject;
};

export type JsonRpcResponse =
  | (JsonObject & { jsonrpc: "2.0"; id: JsonRpcId; result: JsonValue })
  | (JsonObject & {
      jsonrpc: "2.0";
      id: JsonRpcId;
      error: {
        code: number;
        message: string;
        data: JsonObject[];
      };
    });

type RoutingScopeInput = {
  params: JsonObject;
  message?: JsonObject;
};

export type SendMessageInput = {
  taskId: string | null;
  contextId: string | null;
  projectId: string | null;
  text: string;
};

export type TaskSelector = {
  taskId: string;
  projectId: string | null;
  contextId: string | null;
};

export type TaskListFilter = {
  projectId: string | null;
  contextId: string | null;
};

export class A2AProtocolError extends Error {
  readonly rpcCode: number;
  readonly data: JsonObject[];

  constructor(rpcCode: number, message: string, data: JsonObject[]) {
    super(message);
    this.name = "A2AProtocolError";
    this.rpcCode = rpcCode;
    this.data = data;
  }
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(obj: JsonObject, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function booleanField(obj: JsonObject, key: string): boolean | null {
  const value = obj[key];
  return typeof value === "boolean" ? value : null;
}

export function objectField(obj: JsonObject, key: string): JsonObject | null {
  const value = obj[key];
  return isJsonObject(value) ? value : null;
}

export function arrayField(obj: JsonObject, key: string): JsonValue[] | null {
  const value = obj[key];
  return Array.isArray(value) ? value : null;
}

export function decodeJsonRpcRequest(value: JsonValue): JsonRpcRequest {
  if (!isJsonObject(value)) {
    throw invalidRequest("JSON-RPC request body must be an object");
  }
  if (value.jsonrpc !== "2.0") {
    throw invalidRequest("jsonrpc must be \"2.0\"");
  }
  const method = stringField(value, "method");
  if (!method) {
    throw invalidRequest("method must be a non-empty string");
  }
  const idValue = value.id;
  if (
    idValue !== null &&
    typeof idValue !== "string" &&
    typeof idValue !== "number"
  ) {
    throw invalidRequest("id must be a string, number, or null");
  }
  const paramsValue = value.params;
  if (paramsValue !== undefined && !isJsonObject(paramsValue)) {
    throw invalidParams("params must be an object");
  }
  return {
    jsonrpc: "2.0",
    id: idValue ?? null,
    method,
    params: paramsValue ?? {},
  };
}

export function decodeSendMessageParams(params: JsonObject): SendMessageInput {
  assertSupportedSendConfiguration(params);
  const message = objectField(params, "message");
  if (!message) {
    throw invalidParams("message must be an object");
  }
  if (message.role !== "ROLE_USER") {
    throw invalidParams("message.role must be ROLE_USER");
  }
  const parts = arrayField(message, "parts");
  const text = parts ? decodeTextParts(parts) : null;
  if (!text) {
    throw invalidParams("message.parts must include at least one text part");
  }
  const taskId =
    stringField(message, "taskId") ??
    stringField(params, "id");
  const contextId =
    stringField(params, "contextId") ??
    stringField(message, "contextId");
  const projectId = decodeRoutingProjectId({ params, message });
  return {
    taskId,
    contextId,
    projectId,
    text,
  };
}

export function decodeTaskSelector(params: JsonObject): TaskSelector {
  const taskId = stringField(params, "id");
  if (!taskId) throw invalidParams("id must be a non-empty string");
  return {
    taskId,
    projectId: decodeRoutingProjectId({ params }),
    contextId: stringField(params, "contextId"),
  };
}

export function decodeTaskListFilter(params: JsonObject): TaskListFilter {
  return {
    projectId: decodeRoutingProjectId({ params }),
    contextId: stringField(params, "contextId"),
  };
}

export function makeJsonRpcResponse(id: JsonRpcId, result: JsonValue): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function makeJsonRpcError(id: JsonRpcId, err: A2AProtocolError): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: err.rpcCode,
      message: err.message,
      data: err.data,
    },
  };
}

export function invalidRequest(message: string): A2AProtocolError {
  return new A2AProtocolError(-32600, message, [badRequest("request", message)]);
}

export function invalidParams(message: string): A2AProtocolError {
  return new A2AProtocolError(-32602, message, [badRequest("params", message)]);
}

export function methodNotFound(method: string): A2AProtocolError {
  return new A2AProtocolError(-32601, `Unsupported A2A method: ${method}`, [
    errorInfo("METHOD_NOT_FOUND", { method }),
  ]);
}

export function daemonUnavailable(): A2AProtocolError {
  return new A2AProtocolError(-32603, "KOTA daemon is not available", [
    errorInfo("DAEMON_UNAVAILABLE"),
  ]);
}

export function unauthorized(): A2AProtocolError {
  return new A2AProtocolError(-32603, "A2A request is unauthorized", [
    errorInfo("UNAUTHORIZED"),
  ]);
}

export function taskNotFound(taskId: string): A2AProtocolError {
  return new A2AProtocolError(-32001, `A2A task not found: ${taskId}`, [
    errorInfo("TASK_NOT_FOUND", { taskId }),
  ]);
}

export function taskNotCancelable(taskId: string): A2AProtocolError {
  return new A2AProtocolError(-32002, `A2A task is not cancelable: ${taskId}`, [
    errorInfo("TASK_NOT_CANCELABLE", { taskId }),
  ]);
}

export function terminalTaskSubscription(taskId: string): A2AProtocolError {
  return new A2AProtocolError(-32004, `A2A task is not active: ${taskId}`, [
    errorInfo("UNSUPPORTED_OPERATION", {
      taskId,
      operation: "SubscribeToTask",
    }),
  ]);
}

export function capabilityMismatch(message: string): A2AProtocolError {
  return new A2AProtocolError(-32004, message, [
    errorInfo("UNSUPPORTED_OPERATION"),
  ]);
}

export function versionNotSupported(requestedVersion: string): A2AProtocolError {
  return new A2AProtocolError(-32009, `A2A protocol version is not supported: ${requestedVersion}`, [
    errorInfo("VERSION_NOT_SUPPORTED", {
      requestedVersion,
      supportedVersions: [...A2A_SUPPORTED_PROTOCOL_VERSIONS],
    }),
  ]);
}

export function routingScopeMismatch(tenant: string, projectId: string): A2AProtocolError {
  return new A2AProtocolError(-32602, "A2A tenant and KOTA projectId must match", [
    errorInfo("ROUTING_SCOPE_MISMATCH", { tenant, projectId }),
  ]);
}

export function contentTypeNotSupported(message: string): A2AProtocolError {
  return new A2AProtocolError(-32005, message, [
    errorInfo("CONTENT_TYPE_NOT_SUPPORTED"),
  ]);
}

export function agentExecutionFailed(message: string): A2AProtocolError {
  return new A2AProtocolError(-32006, message, [
    errorInfo("INVALID_AGENT_RESPONSE"),
  ]);
}

export function daemonProtocolError(message: string): A2AProtocolError {
  return new A2AProtocolError(-32603, message, [
    errorInfo("DAEMON_PROTOCOL_ERROR"),
  ]);
}

function assertSupportedSendConfiguration(params: JsonObject): void {
  const configuration = optionalObjectField(params, "configuration");
  if (
    hasField(params, "pushNotification") ||
    hasField(params, "pushNotificationConfig") ||
    hasField(params, "taskPushNotificationConfig") ||
    (configuration !== null && (
      hasField(configuration, "pushNotification") ||
      hasField(configuration, "pushNotificationConfig") ||
      hasField(configuration, "taskPushNotificationConfig")
    ))
  ) {
    throw capabilityMismatch("A2A push notifications are not supported by this KOTA channel");
  }
  assertAcceptedOutputModes(configuration);
  if (
    configuration &&
    (
      booleanField(configuration, "returnImmediately") === true ||
      booleanField(configuration, "blocking") === false
    )
  ) {
    throw capabilityMismatch("Non-blocking A2A send is not supported; use SendStreamingMessage");
  }
}

function assertAcceptedOutputModes(configuration: JsonObject | null): void {
  if (!configuration || !hasField(configuration, "acceptedOutputModes")) return;
  const modes = configuration.acceptedOutputModes;
  if (!Array.isArray(modes)) {
    throw invalidParams("configuration.acceptedOutputModes must be an array");
  }
  if (modes.length === 0 || modes.some((mode) => mode !== A2A_TEXT_MEDIA_TYPE)) {
    throw capabilityMismatch("A2A output modes are limited to text/plain");
  }
}

function optionalObjectField(obj: JsonObject, key: string): JsonObject | null {
  const value = obj[key];
  if (value === undefined) return null;
  if (!isJsonObject(value)) {
    throw invalidParams(`${key} must be an object`);
  }
  return value;
}

function hasField(obj: JsonObject, key: string): boolean {
  return obj[key] !== undefined;
}

function decodeRoutingProjectId(input: RoutingScopeInput): string | null {
  const scopes = [
    input.params,
    objectField(input.params, "metadata"),
    input.message ?? null,
    input.message ? objectField(input.message, "metadata") : null,
  ].filter((obj): obj is JsonObject => obj !== null);
  const tenant = firstMatchingScopeValue(scopes, "tenant");
  const projectId = firstMatchingScopeValue(scopes, "projectId");
  if (tenant !== null && projectId !== null && tenant !== projectId) {
    throw routingScopeMismatch(tenant, projectId);
  }
  return tenant ?? projectId;
}

function firstMatchingScopeValue(scopes: JsonObject[], key: "tenant" | "projectId"): string | null {
  let selected: string | null = null;
  for (const scope of scopes) {
    const value = stringField(scope, key);
    if (value === null) continue;
    if (selected !== null && selected !== value) {
      throw invalidParams(`${key} must use one consistent value`);
    }
    selected = value;
  }
  return selected;
}

function decodeTextParts(parts: JsonValue[]): string | null {
  const texts: string[] = [];
  for (const partValue of parts) {
    if (!isJsonObject(partValue)) {
      throw invalidParams("message.parts entries must be objects");
    }
    const contentKeys = ["text", "raw", "url", "data"].filter((key) => partValue[key] !== undefined);
    if (contentKeys.length !== 1) {
      throw invalidParams("A2A v1.0 parts must contain exactly one of text, raw, url, or data");
    }
    const [contentKey] = contentKeys;
    if (contentKey !== "text") {
      throw contentTypeNotSupported(`Unsupported A2A content part: ${contentKey}`);
    }
    if (partValue.mediaType !== undefined && partValue.mediaType !== A2A_TEXT_MEDIA_TYPE) {
      throw contentTypeNotSupported("Only text/plain message parts are supported");
    }
    const text = stringField(partValue, "text");
    if (!text) {
      throw invalidParams("text parts must include non-empty text");
    }
    texts.push(text);
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

function badRequest(field: string, description: string): JsonObject {
  return {
    "@type": "type.googleapis.com/google.rpc.BadRequest",
    fieldViolations: [{ field, description }],
  };
}

function errorInfo(reason: string, metadata?: JsonObject): JsonObject {
  return {
    "@type": "type.googleapis.com/google.rpc.ErrorInfo",
    reason,
    domain: "a2a-protocol.org",
    ...(metadata ? { metadata } : {}),
  };
}
