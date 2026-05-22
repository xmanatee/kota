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
  optionalString,
  requireJsonObject,
  requireString,
} from "./client-decode-utils.js";
import { mcpToolInputRequestElicitationMode } from "./client-input-helpers.js";
import type {
  JsonRpcResponse,
  McpCallToolResult,
  McpCompleteResultFields,
  McpGetPromptResult,
  McpInputRequiredResult,
  McpPromptMessage,
  McpProtocolVersion,
  McpReadResourceResult,
  McpResultKind,
  McpSamplingCreateMessageResult,
  McpSamplingInputRequest,
  McpToolContentBlock,
  McpToolInputRequest,
  McpToolInputRequests,
  McpToolInputResponse,
  McpToolInputResponses,
  McpToolTextContent,
} from "./client-protocol.js";
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
  throw new Error(
    'Malformed MCP tools/call result: resultType must be "complete" or "input_required"',
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
