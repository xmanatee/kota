import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type { ToolResultBlock } from "#core/tools/tool-result.js";
import {
  decodeContent,
  decodeMcpContentBlock,
  decodeResourceContents,
} from "./client-content-decoders.js";
import {
  decodeCacheHints,
  isJsonValue,
  malformedMcpResult,
  optionalBoolean,
  optionalJsonObject,
  optionalNumber,
  optionalString,
  requireJsonObject,
  requireString,
} from "./client-decode-utils.js";
import { mcpToolInputRequestElicitationMode } from "./client-input-helpers.js";
import type {
  JsonRpcResponse,
  McpCallToolResult,
  McpCancelTaskResult,
  McpCompleteResultFields,
  McpCreateTaskResult,
  McpGetPromptResult,
  McpGetTaskResult,
  McpInputRequiredResult,
  McpPromptMessage,
  McpProtocolVersion,
  McpReadResourceResult,
  McpResultKind,
  McpSamplingCreateMessageResult,
  McpSamplingInputRequest,
  McpTaskState,
  McpTaskStatus,
  McpToolContentBlock,
  McpToolInputRequest,
  McpToolInputRequests,
  McpToolInputResponse,
  McpToolInputResponses,
  McpToolTextContent,
  McpUpdateTaskResult,
} from "./client-protocol.js";
import { MCP_TASK_STATUSES } from "./client-protocol.js";
import {
  decodeSamplingCreateMessageParams,
  decodeSamplingCreateMessageResult,
} from "./client-sampling-decoders.js";

export function toResultText(content: McpToolContentBlock[]): string {
  const text = content
    .filter((block): block is McpToolTextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return text || "(no output)";
}

export function toToolResultBlock(block: McpToolContentBlock): ToolResultBlock {
  if (block.type === "text") {
    return {
      type: "text",
      text: block.text,
      ...(block.annotations ? { annotations: block.annotations } : {}),
      ...(block._meta ? { _meta: block._meta } : {}),
    };
  }
  if (block.type === "image") {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: block.mimeType,
        data: block.data,
      },
      ...(block.annotations ? { annotations: block.annotations } : {}),
      ...(block._meta ? { _meta: block._meta } : {}),
    };
  }
  return { type: "mcp_content", content: block };
}

export function decodeCompleteResultFields(object: KotaJsonObject): McpCompleteResultFields {
  const content = decodeContent(object.content, "tools/call");
  if (
    object.structuredContent !== undefined &&
    !isJsonValue(object.structuredContent)
  ) {
    throw new Error("Malformed MCP tools/call result: structuredContent must be JSON");
  }
  const structuredContent = optionalJsonObject(
    object.structuredContent,
    "structuredContent",
  );
  const meta = optionalJsonObject(object._meta, "_meta");
  const isError = optionalBoolean(object.isError, "isError");
  return {
    content,
    text: toResultText(content),
    blocks: content.map(toToolResultBlock),
    ...(structuredContent ? { structuredContent } : {}),
    ...(meta ? { _meta: meta } : {}),
    ...(isError !== undefined ? { isError } : {}),
  };
}

export function decodeInputRequests(
  value: KotaJsonValue | undefined,
  kind: McpResultKind = "tools/call",
): McpToolInputRequests {
  const object = requireJsonObject(value, "inputRequests", kind);
  const decoded: { [requestId: string]: McpToolInputRequest | McpSamplingInputRequest } = {};
  for (const [requestId, rawRequest] of Object.entries(object)) {
    const label = `inputRequests.${requestId}`;
    const request = optionalJsonObject(rawRequest, label, kind);
    if (!request) {
      throw malformedMcpResult(kind, label, "an object");
    }
    const method = requireString(request.method, `${label}.method`, kind);
    if (method === "elicitation/create") {
      const params = requireJsonObject(request.params, `${label}.params`, kind);
      const mode = params.mode === undefined
        ? "form"
        : requireString(params.mode, `${label}.params.mode`, kind);
      if (mode !== "form" && mode !== "url") {
        throw new Error(
          `Malformed MCP ${kind} result: ${label}.params.mode must be form or url`,
        );
      }
      requireString(params.message, `${label}.params.message`, kind);
      if (mode === "url") {
        requireString(params.url, `${label}.params.url`, kind);
        requireString(params.elicitationId, `${label}.params.elicitationId`, kind);
      }
      decoded[requestId] = {
        ...request,
        method,
        params,
      };
      continue;
    }
    if (method === "sampling/createMessage") {
      decoded[requestId] = {
        method,
        params: decodeSamplingCreateMessageParams(request.params, label, kind),
      };
      continue;
    }
    const params = requireJsonObject(request.params, `${label}.params`, kind);
    decoded[requestId] = {
      ...request,
      method,
      params,
    };
  }
  if (Object.keys(decoded).length === 0) {
    throw new Error(
      `Malformed MCP ${kind} result: inputRequests must include at least one request`,
    );
  }
  return decoded as McpToolInputRequests;
}

export function decodeElicitationToolInputResponse(
  response: KotaJsonObject,
  label: string,
  inputRequest: McpToolInputRequest | McpSamplingInputRequest | undefined,
  kind: McpResultKind,
): McpToolInputResponse {
  const rawAction = requireString(response.action, `${label}.action`, kind);
  if (
    rawAction !== "accept" &&
    rawAction !== "decline" &&
    rawAction !== "cancel" &&
    rawAction !== "reject"
  ) {
    throw new Error(
      `Malformed MCP ${kind} result: ${label}.action must be accept, decline, or cancel`,
    );
  }
  // Older draft examples used `reject`; accept that operator-facing alias
  // narrowly, but normalize before sending current draft inputResponses.
  const action = rawAction === "reject" ? "decline" : rawAction;
  const mode = inputRequest
    ? mcpToolInputRequestElicitationMode(inputRequest)
    : null;
  const content = optionalJsonObject(response.content, `${label}.content`, kind);
  if (mode === "url" && content !== undefined) {
    throw new Error(
      `Malformed MCP ${kind} result: ${label}.content must be omitted for URL-mode response`,
    );
  }
  if (mode === "url") {
    const unexpectedKeys = Object.keys(response).filter((key) => key !== "action");
    if (unexpectedKeys.length > 0) {
      throw new Error(
        `Malformed MCP ${kind} result: ${label} must include only action for URL-mode response`,
      );
    }
    return { action };
  }
  if (action === "accept" && !content) {
    throw new Error(
      `Malformed MCP ${kind} result: ${label}.content must be an object when action is accept`,
    );
  }
  return {
    action,
    ...(content !== undefined ? { content } : {}),
  };
}

export function decodeMcpToolInputResponses(
  value: KotaJsonValue | undefined,
  inputRequests?: McpToolInputRequests,
  kind: McpResultKind = "tools/call",
): McpToolInputResponses {
  const object = requireJsonObject(value, "inputResponses", kind);
  const decoded: { [requestId: string]: McpToolInputResponse | McpSamplingCreateMessageResult } = {};
  for (const [requestId, rawResponse] of Object.entries(object)) {
    const label = `inputResponses.${requestId}`;
    const response = optionalJsonObject(rawResponse, label, kind);
    if (!response) {
      throw malformedMcpResult(kind, label, "an object");
    }
    const inputRequest = inputRequests?.[requestId];
    if (inputRequests && !inputRequest) {
      throw new Error(
        `Malformed MCP ${kind} result: ${label} does not match an input request`,
      );
    }
    if (inputRequest?.method === "sampling/createMessage") {
      decoded[requestId] = decodeSamplingCreateMessageResult(response, label, kind);
      continue;
    }
    decoded[requestId] = decodeElicitationToolInputResponse(response, label, inputRequest, kind);
  }
  if (Object.keys(decoded).length === 0) {
    throw new Error(
      `Malformed MCP ${kind} result: inputResponses must include at least one response`,
    );
  }
  return decoded as McpToolInputResponses;
}

export function decodeInputRequiredResult(
  object: KotaJsonObject,
  protocolVersion: McpProtocolVersion,
  kind: McpResultKind = "tools/call",
): McpInputRequiredResult {
  const inputRequests = object.inputRequests === undefined
    ? undefined
    : decodeInputRequests(object.inputRequests, kind);
  const requestState = optionalString(object.requestState, "requestState", kind);
  const meta = optionalJsonObject(object._meta, "_meta", kind);
  const base: {
    resultType: "input_required";
    protocolVersion: McpProtocolVersion;
    _meta?: KotaJsonObject;
  } = {
    resultType: "input_required",
    protocolVersion,
    ...(meta ? { _meta: meta } : {}),
  };
  if (inputRequests) {
    return requestState !== undefined
      ? { ...base, inputRequests, requestState }
      : { ...base, inputRequests };
  }
  if (requestState !== undefined) {
    return { ...base, requestState };
  }
  throw new Error(
    `Malformed MCP ${kind} result: input_required must include inputRequests or requestState`,
  );
}

function requirePositiveSafeInteger(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): number {
  const number = optionalNumber(value, label, kind);
  if (number === undefined || !Number.isSafeInteger(number) || number <= 0) {
    throw malformedMcpResult(kind, label, "a positive integer");
  }
  return number;
}

function requireTaskTtlMs(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): number | null {
  if (value === null) return null;
  const number = optionalNumber(value, label, kind);
  if (number === undefined || !Number.isSafeInteger(number) || number <= 0) {
    throw malformedMcpResult(kind, label, "a positive integer or null");
  }
  return number;
}

function optionalPositiveSafeInteger(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): number | undefined {
  if (value === undefined) return undefined;
  return requirePositiveSafeInteger(value, label, kind);
}

function requireIsoTimestamp(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): string {
  const timestamp = requireString(value, label, kind);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw malformedMcpResult(kind, label, "a valid timestamp string");
  }
  return timestamp;
}

function decodeTaskStatus(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpTaskStatus {
  const status = requireString(value, label, kind);
  if (!(MCP_TASK_STATUSES as readonly string[]).includes(status)) {
    throw new Error(
      `Malformed MCP ${kind} result: ${label} must be working, input_required, completed, failed, or cancelled`,
    );
  }
  return status as McpTaskStatus;
}

function decodeTaskError(
  value: KotaJsonValue | undefined,
  kind: McpResultKind,
): JsonRpcResponse["error"] {
  const object = requireJsonObject(value, "error", kind);
  const code = optionalNumber(object.code, "error.code", kind);
  if (code === undefined || !Number.isInteger(code)) {
    throw malformedMcpResult(kind, "error.code", "an integer");
  }
  const message = requireString(object.message, "error.message", kind);
  if (object.data !== undefined && !isJsonValue(object.data)) {
    throw malformedMcpResult(kind, "error.data", "JSON");
  }
  return {
    code,
    message,
    ...(object.data !== undefined ? { data: object.data } : {}),
  };
}

function decodeTaskState(object: KotaJsonObject, kind: McpResultKind): McpTaskState {
  const resultType = object.resultType;
  if (resultType !== undefined && resultType !== "task") {
    throw new Error(`Malformed MCP ${kind} result: resultType must be "task"`);
  }
  const taskId = requireString(object.taskId, "taskId", kind);
  if (taskId.length === 0) {
    throw malformedMcpResult(kind, "taskId", "a non-empty string");
  }
  const status = decodeTaskStatus(object.status, "status", kind);
  const statusMessage = optionalString(object.statusMessage, "statusMessage", kind);
  const createdAt = requireIsoTimestamp(object.createdAt, "createdAt", kind);
  const lastUpdatedAt = requireIsoTimestamp(object.lastUpdatedAt, "lastUpdatedAt", kind);
  const ttlMs = requireTaskTtlMs(object.ttlMs, "ttlMs", kind);
  const pollIntervalMs = optionalPositiveSafeInteger(
    object.pollIntervalMs,
    "pollIntervalMs",
    kind,
  );
  const inputRequests = object.inputRequests === undefined
    ? undefined
    : decodeInputRequests(object.inputRequests, kind);
  const requestState = optionalString(object.requestState, "requestState", kind);
  const meta = optionalJsonObject(object._meta, "_meta", kind);

  if (status !== "input_required") {
    if (inputRequests !== undefined) {
      throw new Error(
        `Malformed MCP ${kind} result: inputRequests may appear only when status is input_required`,
      );
    }
    if (requestState !== undefined) {
      throw new Error(
        `Malformed MCP ${kind} result: requestState may appear only when status is input_required`,
      );
    }
  }
  if (status === "input_required" && inputRequests === undefined && requestState === undefined) {
    throw new Error(
      `Malformed MCP ${kind} result: input_required task must include inputRequests or requestState`,
    );
  }

  let result: KotaJsonValue | undefined;
  if (object.result !== undefined) {
    if (status !== "completed") {
      throw new Error(
        `Malformed MCP ${kind} result: result may appear only when status is completed`,
      );
    }
    if (!isJsonValue(object.result)) {
      throw malformedMcpResult(kind, "result", "JSON");
    }
    result = object.result;
  } else if (status === "completed") {
    throw malformedMcpResult(kind, "result", "JSON");
  }

  let error: JsonRpcResponse["error"] | undefined;
  if (object.error !== undefined) {
    if (status !== "failed") {
      throw new Error(
        `Malformed MCP ${kind} result: error may appear only when status is failed`,
      );
    }
    error = decodeTaskError(object.error, kind);
  } else if (status === "failed") {
    throw malformedMcpResult(kind, "error", "a JSON-RPC error object");
  }

  return {
    ...(resultType === "task" ? { resultType } : {}),
    taskId,
    status,
    createdAt,
    lastUpdatedAt,
    ttlMs,
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(statusMessage !== undefined ? { statusMessage } : {}),
    ...(inputRequests !== undefined ? { inputRequests } : {}),
    ...(requestState !== undefined ? { requestState } : {}),
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodeCreateTaskResult(
  object: KotaJsonObject,
  protocolVersion: McpProtocolVersion,
): McpCreateTaskResult {
  return {
    resultType: "task",
    protocolVersion,
    ...decodeTaskState(object, "tools/call"),
  };
}

export function decodeGetTaskResult(
  value: JsonRpcResponse["result"],
): McpGetTaskResult {
  const object = requireJsonObject(value, "result", "tasks/get");
  return decodeTaskState(object, "tasks/get");
}

export function decodeEmptyTaskAckResult(
  value: JsonRpcResponse["result"],
  kind: "tasks/update",
): McpUpdateTaskResult;
export function decodeEmptyTaskAckResult(
  value: JsonRpcResponse["result"],
  kind: "tasks/cancel",
): McpCancelTaskResult;
export function decodeEmptyTaskAckResult(
  value: JsonRpcResponse["result"],
  kind: "tasks/update" | "tasks/cancel",
): McpUpdateTaskResult | McpCancelTaskResult {
  const object = requireJsonObject(value, "result", kind);
  if (object.resultType !== undefined && object.resultType !== "complete") {
    throw new Error(`Malformed MCP ${kind} result: resultType must be "complete"`);
  }
  const meta = optionalJsonObject(object._meta, "_meta", kind);
  const allowedKeys = new Set(["resultType", "_meta"]);
  const unexpectedKey = Object.keys(object).find((key) => !allowedKeys.has(key));
  if (unexpectedKey !== undefined) {
    throw new Error(
      `Malformed MCP ${kind} result: ${unexpectedKey} is not allowed`,
    );
  }
  return {
    resultType: "complete",
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodeCallToolResult(
  value: JsonRpcResponse["result"],
  protocolVersion: McpProtocolVersion,
): McpCallToolResult {
  const object = requireJsonObject(value, "result");
  if (object.resultType === undefined) {
    return {
      resultType: "legacy",
      protocolVersion,
      ...decodeCompleteResultFields(object),
    };
  }
  const resultType = requireString(object.resultType, "resultType");
  if (resultType === "complete") {
    return {
      resultType: "complete",
      protocolVersion,
      ...decodeCompleteResultFields(object),
    };
  }
  if (resultType === "input_required") {
    return decodeInputRequiredResult(object, protocolVersion, "tools/call");
  }
  if (resultType === "task") {
    return decodeCreateTaskResult(object, protocolVersion);
  }
  throw new Error(
    'Malformed MCP tools/call result: resultType must be "complete", "input_required", or "task"',
  );
}

export function decodeReadResourceResult(
  value: JsonRpcResponse["result"],
  protocolVersion: McpProtocolVersion,
): McpReadResourceResult {
  const object = requireJsonObject(value, "result", "resources/read");
  const resultType = object.resultType === undefined
    ? "complete"
    : requireString(object.resultType, "resultType", "resources/read");
  if (resultType === "input_required") {
    return decodeInputRequiredResult(object, protocolVersion, "resources/read");
  }
  if (resultType !== "complete") {
    throw new Error(
      'Malformed MCP resources/read result: resultType must be "complete" or "input_required"',
    );
  }
  if (!Array.isArray(object.contents)) {
    throw malformedMcpResult("resources/read", "contents", "an array");
  }
  const meta = optionalJsonObject(object._meta, "_meta", "resources/read");
  return {
    resultType: "complete",
    protocolVersion,
    contents: object.contents.map((entry, index) =>
      decodeResourceContents(entry, `contents[${index}]`, "resources/read"),
    ),
    cache: decodeCacheHints(object, "resources/read"),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodePromptMessage(value: KotaJsonValue, index: number): McpPromptMessage {
  const label = `messages[${index}]`;
  const object = optionalJsonObject(value, label, "prompts/get");
  if (!object) {
    throw malformedMcpResult("prompts/get", label, "an object");
  }
  const role = requireString(object.role, `${label}.role`, "prompts/get");
  if (role !== "user" && role !== "assistant") {
    throw new Error(
      `Malformed MCP prompts/get result: ${label}.role must be user or assistant`,
    );
  }
  const meta = optionalJsonObject(object._meta, `${label}._meta`, "prompts/get");
  return {
    role,
    content: decodeMcpContentBlock(object.content, `${label}.content`, "prompts/get"),
    ...(meta ? { _meta: meta } : {}),
  };
}

export function decodeGetPromptResult(
  value: JsonRpcResponse["result"],
  protocolVersion: McpProtocolVersion,
): McpGetPromptResult {
  const object = requireJsonObject(value, "result", "prompts/get");
  const resultType = object.resultType === undefined
    ? "complete"
    : requireString(object.resultType, "resultType", "prompts/get");
  if (resultType === "input_required") {
    return decodeInputRequiredResult(object, protocolVersion, "prompts/get");
  }
  if (resultType !== "complete") {
    throw new Error(
      'Malformed MCP prompts/get result: resultType must be "complete" or "input_required"',
    );
  }
  if (!Array.isArray(object.messages)) {
    throw malformedMcpResult("prompts/get", "messages", "an array");
  }
  const description = optionalString(object.description, "description", "prompts/get");
  const meta = optionalJsonObject(object._meta, "_meta", "prompts/get");
  return {
    resultType: "complete",
    protocolVersion,
    messages: object.messages.map(decodePromptMessage),
    ...(description !== undefined ? { description } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}
