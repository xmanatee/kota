import { Buffer } from "node:buffer";
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

type JsonRpcParams = JsonRpcRequest["params"];
type JsonRpcResult = JsonRpcResponse["result"];
type JsonRpcIncomingMessage = Partial<JsonRpcNotification & JsonRpcResponse>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type McpResultKind = "initialize" | "server/discover" | "tools/call" | "tools/list";
export type McpProgressToken = string | number;
export type McpProgressEvent = {
  requestId: number;
  progressToken: McpProgressToken;
  progress: number;
  sequence: number;
  total?: number;
  message?: string;
};
export type McpProgressHandler = (event: McpProgressEvent) => void;
export type McpRequestProgressOptions = {
  onProgress: McpProgressHandler;
  token?: McpProgressToken;
  maxEvents?: number;
};
export type McpCallToolOptions = {
  progress?: McpRequestProgressOptions;
};
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

export type McpElicitationMode = "form" | "url";

export type McpToolInputResponse = KotaJsonObject & {
  action: "accept" | "decline" | "cancel";
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
  ({
      requestState: string;
      inputResponses?: McpToolInputResponses;
    }
  | {
      requestState?: string;
      inputResponses: McpToolInputResponses;
    }) & {
      inputRequests?: McpToolInputRequests;
    };

const CONNECT_TIMEOUT = 10_000;
const CALL_TIMEOUT = 120_000;
const DEFAULT_MAX_PROGRESS_EVENTS = 20;
const MAX_PROGRESS_WARNINGS = 20;
const MCP_HEADER_ANNOTATION = "x-mcp-header";
const KOTA_MCP_CLIENT_INFO = { name: "kota", version: "0.1.0" } as const;
const MCP_META_PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const MCP_META_CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const MCP_META_CLIENT_CAPABILITIES_KEY =
  "io.modelcontextprotocol/clientCapabilities";

export type McpClientOptions = {
  supportedElicitationModes?: readonly McpElicitationMode[];
};

export type McpStdioClientTransportConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpStreamableHttpClientTransportConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpClientTransportConfig =
  | McpStdioClientTransportConfig
  | McpStreamableHttpClientTransportConfig;

type NormalizedMcpClientTransport =
  | (McpStdioClientTransportConfig & { type: "stdio" })
  | McpStreamableHttpClientTransportConfig;

export class McpConnectionError extends Error {
  readonly name = "McpConnectionError";

  constructor(
    readonly serverName: string,
    readonly method: string,
    message: string,
  ) {
    super(`MCP connection error for server "${serverName}" during ${method}: ${message}`);
  }
}

export class McpToolError extends Error {
  readonly name = "McpToolError";

  constructor(
    readonly serverName: string,
    readonly method: string,
    message: string,
  ) {
    super(`MCP tool error for server "${serverName}" during ${method}: ${message}`);
  }
}

export function mcpToolInputRequestElicitationMode(
  request: McpToolInputRequest,
): McpElicitationMode | null {
  if (request.method !== "elicitation/create") return null;
  return request.params.mode === "url" ? "url" : "form";
}

export function mcpToolUrlElicitationDetails(
  request: McpToolInputRequest,
): { message: string; url: string; elicitationId: string } | null {
  if (mcpToolInputRequestElicitationMode(request) !== "url") return null;
  const { message, url, elicitationId } = request.params;
  if (
    typeof message !== "string" ||
    typeof url !== "string" ||
    typeof elicitationId !== "string"
  ) {
    return null;
  }
  return { message, url, elicitationId };
}

function uniqueSupportedElicitationModes(
  modes: readonly McpElicitationMode[] | undefined,
): readonly McpElicitationMode[] {
  if (!modes) return [];
  const supported = new Set<McpElicitationMode>();
  for (const mode of modes) {
    if (mode !== "form" && mode !== "url") {
      throw new Error(`Unsupported MCP elicitation mode: ${String(mode)}`);
    }
    supported.add(mode);
  }
  return [...supported];
}

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

type ActiveProgressRequest = {
  requestId: number;
  progressToken: McpProgressToken;
  lastProgress: number | null;
  sequence: number;
  maxEvents: number;
  droppedEvents: number;
  dropWarningEmitted: boolean;
  onProgress: McpProgressHandler;
};

type McpHeaderParameterSpec = {
  paramName: string;
  headerName: string;
};

function decodeToolsListChangedCapability(
  capabilities: KotaJsonObject | undefined,
  kind: McpResultKind,
): boolean {
  const toolsCapability = capabilities
    ? optionalJsonObject(capabilities.tools, "capabilities.tools", kind)
    : undefined;
  return toolsCapability
    ? optionalBoolean(
      toolsCapability.listChanged,
      "capabilities.tools.listChanged",
      kind,
    ) === true
    : false;
}

function isMcpProtocolVersion(value: string): value is McpProtocolVersion {
  return value === MCP_DRAFT_PROTOCOL_VERSION || value === MCP_LEGACY_PROTOCOL_VERSION;
}

function isMcpProgressToken(value: KotaJsonValue | undefined): value is McpProgressToken {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

function progressTokenKey(token: McpProgressToken): string {
  return `${typeof token}:${String(token)}`;
}

function generatedProgressToken(requestId: number): McpProgressToken {
  return `kota-progress-${requestId}`;
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
  const toolsListChanged = decodeToolsListChangedCapability(capabilities, "initialize");
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

function decodeDiscoverResult(value: JsonRpcResponse["result"]): McpInitializeResult {
  const object = requireJsonObject(value, "result", "server/discover");
  const supportedVersions = optionalStringArray(
    object.supportedVersions,
    "supportedVersions",
    "server/discover",
  );
  if (!supportedVersions?.includes(MCP_DRAFT_PROTOCOL_VERSION)) {
    throw new Error(
      `Malformed MCP server/discover result: supportedVersions must include ${MCP_DRAFT_PROTOCOL_VERSION}`,
    );
  }
  const capabilities = optionalJsonObject(
    object.capabilities,
    "capabilities",
    "server/discover",
  );
  const toolsListChanged = decodeToolsListChangedCapability(
    capabilities,
    "server/discover",
  );
  const rawServerInfo = optionalJsonObject(
    object.serverInfo,
    "serverInfo",
    "server/discover",
  );
  const name = rawServerInfo
    ? optionalString(rawServerInfo.name, "serverInfo.name", "server/discover")
    : undefined;
  return {
    protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
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

function collectMcpHeaderParameters(tool: McpToolSchema): McpHeaderParameterSpec[] {
  const specs: McpHeaderParameterSpec[] = [];
  for (const [paramName, rawPropertySchema] of Object.entries(tool.inputSchema.properties)) {
    if (!isJsonObject(rawPropertySchema)) continue;
    const headerName = rawPropertySchema[MCP_HEADER_ANNOTATION];
    if (typeof headerName !== "string") continue;
    if (!isPrimitiveHeaderPropertyType(rawPropertySchema.type)) continue;
    specs.push({ paramName, headerName });
  }
  return specs;
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

function isPlainMcpParamHeaderValue(value: string): boolean {
  if (value.length === 0 || value.trim() !== value) return false;
  if (value.startsWith("=?base64?") && value.endsWith("?=")) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code !== 0x09 && (code < 0x20 || code > 0x7e)) return false;
  }
  return true;
}

function mcpParamHeaderValue(value: KotaJsonValue | undefined): string | null {
  let raw: string;
  if (typeof value === "string") {
    raw = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    raw = String(value);
  } else if (typeof value === "boolean") {
    raw = value ? "true" : "false";
  } else {
    return null;
  }
  if (isPlainMcpParamHeaderValue(raw)) return raw;
  return `=?base64?${Buffer.from(raw, "utf8").toString("base64")}?=`;
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
    const method = requireString(request.method, `${label}.method`);
    const params = requireJsonObject(request.params, `${label}.params`);
    if (method === "elicitation/create") {
      const mode = params.mode === undefined
        ? "form"
        : requireString(params.mode, `${label}.params.mode`);
      if (mode !== "form" && mode !== "url") {
        throw new Error(
          `Malformed MCP tools/call result: ${label}.params.mode must be form or url`,
        );
      }
      requireString(params.message, `${label}.params.message`);
      if (mode === "url") {
        requireString(params.url, `${label}.params.url`);
        requireString(params.elicitationId, `${label}.params.elicitationId`);
      }
    }
    decoded[requestId] = {
      ...request,
      method,
      params,
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
  inputRequests?: McpToolInputRequests,
): McpToolInputResponses {
  const object = requireJsonObject(value, "inputResponses");
  const decoded: { [requestId: string]: McpToolInputResponse } = {};
  for (const [requestId, rawResponse] of Object.entries(object)) {
    const label = `inputResponses.${requestId}`;
    const response = optionalJsonObject(rawResponse, label);
    if (!response) {
      throw malformedMcpResult("tools/call", label, "an object");
    }
    const rawAction = requireString(response.action, `${label}.action`);
    if (
      rawAction !== "accept" &&
      rawAction !== "decline" &&
      rawAction !== "cancel" &&
      rawAction !== "reject"
    ) {
      throw new Error(
        `Malformed MCP tools/call result: ${label}.action must be accept, decline, or cancel`,
      );
    }
    // Older draft examples used `reject`; accept that operator-facing alias
    // narrowly, but normalize before sending current draft inputResponses.
    const action = rawAction === "reject" ? "decline" : rawAction;
    const inputRequest = inputRequests?.[requestId];
    if (inputRequests && !inputRequest) {
      throw new Error(
        `Malformed MCP tools/call result: ${label} does not match an input request`,
      );
    }
    const mode = inputRequest
      ? mcpToolInputRequestElicitationMode(inputRequest)
      : null;
    const content = optionalJsonObject(response.content, `${label}.content`);
    if (mode === "url" && content !== undefined) {
      throw new Error(
        `Malformed MCP tools/call result: ${label}.content must be omitted for URL-mode response`,
      );
    }
    if (mode === "url") {
      const unexpectedKeys = Object.keys(response).filter((key) => key !== "action");
      if (unexpectedKeys.length > 0) {
        throw new Error(
          `Malformed MCP tools/call result: ${label} must include only action for URL-mode response`,
        );
      }
      decoded[requestId] = { action };
      continue;
    }
    if (action === "accept" && !content) {
      throw new Error(
        `Malformed MCP tools/call result: ${label}.content must be an object when action is accept`,
      );
    }
    decoded[requestId] = {
      action,
      ...(content !== undefined ? { content } : {}),
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

function normalizeClientTransportConfig(
  config: McpClientTransportConfig,
): NormalizedMcpClientTransport {
  if (config.type === "http") {
    const url = new URL(config.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("MCP HTTP transport URL must use http or https");
    }
    return {
      type: "http",
      url: url.toString(),
      ...(config.headers ? { headers: { ...config.headers } } : {}),
    };
  }
  return {
    type: "stdio",
    command: config.command,
    ...(config.args ? { args: [...config.args] } : {}),
    ...(config.env ? { env: { ...config.env } } : {}),
  };
}

/**
 * Lightweight MCP client using JSON-RPC 2.0 over stdio or Streamable HTTP.
 * Handles the MCP lifecycle: initialize → list tools → call tools → close.
 */
export class McpClient {
  private readonly transport: NormalizedMcpClientTransport;
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
  private activeProgressByRequestId = new Map<number, string>();
  private activeProgressByToken = new Map<string, ActiveProgressRequest>();
  private progressWarningCount = 0;
  private readonly headerParametersByTool = new Map<string, McpHeaderParameterSpec[]>();
  private readonly supportedElicitationModes: readonly McpElicitationMode[];

  constructor(
    command: string,
    args?: string[],
    env?: Record<string, string>,
    name?: string,
    options?: McpClientOptions,
  );
  constructor(
    transport: McpClientTransportConfig,
    name?: string,
    options?: McpClientOptions,
  );
  constructor(
    commandOrTransport: string | McpClientTransportConfig,
    argsOrName: string[] | string = [],
    envOrOptions: Record<string, string> | McpClientOptions = {},
    name?: string,
    options: McpClientOptions = {},
  ) {
    let resolvedOptions: McpClientOptions;
    if (typeof commandOrTransport === "string") {
      const args = Array.isArray(argsOrName) ? argsOrName : [];
      const env = envOrOptions as Record<string, string>;
      this.transport = {
        type: "stdio",
        command: commandOrTransport,
        args,
        env,
      };
      this.serverName = name || commandOrTransport;
      resolvedOptions = options;
    } else {
      this.transport = normalizeClientTransportConfig(commandOrTransport);
      const explicitName = typeof argsOrName === "string" ? argsOrName : undefined;
      this.serverName = explicitName || this.defaultServerNameForTransport();
      resolvedOptions = envOrOptions as McpClientOptions;
    }
    this.supportedElicitationModes = uniqueSupportedElicitationModes(
      resolvedOptions.supportedElicitationModes,
    );
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
      if (this.transport.type === "http") {
        await this.connectHttp();
      } else {
        await this.connectStdio();
      }
    } finally {
      this.connecting = false;
    }
  }

  private async connectStdio(): Promise<void> {
    if (this.transport.type !== "stdio") return;
    this.proc = spawn(this.transport.command, this.transport.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(this.transport.env ?? {}) },
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
  }

  private async connectHttp(): Promise<void> {
    this.protocolVersion = MCP_DRAFT_PROTOCOL_VERSION;
    this.toolResultContract = "draft-tool-result";
    let result: McpInitializeResult;
    try {
      result = decodeDiscoverResult(await this.request("server/discover"));
    } catch (err) {
      if (err instanceof McpConnectionError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw this.requestErrorForMethod("server/discover", message);
    }

    if (this.closing) {
      throw new Error(`MCP server "${this.serverName}" was closed during connection`);
    }

    if (result.serverInfo?.name) {
      this.serverName = result.serverInfo.name;
    }
    if (result.toolsListChanged) {
      throw this.requestErrorForMethod(
        "server/discover",
        "tools.listChanged requires a long-lived subscriptions/listen stream, which is not implemented for Streamable HTTP client connections",
      );
    }
    this.protocolVersion = result.protocolVersion;
    this.toolResultContract = "draft-tool-result";
    this.toolsListChanged = result.toolsListChanged;
    this.connected = true;
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

    this.cacheHeaderParameters(tools);
    return tools;
  }

  /** Call a tool on the server. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    retry?: McpCallToolRetry,
    options: McpCallToolOptions = {},
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
        params.inputResponses = decodeMcpToolInputResponses(
          retry.inputResponses,
          retry.inputRequests,
        );
      }
    }
    const result = await this.request("tools/call", params, CALL_TIMEOUT, options.progress);
    return decodeCallToolResult(result, this.protocolVersion ?? MCP_LEGACY_PROTOCOL_VERSION);
  }

  /** Gracefully shut down the server. */
  async close(): Promise<void> {
    if (this.transport.type === "http") {
      if (this.closing) return;
      this.closing = true;
      this.connected = false;
      this.streamingRequestIds.clear();
      this.clearAllProgress();
      this.toolListSubscriptionId = null;
      this.toolListChangedHandlers.clear();
      return;
    }
    if (!this.proc || this.closing) return;
    this.closing = true;
    this.connected = false;
    this.rejectAll(new Error(`MCP server "${this.serverName}" is closing`));
    this.streamingRequestIds.clear();
    this.clearAllProgress();
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
    if (msg.method === "notifications/progress") {
      this.handleProgressNotification(msg.params);
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

  private handleProgressNotification(params: JsonRpcNotification["params"]): void {
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

  private handleCancelledNotification(params: JsonRpcNotification["params"]): void {
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
      capabilities: this.clientCapabilitiesForProtocol(protocolVersion),
      clientInfo: KOTA_MCP_CLIENT_INFO,
    });
    return decodeInitializeResult(result);
  }

  private clientCapabilitiesForProtocol(
    protocolVersion: McpProtocolVersion | null = this.protocolVersion,
  ): KotaJsonObject {
    const capabilities: KotaJsonObject = {};
    if (
      protocolVersion === MCP_DRAFT_PROTOCOL_VERSION &&
      this.supportedElicitationModes.length > 0
    ) {
      const elicitation: KotaJsonObject = {};
      for (const mode of this.supportedElicitationModes) {
        elicitation[mode] = {};
      }
      capabilities.elicitation = elicitation;
    }
    return capabilities;
  }

  private draftRequestMeta(): KotaJsonObject {
    return {
      [MCP_META_PROTOCOL_VERSION_KEY]: this.protocolVersion ?? MCP_DRAFT_PROTOCOL_VERSION,
      [MCP_META_CLIENT_INFO_KEY]: KOTA_MCP_CLIENT_INFO,
      [MCP_META_CLIENT_CAPABILITIES_KEY]: this.clientCapabilitiesForProtocol(),
    };
  }

  private paramsWithDraftMetadata(
    params: JsonRpcParams,
    progressToken?: McpProgressToken,
  ): JsonRpcParams {
    if (this.protocolVersion !== MCP_DRAFT_PROTOCOL_VERSION) return params;
    const rawMeta = params?._meta;
    if (rawMeta !== undefined && !isJsonObject(rawMeta)) {
      throw new Error("Malformed MCP request params: _meta must be an object");
    }
    return {
      ...(params ?? {}),
      _meta: {
        ...(rawMeta ?? {}),
        ...(progressToken !== undefined ? { progressToken } : {}),
        ...this.draftRequestMeta(),
      },
    };
  }

  private request(
    method: string,
    params?: JsonRpcParams,
    timeout = CONNECT_TIMEOUT,
    progress?: McpRequestProgressOptions,
  ): Promise<JsonRpcResult> {
    if (this.transport.type === "http") {
      return this.httpRequest(method, params, timeout, progress);
    }
    return this.stdioRequest(method, params, timeout, progress);
  }

  private stdioRequest(
    method: string,
    params?: JsonRpcParams,
    timeout = CONNECT_TIMEOUT,
    progress?: McpRequestProgressOptions,
  ): Promise<JsonRpcResult> {
    if (!this.proc?.stdin?.writable) {
      return Promise.reject(
        new Error(`MCP server "${this.serverName}" is not connected`),
      );
    }

    const id = this.nextId++;
    let progressToken: McpProgressToken | undefined;
    if (progress && this.protocolVersion === MCP_DRAFT_PROTOCOL_VERSION) {
      progressToken = progress.token ?? generatedProgressToken(id);
    }
    const requestParams = this.paramsWithDraftMetadata(params, progressToken);
    const msg: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(requestParams && { params: requestParams }),
    };

    return new Promise((resolve, reject) => {
      if (progress && progressToken !== undefined) {
        try {
          this.trackProgressRequest(id, progressToken, progress);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.clearProgressForRequest(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.proc?.stdin?.write(`${JSON.stringify(msg)}\n`);
    });
  }

  private async httpRequest(
    method: string,
    params?: JsonRpcParams,
    timeout = CONNECT_TIMEOUT,
    progress?: McpRequestProgressOptions,
  ): Promise<JsonRpcResult> {
    if (progress) {
      throw this.requestErrorForMethod(
        method,
        "SSE progress streams are not implemented for Streamable HTTP",
      );
    }
    if (this.closing) {
      throw new Error(`MCP server "${this.serverName}" is closed`);
    }
    if (method !== "server/discover" && !this.connected) {
      throw new Error(`MCP server "${this.serverName}" is not connected`);
    }
    if (this.transport.type !== "http") {
      throw new Error(`MCP server "${this.serverName}" is not an HTTP transport`);
    }

    const id = this.nextId++;
    const requestParams = this.paramsWithDraftMetadata(params);
    const msg: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(requestParams && { params: requestParams }),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response: Response;
    try {
      response = await fetch(this.transport.url, {
        method: "POST",
        headers: this.httpHeadersForRequest(method, requestParams),
        body: JSON.stringify(msg),
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error && err.name === "AbortError"
        ? `request timed out after ${timeout}ms`
        : err instanceof Error ? err.message : String(err);
      throw this.requestErrorForMethod(method, message);
    } finally {
      clearTimeout(timer);
    }
    return await this.decodeHttpResponse(response, method, id);
  }

  private httpHeadersForRequest(
    method: string,
    params: JsonRpcParams,
  ): Headers {
    if (this.transport.type !== "http") {
      throw new Error(`MCP server "${this.serverName}" is not an HTTP transport`);
    }
    const headers = new Headers(this.transport.headers ?? {});
    headers.set("Accept", "application/json, text/event-stream");
    headers.set("Content-Type", "application/json");
    headers.set("MCP-Protocol-Version", this.protocolVersion ?? MCP_DRAFT_PROTOCOL_VERSION);
    headers.set("Mcp-Method", method);
    const name = this.httpMcpNameForRequest(method, params);
    if (name !== null) headers.set("Mcp-Name", name);
    this.setHttpParamHeaders(headers, method, params);
    return headers;
  }

  private cacheHeaderParameters(tools: readonly McpToolSchema[]): void {
    this.headerParametersByTool.clear();
    for (const tool of tools) {
      const specs = collectMcpHeaderParameters(tool);
      if (specs.length === 0) continue;
      this.headerParametersByTool.set(tool.name, specs);
    }
  }

  private setHttpParamHeaders(
    headers: Headers,
    method: string,
    params: JsonRpcParams,
  ): void {
    if (method !== "tools/call") return;
    const toolName = typeof params?.name === "string" ? params.name : null;
    if (toolName === null) return;
    const specs = this.headerParametersByTool.get(toolName);
    if (!specs) return;
    const args = isJsonObject(params?.arguments) ? params.arguments : {};
    for (const spec of specs) {
      const value = mcpParamHeaderValue(args[spec.paramName]);
      if (value === null) continue;
      headers.set(`Mcp-Param-${spec.headerName}`, value);
    }
  }

  private httpMcpNameForRequest(
    method: string,
    params: JsonRpcParams,
  ): string | null {
    if (method === "tools/call" || method === "prompts/get") {
      return typeof params?.name === "string" ? params.name : "";
    }
    if (method === "resources/read") {
      return typeof params?.uri === "string" ? params.uri : "";
    }
    return null;
  }

  private async decodeHttpResponse(
    response: Response,
    method: string,
    requestId: number,
  ): Promise<JsonRpcResult> {
    const text = await response.text();
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
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
    const message = contentType.includes("text/event-stream")
      ? this.parseSingleSseJsonRpcMessage(text, method)
      : this.parseJsonRpcHttpMessage(text, method);
    if (typeof message.id === "number" && message.id !== requestId) {
      throw this.requestErrorForMethod(
        method,
        `response id ${message.id} did not match request id ${requestId}`,
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
        `HTTP ${response.status}: ${text || response.statusText || "empty response"}`,
      );
    }
    return message.result;
  }

  private parseJsonRpcHttpMessage(text: string, method: string): JsonRpcIncomingMessage {
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

  private parseSingleSseJsonRpcMessage(
    text: string,
    method: string,
  ): JsonRpcIncomingMessage {
    const messages = this.parseSseDataMessages(text);
    if (messages.length !== 1) {
      throw this.requestErrorForMethod(
        method,
        "SSE response streams with zero or multiple messages are not implemented for Streamable HTTP",
      );
    }
    return this.parseJsonRpcHttpMessage(messages[0], method);
  }

  private parseSseDataMessages(text: string): string[] {
    const messages: string[] = [];
    let dataLines: string[] = [];
    const flush = () => {
      if (dataLines.length === 0) return;
      messages.push(dataLines.join("\n"));
      dataLines = [];
    };
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) {
        flush();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    flush();
    return messages;
  }

  private requestErrorForMethod(method: string, message: string): Error {
    if (method === "tools/call") {
      return new McpToolError(this.serverName, method, message);
    }
    return new McpConnectionError(this.serverName, method, message);
  }

  private defaultServerNameForTransport(): string {
    if (this.transport.type === "stdio") return this.transport.command;
    return this.transport.url;
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
        _meta: this.draftRequestMeta(),
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
    this.clearAllProgress();
  }

  private trackProgressRequest(
    requestId: number,
    progressToken: McpProgressToken,
    options: McpRequestProgressOptions,
  ): void {
    const key = progressTokenKey(progressToken);
    if (this.activeProgressByToken.has(key)) {
      throw new Error(`MCP progress token is already active: ${String(progressToken)}`);
    }
    const maxEvents = options.maxEvents ?? DEFAULT_MAX_PROGRESS_EVENTS;
    if (!Number.isInteger(maxEvents) || maxEvents <= 0) {
      throw new Error("MCP progress maxEvents must be a positive integer");
    }
    this.activeProgressByRequestId.set(requestId, key);
    this.activeProgressByToken.set(key, {
      requestId,
      progressToken,
      lastProgress: null,
      sequence: 0,
      maxEvents,
      droppedEvents: 0,
      dropWarningEmitted: false,
      onProgress: options.onProgress,
    });
  }

  private clearProgressForRequest(requestId: number): void {
    const key = this.activeProgressByRequestId.get(requestId);
    if (!key) return;
    this.activeProgressByRequestId.delete(requestId);
    this.activeProgressByToken.delete(key);
  }

  private clearAllProgress(): void {
    this.activeProgressByRequestId.clear();
    this.activeProgressByToken.clear();
  }

  private warnProgress(message: string): void {
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
