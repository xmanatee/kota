import { Buffer } from "node:buffer";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
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

export type McpResourceSchema = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  annotations?: KotaMcpAnnotations;
  size?: number;
  icons?: KotaMcpIcon[];
  _meta?: KotaJsonObject;
};

export type McpResourceTemplateSchema = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  annotations?: KotaMcpAnnotations;
  icons?: KotaMcpIcon[];
  _meta?: KotaJsonObject;
};

export type McpPromptArgumentSchema = {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
  _meta?: KotaJsonObject;
};

export type McpPromptSchema = {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgumentSchema[];
  _meta?: KotaJsonObject;
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

type McpResultKind =
  | "initialize"
  | "protected-resource-metadata"
  | "server/discover"
  | "tools/call"
  | "tools/list"
  | "resources/list"
  | "resources/templates/list"
  | "resources/read"
  | "prompts/list"
  | "prompts/get";
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
export type McpListToolsPage = {
  tools: McpToolSchema[];
  rejectedTools: McpRejectedToolDefinition[];
  nextCursor?: string;
  cache: McpCacheHints;
};

export type McpCacheScope = "public" | "private";

export type McpCacheHints = {
  ttlMs: number;
  cacheScope: McpCacheScope;
};

export type McpListResourcesPage = {
  resources: McpResourceSchema[];
  nextCursor?: string;
  cache: McpCacheHints;
};

export type McpListResourceTemplatesPage = {
  resourceTemplates: McpResourceTemplateSchema[];
  nextCursor?: string;
  cache: McpCacheHints;
};

export type McpListPromptsPage = {
  prompts: McpPromptSchema[];
  nextCursor?: string;
  cache: McpCacheHints;
};

export const MCP_LEGACY_PROTOCOL_VERSION = "2024-11-05";
export const MCP_DRAFT_PROTOCOL_VERSION = "DRAFT-2026-v1";

export type McpProtocolVersion =
  | typeof MCP_LEGACY_PROTOCOL_VERSION
  | typeof MCP_DRAFT_PROTOCOL_VERSION;

export type McpToolResultContract = "legacy-content" | "draft-tool-result";

export type McpToolListChangedHandler = () => void;
export type McpResourceListChangedHandler = () => void;
export type McpPromptListChangedHandler = () => void;

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

export type McpInputRequiredResult = McpInputRequiredCallToolResult;

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

export type McpOperationRetry = McpCallToolRetry;

export type McpReadResourceCompleteResult = {
  resultType: "complete";
  protocolVersion: McpProtocolVersion;
  contents: KotaMcpResourceContents[];
  cache: McpCacheHints;
  _meta?: KotaJsonObject;
};

export type McpReadResourceResult =
  | McpReadResourceCompleteResult
  | McpInputRequiredResult;

export type McpPromptMessage = {
  role: "user" | "assistant";
  content: McpToolContentBlock;
  _meta?: KotaJsonObject;
};

export type McpGetPromptCompleteResult = {
  resultType: "complete";
  protocolVersion: McpProtocolVersion;
  messages: McpPromptMessage[];
  description?: string;
  _meta?: KotaJsonObject;
};

export type McpGetPromptResult =
  | McpGetPromptCompleteResult
  | McpInputRequiredResult;

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

export type McpAuthorizationChallenge = {
  scheme: "Bearer";
  resourceMetadataUrl?: string;
  metadataDiscovery?: McpProtectedResourceMetadataDiscovery;
  scopes: string[];
  error?: string;
};

export type McpProtectedResourceMetadata = {
  resource: string;
  authorizationServers: string[];
  bearerMethodsSupported: string[];
  scopesSupported: string[];
};

export type McpProtectedResourceMetadataDiscovery =
  | {
      status: "found";
      url: string;
      metadata: McpProtectedResourceMetadata;
    }
  | {
      status: "unavailable";
      attemptedUrls: string[];
      error: string;
    };

export class McpAuthorizationError extends Error {
  readonly name = "McpAuthorizationError";

  constructor(
    readonly serverName: string,
    readonly method: string,
    readonly status: 401 | 403,
    readonly challenge: McpAuthorizationChallenge,
  ) {
    const details: string[] = [];
    if (challenge.error) details.push(`error=${challenge.error}`);
    if (challenge.resourceMetadataUrl) {
      details.push(`resource_metadata=${challenge.resourceMetadataUrl}`);
    }
    if (challenge.scopes.length > 0) {
      details.push(`scope=${challenge.scopes.join(" ")}`);
    }
    if (challenge.metadataDiscovery?.status === "found") {
      const { authorizationServers } = challenge.metadataDiscovery.metadata;
      if (authorizationServers.length > 0) {
        details.push(`authorization_servers=${authorizationServers.join(" ")}`);
      }
    }
    const reason = status === 403
      ? "insufficient authorization scope"
      : "authorization required";
    super(
      `MCP authorization failed for server "${serverName}" during ${method}: ` +
        `HTTP ${status} ${reason}${details.length > 0 ? ` (${details.join("; ")})` : ""}`,
    );
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

function parseWwwAuthenticateChallenge(
  header: string | null,
): McpAuthorizationChallenge | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer")) return null;
  const params = parseAuthenticateParams(trimmed.slice("bearer".length));
  const scopes = splitScopeParam(params.scope);
  return {
    scheme: "Bearer",
    scopes,
    ...(params.resource_metadata !== undefined && {
      resourceMetadataUrl: params.resource_metadata,
    }),
    ...(params.error !== undefined && { error: params.error }),
  };
}

function parseAuthenticateParams(value: string): Record<string, string> {
  const params: Record<string, string> = {};
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index] ?? "")) index += 1;
    const keyStart = index;
    while (index < value.length && /[A-Za-z0-9_-]/.test(value[index] ?? "")) index += 1;
    const key = value.slice(keyStart, index).toLowerCase();
    while (index < value.length && /\s/.test(value[index] ?? "")) index += 1;
    if (!key || value[index] !== "=") break;
    index += 1;
    while (index < value.length && /\s/.test(value[index] ?? "")) index += 1;
    const parsed = parseAuthenticateParamValue(value, index);
    if (!parsed) break;
    params[key] = parsed.value;
    index = parsed.nextIndex;
  }
  return params;
}

function parseAuthenticateParamValue(
  value: string,
  start: number,
): { value: string; nextIndex: number } | null {
  if (value[start] !== "\"") {
    let index = start;
    while (index < value.length && value[index] !== ",") index += 1;
    return { value: value.slice(start, index).trim(), nextIndex: index };
  }
  let index = start + 1;
  let out = "";
  while (index < value.length) {
    const char = value[index];
    if (char === "\"") {
      return { value: out, nextIndex: index + 1 };
    }
    if (char === "\\" && index + 1 < value.length) {
      out += value[index + 1];
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return null;
}

function splitScopeParam(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(/\s+/).filter((scope) => scope.length > 0);
}

function protectedResourceMetadataWellKnownUrls(resourceUrl: string): string[] {
  const url = new URL(resourceUrl);
  const basePath = url.pathname === "/"
    ? ""
    : url.pathname.replace(/\/+$/, "");
  const candidates = [
    new URL(`/.well-known/oauth-protected-resource${basePath}`, url.origin).toString(),
    new URL("/.well-known/oauth-protected-resource", url.origin).toString(),
  ];
  return [...new Set(candidates)];
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

function requireStringArray(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw malformedMcpResult(kind, label, "a string array");
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

function decodeCacheHints(
  object: KotaJsonObject,
  kind: McpResultKind,
): McpCacheHints {
  const rawTtlMs = optionalNumber(object.ttlMs, "ttlMs", kind);
  if (rawTtlMs !== undefined && !Number.isFinite(rawTtlMs)) {
    throw malformedMcpResult(kind, "ttlMs", "a finite number");
  }
  const rawCacheScope = object.cacheScope;
  let cacheScope: McpCacheScope = "private";
  if (rawCacheScope !== undefined) {
    if (rawCacheScope !== "public" && rawCacheScope !== "private") {
      throw new Error(
        `Malformed MCP ${kind} result: cacheScope must be "public" or "private"`,
      );
    }
    cacheScope = rawCacheScope;
  }
  return {
    ttlMs: rawTtlMs === undefined ? 0 : Math.max(0, rawTtlMs),
    cacheScope,
  };
}

type McpInitializeResult = {
  protocolVersion: McpProtocolVersion;
  toolsSupported: boolean;
  toolsListChanged: boolean;
  resourcesSupported: boolean;
  resourcesListChanged: boolean;
  promptsSupported: boolean;
  promptsListChanged: boolean;
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

function decodeListChangedCapability(
  capabilities: KotaJsonObject | undefined,
  capabilityName: "tools" | "resources" | "prompts",
  kind: McpResultKind,
): { supported: boolean; listChanged: boolean } {
  const rawCapability = capabilities ? capabilities[capabilityName] : undefined;
  const capability = rawCapability !== undefined
    ? optionalJsonObject(rawCapability, `capabilities.${capabilityName}`, kind)
    : undefined;
  return {
    supported: capability !== undefined,
    listChanged: capability
      ? optionalBoolean(
        capability.listChanged,
        `capabilities.${capabilityName}.listChanged`,
        kind,
      ) === true
      : false,
  };
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
  const tools = decodeListChangedCapability(capabilities, "tools", "initialize");
  const resources = decodeListChangedCapability(capabilities, "resources", "initialize");
  const prompts = decodeListChangedCapability(capabilities, "prompts", "initialize");
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
    toolsSupported: protocolVersion === MCP_LEGACY_PROTOCOL_VERSION || tools.supported,
    toolsListChanged: tools.listChanged,
    resourcesSupported: resources.supported,
    resourcesListChanged: resources.listChanged,
    promptsSupported: prompts.supported,
    promptsListChanged: prompts.listChanged,
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
  const tools = decodeListChangedCapability(capabilities, "tools", "server/discover");
  const resources = decodeListChangedCapability(capabilities, "resources", "server/discover");
  const prompts = decodeListChangedCapability(capabilities, "prompts", "server/discover");
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
    toolsSupported: tools.supported,
    toolsListChanged: tools.listChanged,
    resourcesSupported: resources.supported,
    resourcesListChanged: resources.listChanged,
    promptsSupported: prompts.supported,
    promptsListChanged: prompts.listChanged,
    ...(rawServerInfo ? { serverInfo: { ...(name !== undefined ? { name } : {}) } } : {}),
  };
}

function decodeProtectedResourceMetadata(
  value: JsonRpcResult,
): McpProtectedResourceMetadata {
  const object = requireJsonObject(value, "metadata", "protected-resource-metadata");
  return {
    resource: requireString(
      object.resource,
      "resource",
      "protected-resource-metadata",
    ),
    authorizationServers: requireStringArray(
      object.authorization_servers,
      "authorization_servers",
      "protected-resource-metadata",
    ),
    bearerMethodsSupported: optionalStringArray(
      object.bearer_methods_supported,
      "bearer_methods_supported",
      "protected-resource-metadata",
    ) ?? [],
    scopesSupported: optionalStringArray(
      object.scopes_supported,
      "scopes_supported",
      "protected-resource-metadata",
    ) ?? [],
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
    cache: decodeCacheHints(object, "tools/list"),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

function decodeResourceDefinition(
  value: KotaJsonValue,
  index: number,
): McpResourceSchema {
  const label = `resources[${index}]`;
  const object = optionalJsonObject(value, label, "resources/list");
  if (!object) {
    throw malformedMcpResult("resources/list", label, "an object");
  }
  const title = optionalString(object.title, `${label}.title`, "resources/list");
  const description = optionalString(
    object.description,
    `${label}.description`,
    "resources/list",
  );
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`, "resources/list");
  const annotations = decodeAnnotations(
    object.annotations,
    `${label}.annotations`,
    "resources/list",
  );
  const size = optionalNumber(object.size, `${label}.size`, "resources/list");
  const icons = decodeIcons(object.icons, `${label}.icons`, "resources/list");
  const meta = optionalJsonObject(object._meta, `${label}._meta`, "resources/list");
  return {
    uri: requireString(object.uri, `${label}.uri`, "resources/list"),
    name: requireString(object.name, `${label}.name`, "resources/list"),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(annotations ? { annotations } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(icons ? { icons } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeListResourcesResult(value: JsonRpcResponse["result"]): McpListResourcesPage {
  const object = requireJsonObject(value, "result", "resources/list");
  if (!Array.isArray(object.resources)) {
    throw malformedMcpResult("resources/list", "resources", "an array");
  }
  const nextCursor = optionalString(object.nextCursor, "nextCursor", "resources/list");
  return {
    resources: object.resources.map(decodeResourceDefinition),
    cache: decodeCacheHints(object, "resources/list"),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

function decodeResourceTemplateDefinition(
  value: KotaJsonValue,
  index: number,
): McpResourceTemplateSchema {
  const label = `resourceTemplates[${index}]`;
  const object = optionalJsonObject(value, label, "resources/templates/list");
  if (!object) {
    throw malformedMcpResult("resources/templates/list", label, "an object");
  }
  const title = optionalString(
    object.title,
    `${label}.title`,
    "resources/templates/list",
  );
  const description = optionalString(
    object.description,
    `${label}.description`,
    "resources/templates/list",
  );
  const mimeType = optionalString(
    object.mimeType,
    `${label}.mimeType`,
    "resources/templates/list",
  );
  const annotations = decodeAnnotations(
    object.annotations,
    `${label}.annotations`,
    "resources/templates/list",
  );
  const icons = decodeIcons(object.icons, `${label}.icons`, "resources/templates/list");
  const meta = optionalJsonObject(object._meta, `${label}._meta`, "resources/templates/list");
  return {
    uriTemplate: requireString(
      object.uriTemplate,
      `${label}.uriTemplate`,
      "resources/templates/list",
    ),
    name: requireString(object.name, `${label}.name`, "resources/templates/list"),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(annotations ? { annotations } : {}),
    ...(icons ? { icons } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeListResourceTemplatesResult(
  value: JsonRpcResponse["result"],
): McpListResourceTemplatesPage {
  const object = requireJsonObject(value, "result", "resources/templates/list");
  if (!Array.isArray(object.resourceTemplates)) {
    throw malformedMcpResult(
      "resources/templates/list",
      "resourceTemplates",
      "an array",
    );
  }
  const nextCursor = optionalString(
    object.nextCursor,
    "nextCursor",
    "resources/templates/list",
  );
  return {
    resourceTemplates: object.resourceTemplates.map(decodeResourceTemplateDefinition),
    cache: decodeCacheHints(object, "resources/templates/list"),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

function decodePromptArgumentDefinition(
  value: KotaJsonValue,
  index: number,
): McpPromptArgumentSchema {
  const label = `arguments[${index}]`;
  const object = optionalJsonObject(value, label, "prompts/list");
  if (!object) {
    throw malformedMcpResult("prompts/list", label, "an object");
  }
  const title = optionalString(object.title, `${label}.title`, "prompts/list");
  const description = optionalString(object.description, `${label}.description`, "prompts/list");
  const required = optionalBoolean(object.required, `${label}.required`, "prompts/list");
  const meta = optionalJsonObject(object._meta, `${label}._meta`, "prompts/list");
  return {
    name: requireString(object.name, `${label}.name`, "prompts/list"),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodePromptDefinition(value: KotaJsonValue, index: number): McpPromptSchema {
  const label = `prompts[${index}]`;
  const object = optionalJsonObject(value, label, "prompts/list");
  if (!object) {
    throw malformedMcpResult("prompts/list", label, "an object");
  }
  const title = optionalString(object.title, `${label}.title`, "prompts/list");
  const description = optionalString(object.description, `${label}.description`, "prompts/list");
  const args = object.arguments === undefined
    ? undefined
    : Array.isArray(object.arguments)
      ? object.arguments.map(decodePromptArgumentDefinition)
      : null;
  if (args === null) {
    throw malformedMcpResult("prompts/list", `${label}.arguments`, "an array");
  }
  const meta = optionalJsonObject(object._meta, `${label}._meta`, "prompts/list");
  return {
    name: requireString(object.name, `${label}.name`, "prompts/list"),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(args !== undefined ? { arguments: args } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeListPromptsResult(value: JsonRpcResponse["result"]): McpListPromptsPage {
  const object = requireJsonObject(value, "result", "prompts/list");
  if (!Array.isArray(object.prompts)) {
    throw malformedMcpResult("prompts/list", "prompts", "an array");
  }
  const nextCursor = optionalString(object.nextCursor, "nextCursor", "prompts/list");
  return {
    prompts: object.prompts.map(decodePromptDefinition),
    cache: decodeCacheHints(object, "prompts/list"),
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
  kind: McpResultKind = "tools/call",
): KotaMcpAnnotations | undefined {
  const object = optionalJsonObject(value, label, kind);
  if (!object) return undefined;
  const audience = optionalStringArray(object.audience, `${label}.audience`, kind);
  if (audience?.some((role) => role !== "user" && role !== "assistant")) {
    throw new Error(
      `Malformed MCP ${kind} result: ${label}.audience must contain user or assistant`,
    );
  }
  const priority = optionalNumber(object.priority, `${label}.priority`, kind);
  const lastModified = optionalString(object.lastModified, `${label}.lastModified`, kind);
  return {
    ...(audience ? { audience: audience as Array<"user" | "assistant"> } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(lastModified !== undefined ? { lastModified } : {}),
  };
}

function decodeTextResourceContents(
  object: KotaJsonObject,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaMcpTextResourceContents {
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  return {
    uri: requireString(object.uri, `${label}.uri`, kind),
    ...(mimeType !== undefined ? { mimeType } : {}),
    text: requireString(object.text, `${label}.text`, kind),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeBlobResourceContents(
  object: KotaJsonObject,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaMcpBlobResourceContents {
  const mimeType = optionalString(object.mimeType, `${label}.mimeType`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  return {
    uri: requireString(object.uri, `${label}.uri`, kind),
    ...(mimeType !== undefined ? { mimeType } : {}),
    blob: requireString(object.blob, `${label}.blob`, kind),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeResourceContents(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaMcpResourceContents {
  const object = optionalJsonObject(value, label, kind);
  if (!object) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an object`);
  }
  if (typeof object.text === "string") return decodeTextResourceContents(object, label, kind);
  if (typeof object.blob === "string") return decodeBlobResourceContents(object, label, kind);
  throw new Error(`Malformed MCP ${kind} result: ${label} must include text or blob`);
}

function decodeIcons(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaMcpIcon[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an array`);
  }
  return value.map((entry, index) => {
    const object = optionalJsonObject(entry, `${label}[${index}]`, kind);
    if (!object) {
      throw new Error(`Malformed MCP ${kind} result: ${label}[${index}] must be an object`);
    }
    const mimeType = optionalString(object.mimeType, `${label}[${index}].mimeType`, kind);
    const sizes = optionalStringArray(object.sizes, `${label}[${index}].sizes`, kind);
    const theme = optionalString(object.theme, `${label}[${index}].theme`, kind);
    if (theme !== undefined && theme !== "light" && theme !== "dark") {
      throw new Error(
        `Malformed MCP ${kind} result: ${label}[${index}].theme must be light or dark`,
      );
    }
    return {
      src: requireString(object.src, `${label}[${index}].src`, kind),
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(sizes !== undefined ? { sizes } : {}),
      ...(theme !== undefined ? { theme: theme as "light" | "dark" } : {}),
    };
  });
}

function decodeMcpContentBlock(
  value: KotaJsonValue,
  indexOrLabel: number | string,
  kind: McpResultKind = "tools/call",
): McpToolContentBlock {
  const label = typeof indexOrLabel === "number" ? `content[${indexOrLabel}]` : indexOrLabel;
  const object = optionalJsonObject(value, label, kind);
  if (!object) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an object`);
  }
  const type = requireString(object.type, `${label}.type`, kind);
  const annotations = decodeAnnotations(object.annotations, `${label}.annotations`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  switch (type) {
    case "text":
      return {
        type: "text",
        text: requireString(object.text, `${label}.text`, kind),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "image":
      return {
        type: "image",
        data: requireString(object.data, `${label}.data`, kind),
        mimeType: requireString(object.mimeType, `${label}.mimeType`, kind),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "audio":
      return {
        type: "audio",
        data: requireString(object.data, `${label}.data`, kind),
        mimeType: requireString(object.mimeType, `${label}.mimeType`, kind),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "resource":
      return {
        type: "resource",
        resource: decodeResourceContents(object.resource, `${label}.resource`, kind),
        ...(annotations ? { annotations } : {}),
        ...(meta ? { _meta: meta } : {}),
      };
    case "resource_link": {
      const icons = decodeIcons(object.icons, `${label}.icons`, kind);
      const title = optionalString(object.title, `${label}.title`, kind);
      const description = optionalString(object.description, `${label}.description`, kind);
      const mimeType = optionalString(object.mimeType, `${label}.mimeType`, kind);
      const size = optionalNumber(object.size, `${label}.size`, kind);
      return {
        type: "resource_link",
        uri: requireString(object.uri, `${label}.uri`, kind),
        name: requireString(object.name, `${label}.name`, kind),
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

function decodeContent(
  value: KotaJsonValue | undefined,
  kind: McpResultKind = "tools/call",
): McpToolContentBlock[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed MCP ${kind} result: content must be an array`);
  }
  return value.map((entry, index) => decodeMcpContentBlock(entry, index, kind));
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

function decodeInputRequests(
  value: KotaJsonValue | undefined,
  kind: McpResultKind = "tools/call",
): McpToolInputRequests {
  const object = requireJsonObject(value, "inputRequests", kind);
  const decoded: { [requestId: string]: McpToolInputRequest } = {};
  for (const [requestId, rawRequest] of Object.entries(object)) {
    const label = `inputRequests.${requestId}`;
    const request = optionalJsonObject(rawRequest, label, kind);
    if (!request) {
      throw malformedMcpResult(kind, label, "an object");
    }
    const method = requireString(request.method, `${label}.method`, kind);
    const params = requireJsonObject(request.params, `${label}.params`, kind);
    if (method === "elicitation/create") {
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
    }
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

export function decodeMcpToolInputResponses(
  value: KotaJsonValue | undefined,
  inputRequests?: McpToolInputRequests,
  kind: McpResultKind = "tools/call",
): McpToolInputResponses {
  const object = requireJsonObject(value, "inputResponses", kind);
  const decoded: { [requestId: string]: McpToolInputResponse } = {};
  for (const [requestId, rawResponse] of Object.entries(object)) {
    const label = `inputResponses.${requestId}`;
    const response = optionalJsonObject(rawResponse, label, kind);
    if (!response) {
      throw malformedMcpResult(kind, label, "an object");
    }
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
    const inputRequest = inputRequests?.[requestId];
    if (inputRequests && !inputRequest) {
      throw new Error(
        `Malformed MCP ${kind} result: ${label} does not match an input request`,
      );
    }
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
      decoded[requestId] = { action };
      continue;
    }
    if (action === "accept" && !content) {
      throw new Error(
        `Malformed MCP ${kind} result: ${label}.content must be an object when action is accept`,
      );
    }
    decoded[requestId] = {
      action,
      ...(content !== undefined ? { content } : {}),
    };
  }
  if (Object.keys(decoded).length === 0) {
    throw new Error(
      `Malformed MCP ${kind} result: inputResponses must include at least one response`,
    );
  }
  return decoded as McpToolInputResponses;
}

function decodeInputRequiredResult(
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
    return decodeInputRequiredResult(object, protocolVersion, "tools/call");
  }
  throw new Error(
    'Malformed MCP tools/call result: resultType must be "complete" or "input_required"',
  );
}

function decodeReadResourceResult(
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

function decodePromptMessage(value: KotaJsonValue, index: number): McpPromptMessage {
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

function decodeGetPromptResult(
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

function stableRecordEntries(record: Record<string, string> | undefined): [string, string][] {
  if (!record) return [];
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function authorizationContextKey(transport: NormalizedMcpClientTransport): string {
  const context = transport.type === "http"
    ? {
        type: "http",
        url: transport.url,
        headers: stableRecordEntries(transport.headers),
      }
    : {
        type: "stdio",
        command: transport.command,
        args: transport.args ?? [],
        env: stableRecordEntries(transport.env),
      };
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

/**
 * Lightweight MCP client using JSON-RPC 2.0 over stdio or Streamable HTTP.
 * Handles the MCP lifecycle: initialize → list tools → call tools → close.
 */
export class McpClient {
  private readonly transport: NormalizedMcpClientTransport;
  private readonly cacheAuthorizationContextKey: string;
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
  private toolsSupported = true;
  private toolsListChanged = false;
  private resourcesSupported = false;
  private resourcesListChanged = false;
  private promptsSupported = false;
  private promptsListChanged = false;
  private toolListSubscriptionId: number | null = null;
  private streamingRequestIds = new Set<number>();
  private toolListChangedHandlers = new Set<McpToolListChangedHandler>();
  private resourceListChangedHandlers = new Set<McpResourceListChangedHandler>();
  private promptListChangedHandlers = new Set<McpPromptListChangedHandler>();
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
    this.cacheAuthorizationContextKey = authorizationContextKey(this.transport);
    this.supportedElicitationModes = uniqueSupportedElicitationModes(
      resolvedOptions.supportedElicitationModes,
    );
  }

  getName(): string {
    return this.serverName;
  }

  getCacheAuthorizationContextKey(): string {
    return this.cacheAuthorizationContextKey;
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

  supportsTools(): boolean {
    return this.toolsSupported;
  }

  supportsResources(): boolean {
    return this.resourcesSupported;
  }

  supportsResourceListChanged(): boolean {
    return this.resourcesListChanged;
  }

  supportsPrompts(): boolean {
    return this.promptsSupported;
  }

  supportsPromptListChanged(): boolean {
    return this.promptsListChanged;
  }

  onToolListChanged(handler: McpToolListChangedHandler): () => void {
    this.toolListChangedHandlers.add(handler);
    return () => {
      this.toolListChangedHandlers.delete(handler);
    };
  }

  onResourceListChanged(handler: McpResourceListChangedHandler): () => void {
    this.resourceListChangedHandlers.add(handler);
    return () => {
      this.resourceListChangedHandlers.delete(handler);
    };
  }

  onPromptListChanged(handler: McpPromptListChangedHandler): () => void {
    this.promptListChangedHandlers.add(handler);
    return () => {
      this.promptListChangedHandlers.delete(handler);
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
    this.toolsSupported = result.toolsSupported;
    this.toolsListChanged = result.toolsListChanged;
    this.resourcesSupported = result.resourcesSupported;
    this.resourcesListChanged = result.resourcesListChanged;
    this.promptsSupported = result.promptsSupported;
    this.promptsListChanged = result.promptsListChanged;
    this.connected = true;
    if (
      result.protocolVersion === MCP_DRAFT_PROTOCOL_VERSION &&
      (this.toolsListChanged || this.resourcesListChanged || this.promptsListChanged)
    ) {
      this.openListChangedSubscription();
    }
  }

  private async connectHttp(): Promise<void> {
    this.protocolVersion = MCP_DRAFT_PROTOCOL_VERSION;
    this.toolResultContract = "draft-tool-result";
    let result: McpInitializeResult;
    try {
      result = decodeDiscoverResult(await this.request("server/discover"));
    } catch (err) {
      if (err instanceof McpConnectionError || err instanceof McpAuthorizationError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw this.requestErrorForMethod("server/discover", message);
    }

    if (this.closing) {
      throw new Error(`MCP server "${this.serverName}" was closed during connection`);
    }

    if (result.serverInfo?.name) {
      this.serverName = result.serverInfo.name;
    }
    const unsupportedListChanged = [
      result.toolsListChanged ? "tools.listChanged" : null,
      result.resourcesListChanged ? "resources.listChanged" : null,
      result.promptsListChanged ? "prompts.listChanged" : null,
    ].filter((entry): entry is string => entry !== null);
    if (unsupportedListChanged.length > 0) {
      throw this.requestErrorForMethod(
        "server/discover",
        `${unsupportedListChanged.join(", ")} requires a long-lived subscriptions/listen stream, which is not implemented for Streamable HTTP client connections`,
      );
    }
    this.protocolVersion = result.protocolVersion;
    this.toolResultContract = "draft-tool-result";
    this.toolsSupported = result.toolsSupported;
    this.toolsListChanged = result.toolsListChanged;
    this.resourcesSupported = result.resourcesSupported;
    this.resourcesListChanged = result.resourcesListChanged;
    this.promptsSupported = result.promptsSupported;
    this.promptsListChanged = result.promptsListChanged;
    this.connected = true;
  }

  async listToolsPage(cursor?: string): Promise<McpListToolsPage> {
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
    this.cacheHeaderParameters(page.tools);
    return page;
  }

  /** List available tools from the server. */
  async listTools(): Promise<McpToolSchema[]> {
    const tools: McpToolSchema[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.listToolsPage(cursor);
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

  async listResourcesPage(cursor?: string): Promise<McpListResourcesPage> {
    const result = await this.request(
      "resources/list",
      cursor !== undefined ? { cursor } : undefined,
    );
    try {
      return decodeListResourcesResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MCP resources/list failed for server "${this.serverName}": ${message}`,
      );
    }
  }

  /** List available resources from the server across all pages. */
  async listResources(): Promise<McpResourceSchema[]> {
    const resources: McpResourceSchema[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.listResourcesPage(cursor);
      resources.push(...page.resources);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(
            `Malformed MCP resources/list result from server "${this.serverName}": repeated nextCursor`,
          );
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);

    return resources;
  }

  async listResourceTemplatesPage(cursor?: string): Promise<McpListResourceTemplatesPage> {
    const result = await this.request(
      "resources/templates/list",
      cursor !== undefined ? { cursor } : undefined,
    );
    try {
      return decodeListResourceTemplatesResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MCP resources/templates/list failed for server "${this.serverName}": ${message}`,
      );
    }
  }

  /** List available resource templates from the server across all pages. */
  async listResourceTemplates(): Promise<McpResourceTemplateSchema[]> {
    const resourceTemplates: McpResourceTemplateSchema[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.listResourceTemplatesPage(cursor);
      resourceTemplates.push(...page.resourceTemplates);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(
            `Malformed MCP resources/templates/list result from server "${this.serverName}": repeated nextCursor`,
          );
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);

    return resourceTemplates;
  }

  async listPromptsPage(cursor?: string): Promise<McpListPromptsPage> {
    const result = await this.request(
      "prompts/list",
      cursor !== undefined ? { cursor } : undefined,
    );
    try {
      return decodeListPromptsResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MCP prompts/list failed for server "${this.serverName}": ${message}`,
      );
    }
  }

  /** List available prompts from the server across all pages. */
  async listPrompts(): Promise<McpPromptSchema[]> {
    const prompts: McpPromptSchema[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.listPromptsPage(cursor);
      prompts.push(...page.prompts);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(
            `Malformed MCP prompts/list result from server "${this.serverName}": repeated nextCursor`,
          );
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);

    return prompts;
  }

  /** Read a resource from the server. */
  async readResource(
    uri: string,
    retry?: McpOperationRetry,
  ): Promise<McpReadResourceResult> {
    const params: JsonRpcRequest["params"] = { uri };
    this.applyInputRetryParams(params, retry, "resources/read");
    const result = await this.request("resources/read", params, CALL_TIMEOUT);
    return decodeReadResourceResult(
      result,
      this.protocolVersion ?? MCP_DRAFT_PROTOCOL_VERSION,
    );
  }

  /** Get a prompt from the server. */
  async getPrompt(
    name: string,
    args: KotaJsonObject = {},
    retry?: McpOperationRetry,
  ): Promise<McpGetPromptResult> {
    const params: JsonRpcRequest["params"] = { name, arguments: args };
    this.applyInputRetryParams(params, retry, "prompts/get");
    const result = await this.request("prompts/get", params, CALL_TIMEOUT);
    return decodeGetPromptResult(
      result,
      this.protocolVersion ?? MCP_DRAFT_PROTOCOL_VERSION,
    );
  }

  /** Call a tool on the server. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    retry?: McpCallToolRetry,
    options: McpCallToolOptions = {},
  ): Promise<McpCallToolResult> {
    const params: JsonRpcRequest["params"] = { name, arguments: args };
    this.applyInputRetryParams(params, retry, "tools/call");
    const result = await this.request("tools/call", params, CALL_TIMEOUT, options.progress);
    return decodeCallToolResult(result, this.protocolVersion ?? MCP_LEGACY_PROTOCOL_VERSION);
  }

  private applyInputRetryParams(
    params: NonNullable<JsonRpcRequest["params"]>,
    retry: McpOperationRetry | undefined,
    kind: McpResultKind,
  ): void {
    if (!retry) return;
    if (retry.requestState === undefined && retry.inputResponses === undefined) {
      throw new Error(
        `Malformed MCP ${kind} retry: must include inputResponses or requestState`,
      );
    }
    if (retry.requestState !== undefined) {
      if (retry.requestState.length === 0) {
        throw new Error(`Malformed MCP ${kind} retry: requestState must be a non-empty string`);
      }
      params.requestState = retry.requestState;
    }
    if (retry.inputResponses !== undefined) {
      params.inputResponses = decodeMcpToolInputResponses(
        retry.inputResponses,
        retry.inputRequests,
        kind,
      );
    }
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
      this.resourceListChangedHandlers.clear();
      this.promptListChangedHandlers.clear();
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
    this.resourceListChangedHandlers.clear();
    this.promptListChangedHandlers.clear();

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
    const authorizationError = await this.authorizationErrorForHttpResponse(response, method);
    if (authorizationError) throw authorizationError;

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

  private async authorizationErrorForHttpResponse(
    response: Response,
    method: string,
  ): Promise<McpAuthorizationError | null> {
    if (response.status !== 401 && response.status !== 403) return null;
    const parsedChallenge = parseWwwAuthenticateChallenge(
      response.headers.get("www-authenticate"),
    ) ?? { scheme: "Bearer" as const, scopes: [] };
    const challenge = await this.challengeWithProtectedResourceMetadata(parsedChallenge);
    return new McpAuthorizationError(
      this.serverName,
      method,
      response.status,
      challenge,
    );
  }

  private async challengeWithProtectedResourceMetadata(
    challenge: McpAuthorizationChallenge,
  ): Promise<McpAuthorizationChallenge> {
    if (this.transport.type !== "http") return challenge;
    const metadataDiscovery = await this.discoverProtectedResourceMetadata(
      challenge.resourceMetadataUrl,
    );
    return {
      ...challenge,
      ...(metadataDiscovery.status === "found"
        ? { resourceMetadataUrl: metadataDiscovery.url }
        : {}),
      metadataDiscovery,
    };
  }

  private async discoverProtectedResourceMetadata(
    challengeResourceMetadataUrl: string | undefined,
  ): Promise<McpProtectedResourceMetadataDiscovery> {
    let candidateUrls: string[];
    try {
      candidateUrls = this.protectedResourceMetadataCandidateUrls(
        challengeResourceMetadataUrl,
      );
    } catch (err) {
      return {
        status: "unavailable",
        attemptedUrls: challengeResourceMetadataUrl ? [challengeResourceMetadataUrl] : [],
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const errors: string[] = [];
    for (const url of candidateUrls) {
      const result = await this.fetchProtectedResourceMetadata(url);
      if (result.status === "found") return result;
      errors.push(result.error);
    }

    return {
      status: "unavailable",
      attemptedUrls: candidateUrls,
      error: errors.join("; ") || "no protected-resource metadata URL available",
    };
  }

  private protectedResourceMetadataCandidateUrls(
    challengeResourceMetadataUrl: string | undefined,
  ): string[] {
    if (this.transport.type !== "http") return [];
    if (challengeResourceMetadataUrl === undefined) {
      return protectedResourceMetadataWellKnownUrls(this.transport.url);
    }

    const metadataUrl = new URL(challengeResourceMetadataUrl);
    if (metadataUrl.protocol !== "http:" && metadataUrl.protocol !== "https:") {
      throw new Error("resource_metadata URL must use http or https");
    }
    const resourceUrl = new URL(this.transport.url);
    if (metadataUrl.origin !== resourceUrl.origin) {
      throw new Error("resource_metadata URL must use the MCP HTTP origin");
    }
    return [metadataUrl.toString()];
  }

  private async fetchProtectedResourceMetadata(
    url: string,
  ): Promise<McpProtectedResourceMetadataDiscovery> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error && err.name === "AbortError"
        ? `request timed out after ${CONNECT_TIMEOUT}ms`
        : err instanceof Error ? err.message : String(err);
      return {
        status: "unavailable",
        attemptedUrls: [url],
        error: `${url}: ${message}`,
      };
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return {
        status: "unavailable",
        attemptedUrls: [url],
        error: `${url}: HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      return {
        status: "unavailable",
        attemptedUrls: [url],
        error: `${url}: unsupported response content-type "${contentType || "(missing)"}"`,
      };
    }

    let parsed: JsonRpcResult;
    try {
      parsed = JSON.parse(await response.text()) as JsonRpcResult;
      return {
        status: "found",
        url,
        metadata: decodeProtectedResourceMetadata(parsed),
      };
    } catch (err) {
      return {
        status: "unavailable",
        attemptedUrls: [url],
        error: `${url}: malformed protected-resource metadata: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
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
    if (method === "tools/call" || method === "resources/read" || method === "prompts/get") {
      return new McpToolError(this.serverName, method, message);
    }
    return new McpConnectionError(this.serverName, method, message);
  }

  private defaultServerNameForTransport(): string {
    if (this.transport.type === "stdio") return this.transport.command;
    return this.transport.url;
  }

  private openListChangedSubscription(): void {
    if (!this.proc?.stdin?.writable || this.toolListSubscriptionId !== null) return;
    const id = this.nextId++;
    this.toolListSubscriptionId = id;
    this.streamingRequestIds.add(id);
    const notifications = {
      ...(this.toolsListChanged ? { toolsListChanged: true } : {}),
      ...(this.resourcesListChanged ? { resourcesListChanged: true } : {}),
      ...(this.promptsListChanged ? { promptsListChanged: true } : {}),
    };
    const msg: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "subscriptions/listen",
      params: {
        _meta: this.draftRequestMeta(),
        notifications,
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
