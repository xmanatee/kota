import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type {
  KotaJsonObject,
  KotaJsonValue,
  KotaMcpAnnotations,
  KotaMcpBlobResourceContents,
  KotaMcpIcon,
  KotaMcpPreservedContent,
  KotaMcpResourceContents,
  KotaMcpTextResourceContents,
  KotaToolInputSchema,
  KotaToolOutputSchema,
} from "#core/agent-harness/message-protocol.js";
import type { ToolResultBlock } from "#core/tools/tool-result.js";

export type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema: KotaToolInputSchema;
  outputSchema?: KotaToolOutputSchema;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type JsonRpcIncomingMessage = Partial<JsonRpcNotification & JsonRpcResponse>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type McpResultKind = "initialize" | "tools/call" | "tools/list";
type McpRejectedToolDefinition = {
  toolName?: string;
  reason: string;
};
type McpListToolsPage = {
  tools: McpToolSchema[];
  rejectedTools: McpRejectedToolDefinition[];
  nextCursor?: string;
};

export const MCP_LEGACY_PROTOCOL_VERSION = "2024-11-05";
export const MCP_DRAFT_PROTOCOL_VERSION = "DRAFT-2026-v1";

export type McpProtocolVersion =
  | typeof MCP_LEGACY_PROTOCOL_VERSION
  | typeof MCP_DRAFT_PROTOCOL_VERSION;

export type McpToolResultContract = "legacy-content" | "draft-tool-result";

export type McpToolListChangedHandler = () => void;

export type McpToolTextContent = {
  type: "text";
  text: string;
  annotations?: KotaMcpAnnotations;
  _meta?: KotaJsonObject;
};

export type McpToolImageContent = {
  type: "image";
  data: string;
  mimeType: string;
  annotations?: KotaMcpAnnotations;
  _meta?: KotaJsonObject;
};

export type McpToolContentBlock =
  | McpToolTextContent
  | McpToolImageContent
  | KotaMcpPreservedContent;

type McpCompleteResultFields = {
  content: McpToolContentBlock[];
  text: string;
  blocks: ToolResultBlock[];
  structuredContent?: KotaJsonObject;
  _meta?: KotaJsonObject;
  isError?: boolean;
};

export type McpLegacyCallToolResult = McpCompleteResultFields & {
  resultType: "legacy";
  protocolVersion: McpProtocolVersion;
};

export type McpCompleteCallToolResult = McpCompleteResultFields & {
  resultType: "complete";
  protocolVersion: McpProtocolVersion;
};

export type McpToolInputRequest = KotaJsonObject & {
  method: string;
  params: KotaJsonObject;
};

export type McpToolInputRequests = KotaJsonObject & {
  [requestId: string]: McpToolInputRequest;
};

export type McpToolInputResponse = KotaJsonObject & {
  action: "accept" | "reject" | "cancel";
  content?: KotaJsonObject;
};

export type McpToolInputResponses = KotaJsonObject & {
  [requestId: string]: McpToolInputResponse;
};

type McpInputRequiredFields =
  | {
      inputRequests: McpToolInputRequests;
      requestState?: string;
    }
  | {
      inputRequests?: McpToolInputRequests;
      requestState: string;
    };

export type McpInputRequiredCallToolResult = McpInputRequiredFields & {
  resultType: "input_required";
  protocolVersion: McpProtocolVersion;
  _meta?: KotaJsonObject;
};

export type McpCallToolResult =
  | McpLegacyCallToolResult
  | McpCompleteCallToolResult
  | McpInputRequiredCallToolResult;

export type McpCallToolRetry =
  | {
      requestState: string;
      inputResponses?: McpToolInputResponses;
    }
  | {
      requestState?: string;
      inputResponses: McpToolInputResponses;
    };

const CONNECT_TIMEOUT = 10_000;
const CALL_TIMEOUT = 120_000;
const MCP_HEADER_ANNOTATION = "x-mcp-header";

class McpHeaderAnnotationError extends Error {
  constructor(
    readonly reason: string,
    readonly toolName: string,
  ) {
    super(reason);
  }
}

function isJsonValue(value: JsonRpcResponse["result"]): value is KotaJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonObject(value: JsonRpcResponse["result"]): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformedMcpResult(kind: McpResultKind, label: string, expected: string): Error {
  return new Error(`Malformed MCP ${kind} result: ${label} must be ${expected}`);
}

function requireJsonObject(
  value: JsonRpcResponse["result"],
  label: string,
  kind: McpResultKind = "tools/call",
): KotaJsonObject {
  if (!isJsonObject(value)) {
    throw malformedMcpResult(kind, label, "an object");
  }
  return value;
}

function requireString(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string {
  if (typeof value !== "string") {
    throw malformedMcpResult(kind, label, "a string");
  }
  return value;
}

function optionalString(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw malformedMcpResult(kind, label, "a string");
  }
  return value;
}

function optionalNumber(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw malformedMcpResult(kind, label, "a number");
  }
  return value;
}

function optionalBoolean(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw malformedMcpResult(kind, label, "a boolean");
  }
  return value;
}

function optionalStringArray(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw malformedMcpResult(kind, label, "a string array");
  }
  return value;
}

function optionalJsonObject(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaJsonObject | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    throw malformedMcpResult(kind, label, "an object");
  }
  return value;
}

type McpInitializeResult = {
  protocolVersion: McpProtocolVersion;
  toolsListChanged: boolean;
  serverInfo?: { name?: string };
};

function isMcpProtocolVersion(value: string): value is McpProtocolVersion {
  return value === MCP_DRAFT_PROTOCOL_VERSION || value === MCP_LEGACY_PROTOCOL_VERSION;
}

function decodeInitializeResult(value: JsonRpcResponse["result"]): McpInitializeResult {
  const object = requireJsonObject(value, "result", "initialize");
  const protocolVersion = requireString(
    object.protocolVersion,
    "protocolVersion",
    "initialize",
  );
  if (!isMcpProtocolVersion(protocolVersion)) {
    throw new Error(
      `Malformed MCP initialize result: protocolVersion must be ${MCP_DRAFT_PROTOCOL_VERSION} or ${MCP_LEGACY_PROTOCOL_VERSION}`,
    );
  }
  const capabilities = optionalJsonObject(
    object.capabilities,
    "capabilities",
    "initialize",
  );
  const toolsCapability = capabilities
    ? optionalJsonObject(capabilities.tools, "capabilities.tools", "initialize")
    : undefined;
  const toolsListChanged = toolsCapability
    ? optionalBoolean(
      toolsCapability.listChanged,
      "capabilities.tools.listChanged",
      "initialize",
    ) === true
    : false;
  const rawServerInfo = optionalJsonObject(
    object.serverInfo,
    "serverInfo",
    "initialize",
  );
  const name = rawServerInfo
    ? optionalString(rawServerInfo.name, "serverInfo.name", "initialize")
    : undefined;
  return {
    protocolVersion,
    toolsListChanged,
    ...(rawServerInfo ? { serverInfo: { ...(name !== undefined ? { name } : {}) } } : {}),
  };
}

function decodeToolObjectSchema(
  value: KotaJsonValue | undefined,
  label: string,
): KotaToolInputSchema {
  const object = optionalJsonObject(value, label, "tools/list");
  if (!object) {
    throw malformedMcpResult("tools/list", label, "an object");
  }
  const type = requireString(object.type, `${label}.type`, "tools/list");
  if (type !== "object") {
    throw new Error(`Malformed MCP tools/list result: ${label}.type must be "object"`);
  }
  const properties = optionalJsonObject(
    object.properties,
    `${label}.properties`,
    "tools/list",
  ) ?? {};
  const required = optionalStringArray(
    object.required,
    `${label}.required`,
    "tools/list",
  );
  return {
    ...object,
    type: "object",
    properties,
    ...(required !== undefined ? { required } : {}),
  };
}

function isPrimitiveHeaderPropertyType(value: KotaJsonValue | undefined): boolean {
  return value === "string" || value === "number" || value === "boolean";
}

function isAllowedHeaderAnnotationValue(value: string): boolean {
  if (value.length === 0) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x21 || code > 0x7e || char === ":") return false;
  }
  return true;
}

function schemaPropertyLabel(parentLabel: string, propertyName: string): string {
  return `${parentLabel}.properties.${propertyName}`;
}

function rejectHeaderAnnotation(
  toolName: string,
  propertyLabel: string,
  reason: string,
): never {
  throw new McpHeaderAnnotationError(
    `${propertyLabel}.${MCP_HEADER_ANNOTATION} ${reason}`,
    toolName,
  );
}

function validateHeaderAnnotationValue(args: {
  toolName: string;
  propertyLabel: string;
  propertySchema: KotaJsonObject;
  seenHeaders: Map<string, { value: string; propertyLabel: string }>;
}): void {
  const headerValue = args.propertySchema[MCP_HEADER_ANNOTATION];
  if (headerValue === undefined) return;
  if (!isPrimitiveHeaderPropertyType(args.propertySchema.type)) {
    rejectHeaderAnnotation(
      args.toolName,
      args.propertyLabel,
      "is only allowed on primitive string, number, or boolean properties",
    );
  }
  if (typeof headerValue !== "string") {
    rejectHeaderAnnotation(
      args.toolName,
      args.propertyLabel,
      "must be a non-empty ASCII header string",
    );
  }
  if (headerValue.length === 0) {
    rejectHeaderAnnotation(args.toolName, args.propertyLabel, "has empty value");
  }
  if (!isAllowedHeaderAnnotationValue(headerValue)) {
    rejectHeaderAnnotation(
      args.toolName,
      args.propertyLabel,
      'contains a forbidden character; use non-empty printable ASCII without spaces or ":"',
    );
  }
  const normalized = headerValue.toLowerCase();
  const duplicate = args.seenHeaders.get(normalized);
  if (duplicate) {
    rejectHeaderAnnotation(
      args.toolName,
      args.propertyLabel,
      `duplicates header "${duplicate.value}" from ${duplicate.propertyLabel} case-insensitively`,
    );
  }
  args.seenHeaders.set(normalized, {
    value: headerValue,
    propertyLabel: args.propertyLabel,
  });
}

function validateMcpHeaderAnnotationsInProperties(args: {
  toolName: string;
  parentLabel: string;
  properties: KotaJsonObject;
  seenHeaders: Map<string, { value: string; propertyLabel: string }>;
}): void {
  for (const [propertyName, rawPropertySchema] of Object.entries(args.properties)) {
    if (!isJsonObject(rawPropertySchema)) continue;
    const propertyLabel = schemaPropertyLabel(args.parentLabel, propertyName);
    validateHeaderAnnotationValue({
      toolName: args.toolName,
      propertyLabel,
      propertySchema: rawPropertySchema,
      seenHeaders: args.seenHeaders,
    });
    const nestedProperties = rawPropertySchema.properties;
    if (isJsonObject(nestedProperties)) {
      validateMcpHeaderAnnotationsInProperties({
        toolName: args.toolName,
        parentLabel: propertyLabel,
        properties: nestedProperties,
        seenHeaders: args.seenHeaders,
      });
    }
  }
}

function validateMcpHeaderAnnotations(
  toolName: string,
  inputSchema: KotaToolInputSchema,
  label: string,
): void {
  const properties = isJsonObject(inputSchema.properties)
    ? inputSchema.properties
    : {};
  validateMcpHeaderAnnotationsInProperties({
    toolName,
    parentLabel: label,
    properties,
    seenHeaders: new Map(),
  });
}

function decodeToolDefinition(value: KotaJsonValue, index: number): McpToolSchema {
  const label = `tools[${index}]`;
  const object = optionalJsonObject(value, label, "tools/list");
  if (!object) {
    throw malformedMcpResult("tools/list", label, "an object");
  }
  const name = requireString(object.name, `${label}.name`, "tools/list");
  const inputSchema = decodeToolObjectSchema(object.inputSchema, `${label}.inputSchema`);
  validateMcpHeaderAnnotations(name, inputSchema, `${label}.inputSchema`);
  const outputSchema = object.outputSchema === undefined
    ? undefined
    : decodeToolObjectSchema(object.outputSchema, `${label}.outputSchema`);
  return {
    name,
    ...(object.description !== undefined
      ? { description: optionalString(object.description, `${label}.description`, "tools/list") }
      : {}),
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
  };
}

function decodeListToolsResult(value: JsonRpcResponse["result"]): McpListToolsPage {
  const object = requireJsonObject(value, "result", "tools/list");
  const tools = object.tools;
  if (!Array.isArray(tools)) {
    throw malformedMcpResult("tools/list", "tools", "an array");
  }
  const nextCursor = optionalString(object.nextCursor, "nextCursor", "tools/list");
  const decodedTools: McpToolSchema[] = [];
  const rejectedTools: McpRejectedToolDefinition[] = [];
  for (const [index, rawTool] of tools.entries()) {
    try {
      decodedTools.push(decodeToolDefinition(rawTool, index));
    } catch (err) {
      if (err instanceof McpHeaderAnnotationError) {
        rejectedTools.push({
          toolName: err.toolName,
          reason: err.reason,
        });
        continue;
      }
      throw err;
    }
  }
  return {
    tools: decodedTools,
    rejectedTools,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

function warnRejectedTool(serverName: string, rejected: McpRejectedToolDefinition): void {
  const toolLabel = rejected.toolName
    ? `tool "${rejected.toolName}"`
    : "tool definition";
  console.error(
    `[kota] Warning: rejected MCP ${toolLabel} from server "${serverName}": ${rejected.reason}`,
  );
}

function decodeAnnotations(
  value: KotaJsonValue | undefined,
  label: string,
): KotaMcpAnnotations | undefined {
  const object = optionalJsonObject(value, label);
  if (!object) return undefined;
  const audience = optionalStringArray(object.audience, `${label}.audience`);
  if (audience?.some((role) => role !== "user" && role !== "assistant")) {
    throw new Error(
      `Malformed MCP tools/call result: ${label}.audience must contain user or assistant`,
    );
  }
  const priority = optionalNumber(object.priority, `${label}.priority`);
  const lastModified = optionalString(object.lastModified, `${label}.lastModified`);
  return {
    ...(audience ? { audience: audience as Array<"user" | "assistant"> } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(lastModified !== undefined ? { lastModified } : {}),
  };
}

function decodeTextResourceContents(
  object: KotaJsonObject,
  label: string,
): KotaMcpTextResourceContents {
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`);
  const meta = optionalJsonObject(object._meta, `${label}._meta`);
  return {
    uri: requireString(object.uri, `${label}.uri`),
    ...(mimeType !== undefined ? { mimeType } : {}),
    text: requireString(object.text, `${label}.text`),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeBlobResourceContents(
  object: KotaJsonObject,
  label: string,
): KotaMcpBlobResourceContents {
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`);
  const meta = optionalJsonObject(object._meta, `${label}._meta`);
  return {
    uri: requireString(object.uri, `${label}.uri`),
    ...(mimeType !== undefined ? { mimeType } : {}),
    blob: requireString(object.blob, `${label}.blob`),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeResourceContents(
  value: KotaJsonValue | undefined,
  label: string,
): KotaMcpResourceContents {
  const object = optionalJsonObject(value, label);
  if (!object) {
    throw new Error(`Malformed MCP tools/call result: ${label} must be an object`);
  }
  if (typeof object.text === "string") return decodeTextResourceContents(object, label);
  if (typeof object.blob === "string") return decodeBlobResourceContents(object, label);
  throw new Error(`Malformed MCP tools/call result: ${label} must include text or blob`);
}

function decodeIcons(value: KotaJsonValue | undefined, label: string): KotaMcpIcon[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Malformed MCP tools/call result: ${label} must be an array`);
  }
  return value.map((entry, index) => {
    const object = optionalJsonObject(entry, `${label}[${index}]`);
    if (!object) {
      throw new Error(`Malformed MCP tools/call result: ${label}[${index}] must be an object`);
    }
    const mimeType = optionalString(object.mimeType, `${label}[${index}].mimeType`);
    const sizes = optionalStringArray(object.sizes, `${label}[${index}].sizes`);
    const theme = optionalString(object.theme, `${label}[${index}].theme`);
    if (theme !== undefined && theme !== "light" && theme !== "dark") {
      throw new Error(
        `Malformed MCP tools/call result: ${label}[${index}].theme must be light or dark`,
      );
    }
    return {
      src: requireString(object.src, `${label}[${index}].src`),
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(sizes !== undefined ? { sizes } : {}),
      ...(theme !== undefined ? { theme: theme as "light" | "dark" } : {}),
    };
  });
}

function decodeMcpContentBlock(
  value: KotaJsonValue,
  index: number,
): McpToolContentBlock {
  const label = `content[${index}]`;
  const object = optionalJsonObject(value, label);
  if (!object) {
    throw new Error(`Malformed MCP tools/call result: ${label} must be an object`);
  }
  const type = requireString(object.type, `${label}.type`);
  const annotations = decodeAnnotations(object.annotations, `${label}.annotations`);
  const meta = optionalJsonObject(object._meta, `${label}._meta`);
  switch (type) {
    case "text":
      return {
        type: "text",
        text: requireString(object.text, `${label}.text`),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "image":
      return {
        type: "image",
        data: requireString(object.data, `${label}.data`),
        mimeType: requireString(object.mimeType, `${label}.mimeType`),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "audio":
      return {
        type: "audio",
        data: requireString(object.data, `${label}.data`),
        mimeType: requireString(object.mimeType, `${label}.mimeType`),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "resource":
      return {
        type: "resource",
        resource: decodeResourceContents(object.resource, `${label}.resource`),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "resource_link": {
      const icons = decodeIcons(object.icons, `${label}.icons`);
      const title = optionalString(object.title, `${label}.title`);
      const description = optionalString(object.description, `${label}.description`);
      const mimeType = optionalString(object.mimeType, `${label}.mimeType`);
      const size = optionalNumber(object.size, `${label}.size`);
      return {
        type: "resource_link",
        uri: requireString(object.uri, `${label}.uri`),
        name: requireString(object.name, `${label}.name`),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(mimeType !== undefined ? { mimeType } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(icons ? { icons } : {}),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    }
    default:
      return { type: "unknown", mcpType: type, raw: object };
  }
}

function decodeContent(value: KotaJsonValue | undefined): McpToolContentBlock[] {
  if (!Array.isArray(value)) {
    throw new Error("Malformed MCP tools/call result: content must be an array");
  }
  return value.map(decodeMcpContentBlock);
}

function toResultText(content: McpToolContentBlock[]): string {
  const text = content
    .filter((block): block is McpToolTextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return text || "(no output)";
}

function toToolResultBlock(block: McpToolContentBlock): ToolResultBlock {
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

function decodeCompleteResultFields(object: KotaJsonObject): McpCompleteResultFields {
  const content = decodeContent(object.content);
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

function decodeInputRequests(value: KotaJsonValue | undefined): McpToolInputRequests {
  const object = requireJsonObject(value, "inputRequests");
  const decoded: { [requestId: string]: McpToolInputRequest } = {};
  for (const [requestId, rawRequest] of Object.entries(object)) {
    const label = `inputRequests.${requestId}`;
    const request = optionalJsonObject(rawRequest, label);
    if (!request) {
      throw malformedMcpResult("tools/call", label, "an object");
    }
    decoded[requestId] = {
      ...request,
      method: requireString(request.method, `${label}.method`),
      params: requireJsonObject(request.params, `${label}.params`),
    };
  }
  if (Object.keys(decoded).length === 0) {
    throw new Error(
      "Malformed MCP tools/call result: inputRequests must include at least one request",
    );
  }
  return decoded as McpToolInputRequests;
}

export function decodeMcpToolInputResponses(
  value: KotaJsonValue | undefined,
): McpToolInputResponses {
  const object = requireJsonObject(value, "inputResponses");
  const decoded: { [requestId: string]: McpToolInputResponse } = {};
  for (const [requestId, rawResponse] of Object.entries(object)) {
    const label = `inputResponses.${requestId}`;
    const response = optionalJsonObject(rawResponse, label);
    if (!response) {
      throw malformedMcpResult("tools/call", label, "an object");
    }
    const action = requireString(response.action, `${label}.action`);
    if (action !== "accept" && action !== "reject" && action !== "cancel") {
      throw new Error(
        `Malformed MCP tools/call result: ${label}.action must be accept, reject, or cancel`,
      );
    }
    const content = optionalJsonObject(response.content, `${label}.content`);
    if (action === "accept" && !content) {
      throw new Error(
        `Malformed MCP tools/call result: ${label}.content must be an object when action is accept`,
      );
    }
    decoded[requestId] = {
      ...response,
      action,
      ...(content ? { content } : {}),
    };
  }
  if (Object.keys(decoded).length === 0) {
    throw new Error(
      "Malformed MCP tools/call result: inputResponses must include at least one response",
    );
  }
  return decoded as McpToolInputResponses;
}

function decodeInputRequiredResult(
  object: KotaJsonObject,
  protocolVersion: McpProtocolVersion,
): McpInputRequiredCallToolResult {
  const inputRequests = object.inputRequests === undefined
    ? undefined
    : decodeInputRequests(object.inputRequests);
  const requestState = optionalString(object.requestState, "requestState");
  const meta = optionalJsonObject(object._meta, "_meta");
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
    "Malformed MCP tools/call result: input_required must include inputRequests or requestState",
  );
}

function decodeCallToolResult(
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
    return decodeInputRequiredResult(object, protocolVersion);
  }
  throw new Error(
    'Malformed MCP tools/call result: resultType must be "complete" or "input_required"',
  );
}

function isUnsupportedProtocolVersionError(err: Error): boolean {
  return /MCP error -32602: Unsupported protocol version/.test(err.message);
}

/**
 * Lightweight MCP client using JSON-RPC 2.0 over stdio.
 * Handles the MCP lifecycle: initialize → list tools → call tools → close.
 */
export class McpClient {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private connected = false;
  private connecting = false;
  private closing = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private serverName: string;
  private protocolVersion: McpProtocolVersion | null = null;
  private toolResultContract: McpToolResultContract | null = null;
  private toolsListChanged = false;
  private toolListSubscriptionId: number | null = null;
  private streamingRequestIds = new Set<number>();
  private toolListChangedHandlers = new Set<McpToolListChangedHandler>();

  constructor(
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {},
    name?: string,
  ) {
    this.serverName = name || command;
  }

  getName(): string {
    return this.serverName;
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

  onToolListChanged(handler: McpToolListChangedHandler): () => void {
    this.toolListChangedHandlers.add(handler);
    return () => {
      this.toolListChangedHandlers.delete(handler);
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Spawn the server process and complete the MCP handshake. */
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
      this.proc = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.env },
      });

      this.proc.on("error", (err) => {
        this.rejectAll(new Error(`MCP server "${this.serverName}" failed: ${err.message}`));
        this.connected = false;
      });

      this.proc.on("exit", (code) => {
        this.rejectAll(new Error(`MCP server "${this.serverName}" exited with code ${code}`));
        this.connected = false;
      });

      // Absorb stdin write errors (server may have exited)
      this.proc.stdin?.on("error", () => {});

      // Capture stderr for diagnostics but don't block
      this.proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) console.error(`[mcp:${this.serverName}] ${text}`);
      });

      this.rl = createInterface({ input: this.proc.stdout! });
      this.rl.on("line", (line) => this.handleLine(line));

      const result = await this.initializeServer();

      // Send initialized notification
      this.notify("notifications/initialized");

      // close() may have been called during the handshake await
      if (this.closing) {
        throw new Error(`MCP server "${this.serverName}" was closed during connection`);
      }

      if (result.serverInfo?.name) {
        this.serverName = result.serverInfo.name;
      }
      this.protocolVersion = result.protocolVersion;
      this.toolResultContract = result.protocolVersion === MCP_DRAFT_PROTOCOL_VERSION
        ? "draft-tool-result"
        : "legacy-content";
      this.toolsListChanged = result.toolsListChanged;
      this.connected = true;
      if (this.toolsListChanged && result.protocolVersion === MCP_DRAFT_PROTOCOL_VERSION) {
        this.openToolListChangedSubscription();
      }
    } finally {
      this.connecting = false;
    }
  }

  /** List available tools from the server. */
  async listTools(): Promise<McpToolSchema[]> {
    const tools: McpToolSchema[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const result = await this.request(
        "tools/list",
        cursor !== undefined ? { cursor } : undefined,
      );
      let page: McpListToolsPage;
      try {
        page = decodeListToolsResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `MCP tools/list failed for server "${this.serverName}": ${message}`,
        );
      }
      for (const rejected of page.rejectedTools) {
        warnRejectedTool(this.serverName, rejected);
      }
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(
            `Malformed MCP tools/list result from server "${this.serverName}": repeated nextCursor`,
          );
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);

    return tools;
  }

  /** Call a tool on the server. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    retry?: McpCallToolRetry,
  ): Promise<McpCallToolResult> {
    const params: JsonRpcRequest["params"] = { name, arguments: args };
    if (retry) {
      if (retry.requestState === undefined && retry.inputResponses === undefined) {
        throw new Error(
          "Malformed MCP tools/call retry: must include inputResponses or requestState",
        );
      }
      if (retry.requestState !== undefined) {
        if (retry.requestState.length === 0) {
          throw new Error("Malformed MCP tools/call retry: requestState must be a non-empty string");
        }
        params.requestState = retry.requestState;
      }
      if (retry.inputResponses !== undefined) {
        params.inputResponses = decodeMcpToolInputResponses(retry.inputResponses);
      }
    }
    const result = await this.request("tools/call", params, CALL_TIMEOUT);
    return decodeCallToolResult(result, this.protocolVersion ?? MCP_LEGACY_PROTOCOL_VERSION);
  }

  /** Gracefully shut down the server. */
  async close(): Promise<void> {
    if (!this.proc || this.closing) return;
    this.closing = true;
    this.connected = false;
    this.rejectAll(new Error(`MCP server "${this.serverName}" is closing`));
    this.streamingRequestIds.clear();
    this.toolListSubscriptionId = null;
    this.toolListChangedHandlers.clear();

    const proc = this.proc;
    this.proc = null;
    this.rl?.close();
    this.rl = null;

    try {
      // Attempt graceful shutdown if stdin is still writable
      if (proc.stdin?.writable) {
        const id = this.nextId++;
        const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method: "shutdown" };
        proc.stdin.write(`${JSON.stringify(msg)}\n`);
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        const exitMsg: JsonRpcNotification = { jsonrpc: "2.0", method: "exit" };
        proc.stdin.write(`${JSON.stringify(exitMsg)}\n`);
      }
    } catch {
      // Server may not support graceful shutdown
    }

    proc.kill("SIGTERM");
    this.killTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      this.killTimer = null;
    }, 3_000);

    // Cancel the SIGKILL timer if the process exits promptly
    proc.on("exit", () => {
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
    });
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as JsonRpcIncomingMessage;
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
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

  private handleStreamingRequestResponse(msg: JsonRpcIncomingMessage): void {
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

  private handleNotification(msg: JsonRpcIncomingMessage): void {
    if (msg.method !== "notifications/tools/list_changed") return;
    if (!this.isToolListChangedNotificationForThisClient(msg.params)) return;
    for (const handler of this.toolListChangedHandlers) {
      handler();
    }
  }

  private isToolListChangedNotificationForThisClient(
    params: JsonRpcNotification["params"],
  ): boolean {
    if (this.toolListSubscriptionId === null) return true;
    const meta = params ? params._meta : undefined;
    if (!isJsonObject(meta)) return true;
    const subscriptionId = meta["io.modelcontextprotocol/subscriptionId"];
    if (subscriptionId === undefined) return true;
    return String(subscriptionId) === String(this.toolListSubscriptionId);
  }

  private async initializeServer(): Promise<McpInitializeResult> {
    try {
      return await this.requestInitialize(MCP_DRAFT_PROTOCOL_VERSION);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (!isUnsupportedProtocolVersionError(error)) throw err;
      return await this.requestInitialize(MCP_LEGACY_PROTOCOL_VERSION);
    }
  }

  private async requestInitialize(
    protocolVersion: McpProtocolVersion,
  ): Promise<McpInitializeResult> {
    const result = await this.request("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "kota", version: "0.1.0" },
    });
    return decodeInitializeResult(result);
  }

  private request(
    method: string,
    params?: Record<string, unknown>,
    timeout = CONNECT_TIMEOUT,
  ): Promise<unknown> {
    if (!this.proc?.stdin?.writable) {
      return Promise.reject(
        new Error(`MCP server "${this.serverName}" is not connected`),
      );
    }

    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params && { params }) };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.proc?.stdin?.write(`${JSON.stringify(msg)}\n`);
    });
  }

  private openToolListChangedSubscription(): void {
    if (!this.proc?.stdin?.writable || this.toolListSubscriptionId !== null) return;
    const id = this.nextId++;
    this.toolListSubscriptionId = id;
    this.streamingRequestIds.add(id);
    const msg: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "subscriptions/listen",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": this.protocolVersion,
          "io.modelcontextprotocol/clientInfo": { name: "kota", version: "0.1.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
        notifications: { toolsListChanged: true },
      },
    };
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    if (!this.proc?.stdin?.writable) return;
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, ...(params && { params }) };
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private rejectAll(error: Error): void {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }
}
