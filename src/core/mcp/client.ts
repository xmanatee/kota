import { Buffer } from "node:buffer";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
  | "authorization-server-metadata"
  | "oauth-token"
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
export type McpLogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";
export type McpLogMessageEvent = {
  level: McpLogLevel;
  data?: KotaJsonValue;
  logger?: string;
};
export type McpLogMessageHandler = (event: McpLogMessageEvent) => void;
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

export type McpSamplingAudioContent = {
  type: "audio";
  data: string;
  mimeType: string;
  annotations?: KotaMcpAnnotations;
  _meta?: KotaJsonObject;
};

export type McpSamplingToolUseContent = {
  type: "tool_use";
  id: string;
  name: string;
  input: KotaJsonObject;
  _meta?: KotaJsonObject;
};

export type McpSamplingToolResultContent = {
  type: "tool_result";
  toolUseId: string;
  content: McpToolContentBlock[];
  structuredContent?: KotaJsonObject;
  isError?: boolean;
  _meta?: KotaJsonObject;
};

export type McpSamplingContentBlock =
  | McpToolTextContent
  | McpToolImageContent
  | McpSamplingAudioContent
  | McpSamplingToolUseContent
  | McpSamplingToolResultContent;

export type McpSamplingMessage = {
  role: "user" | "assistant";
  content: McpSamplingContentBlock | McpSamplingContentBlock[];
  _meta?: KotaJsonObject;
};

export type McpSamplingModelPreferences = {
  hints?: Array<{ name?: string }>;
  costPriority?: number;
  speedPriority?: number;
  intelligencePriority?: number;
};

export type McpSamplingToolChoice = {
  mode?: "none" | "required" | "auto";
};

export type McpSamplingTool = McpToolSchema;

export type McpSamplingCreateMessageParams = {
  messages: McpSamplingMessage[];
  modelPreferences?: McpSamplingModelPreferences;
  systemPrompt?: string;
  includeContext?: "none" | "thisServer" | "allServers";
  temperature?: number;
  maxTokens: number;
  stopSequences?: string[];
  metadata?: KotaJsonObject;
  tools?: McpSamplingTool[];
  toolChoice?: McpSamplingToolChoice;
  _meta?: KotaJsonObject;
};

export type McpSamplingInputRequest = {
  method: "sampling/createMessage";
  params: McpSamplingCreateMessageParams;
};

export type McpSamplingCreateMessageResult = {
  role: "user" | "assistant";
  content: McpSamplingContentBlock | McpSamplingContentBlock[];
  model: string;
  stopReason?: string;
  _meta?: KotaJsonObject;
};

export type McpElicitationInputRequest = KotaJsonObject & {
  method: "elicitation/create";
  params: KotaJsonObject;
};

export type McpToolInputRequests = KotaJsonObject & {
  [requestId: string]: McpToolInputRequest | McpSamplingInputRequest;
};

export type McpElicitationMode = "form" | "url";

export type McpToolInputResponse = KotaJsonObject & {
  action: "accept" | "decline" | "cancel";
  content?: KotaJsonObject;
};

export type McpToolInputResponses = KotaJsonObject & {
  [requestId: string]: McpToolInputResponse | McpSamplingCreateMessageResult;
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
const MCP_LOG_LEVELS = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
] as const satisfies readonly McpLogLevel[];

export type McpClientOptions = {
  supportedElicitationModes?: readonly McpElicitationMode[];
  authorizationResolver?: McpAuthorizationResolver;
  onLogMessage?: McpLogMessageHandler;
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
  authorization?: McpStreamableHttpAuthorizationConfig;
};

export type McpOAuthRegisteredClientConfig = {
  kind: "registered";
  clientId: string;
  clientSecret?: string;
};

export type McpOAuthClientIdMetadataUrlConfig = {
  kind: "client-id-metadata-url";
  clientId: string;
};

export type McpOAuthDynamicClientConfig = {
  kind: "dynamic";
  clientName: string;
  dynamicClientRegistration: { enabled: boolean };
};

export type McpOAuthClientIdentityConfig =
  | McpOAuthRegisteredClientConfig
  | McpOAuthClientIdMetadataUrlConfig
  | McpOAuthDynamicClientConfig;

export type McpStreamableHttpAuthorizationConfig = {
  type: "oauth";
  issuer: string;
  redirectUri: string;
  scopes: string[];
  client: McpOAuthClientIdentityConfig;
};

export type McpAuthorizationResolverRequest = {
  server: string;
  resource: string;
  issuer: string;
  scopes: string[];
  authorizationUrl: string;
  state: string;
};

export class McpOAuthSecret {
  #value: string;

  constructor(value: string) {
    if (value.length === 0) {
      throw new Error("OAuth secret value must be non-empty");
    }
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "[redacted]";
  }

  toJSON(): string {
    return "[redacted]";
  }

  [Symbol.toPrimitive](): string {
    return "[redacted]";
  }
}

export function mcpOAuthSecret(value: string): McpOAuthSecret {
  return new McpOAuthSecret(value);
}

export type McpAuthorizationResolverResult = {
  callbackUrl: McpOAuthSecret;
};

export type McpAuthorizationResolver = (
  request: McpAuthorizationResolverRequest,
) => Promise<McpAuthorizationResolverResult>;

export type McpClientTransportConfig =
  | McpStdioClientTransportConfig
  | McpStreamableHttpClientTransportConfig;

type NormalizedMcpClientTransport =
  | (McpStdioClientTransportConfig & { type: "stdio" })
  | (McpStreamableHttpClientTransportConfig & {
      authorization?: NormalizedMcpStreamableHttpAuthorizationConfig;
    });

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

type NormalizedMcpOAuthRegisteredClient = {
  kind: "registered";
  clientId: string;
  clientSecret?: string;
};

type NormalizedMcpOAuthClientIdMetadataUrl = {
  kind: "client-id-metadata-url";
  clientId: string;
};

type NormalizedMcpOAuthDynamicClient = {
  kind: "dynamic";
  clientName: string;
  dynamicClientRegistration: { enabled: true };
};

type NormalizedMcpOAuthClientIdentity =
  | NormalizedMcpOAuthRegisteredClient
  | NormalizedMcpOAuthClientIdMetadataUrl
  | NormalizedMcpOAuthDynamicClient;

type NormalizedMcpStreamableHttpAuthorizationConfig = {
  type: "oauth";
  issuer: string;
  redirectUri: string;
  scopes: string[];
  client: NormalizedMcpOAuthClientIdentity;
};

type McpAuthorizationServerMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported: string[];
  codeChallengeMethodsSupported: string[];
  authorizationResponseIssuerRequired: boolean;
};

type McpOAuthResolvedClient = {
  clientId: string;
  clientSecret?: string;
};

type McpOAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  expiresAtMs?: number;
};

type McpOAuthTokenBinding = {
  resource: string;
  issuer: string;
  token: McpOAuthTokenSet;
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

export class McpAuthorizationFlowError extends Error {
  readonly name = "McpAuthorizationFlowError";

  constructor(
    readonly serverName: string,
    readonly resource: string,
    readonly issuer: string,
    readonly scopes: readonly string[],
    reason: string,
  ) {
    super(
      `MCP authorization flow failed for server "${serverName}" ` +
        `resource "${resource}" issuer "${issuer}" scopes="${scopes.join(" ")}": ${reason}`,
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
  request: McpToolInputRequest | McpSamplingInputRequest,
): McpElicitationMode | null {
  if (request.method !== "elicitation/create") return null;
  return request.params.mode === "url" ? "url" : "form";
}

export function mcpToolUrlElicitationDetails(
  request: McpToolInputRequest | McpSamplingInputRequest,
): { message: string; url: string; elicitationId: string } | null {
  if (mcpToolInputRequestElicitationMode(request) !== "url") return null;
  const params = request.params as KotaJsonObject;
  const { message, url, elicitationId } = params;
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

function uniqueScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.filter((scope) => scope.length > 0))];
}

function scopeSetIncludesAll(granted: readonly string[], required: readonly string[]): boolean {
  const grantedSet = new Set(granted);
  return required.every((scope) => grantedSet.has(scope));
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateOAuthVerifier(): string {
  return base64Url(randomBytes(64));
}

function generateOAuthState(): string {
  return base64Url(randomBytes(32));
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

function authorizationServerMetadataUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const basePath = url.pathname === "/"
    ? ""
    : url.pathname.replace(/\/+$/, "");
  const oauthMetadata = new URL(
    `/.well-known/oauth-authorization-server${basePath}`,
    url.origin,
  ).toString();
  const oauthStyleOpenIdMetadata = new URL(
    `/.well-known/openid-configuration${basePath}`,
    url.origin,
  ).toString();
  const openIdDiscoveryMetadata = new URL(
    `${basePath}/.well-known/openid-configuration`,
    url.origin,
  ).toString();
  return [...new Set([
    oauthMetadata,
    oauthStyleOpenIdMetadata,
    openIdDiscoveryMetadata,
  ])];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  loggingSupported: boolean;
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

type DeprecatedMcpFeature = "roots" | "sampling" | "logging";

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

function decodeDeprecatedObjectCapability(
  capabilities: KotaJsonObject | undefined,
  capabilityName: DeprecatedMcpFeature,
  kind: McpResultKind,
): boolean {
  const rawCapability = capabilities ? capabilities[capabilityName] : undefined;
  if (rawCapability === undefined) return false;
  optionalJsonObject(rawCapability, `capabilities.${capabilityName}`, kind);
  return true;
}

function isMcpProtocolVersion(value: string): value is McpProtocolVersion {
  return value === MCP_DRAFT_PROTOCOL_VERSION || value === MCP_LEGACY_PROTOCOL_VERSION;
}

function isMcpProgressToken(value: KotaJsonValue | undefined): value is McpProgressToken {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

function isMcpLogLevel(value: KotaJsonValue | undefined): value is McpLogLevel {
  return typeof value === "string" &&
    (MCP_LOG_LEVELS as readonly string[]).includes(value);
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
  const loggingSupported = decodeDeprecatedObjectCapability(capabilities, "logging", "initialize");
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
    loggingSupported,
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
  const loggingSupported = decodeDeprecatedObjectCapability(capabilities, "logging", "server/discover");
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
    loggingSupported,
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

function decodeAuthorizationServerMetadata(
  value: JsonRpcResult,
): McpAuthorizationServerMetadata {
  const object = requireJsonObject(value, "metadata", "authorization-server-metadata");
  return {
    issuer: requireString(object.issuer, "issuer", "authorization-server-metadata"),
    authorizationEndpoint: requireString(
      object.authorization_endpoint,
      "authorization_endpoint",
      "authorization-server-metadata",
    ),
    tokenEndpoint: requireString(
      object.token_endpoint,
      "token_endpoint",
      "authorization-server-metadata",
    ),
    ...(object.registration_endpoint !== undefined
      ? {
          registrationEndpoint: requireString(
            object.registration_endpoint,
            "registration_endpoint",
            "authorization-server-metadata",
          ),
        }
      : {}),
    scopesSupported: optionalStringArray(
      object.scopes_supported,
      "scopes_supported",
      "authorization-server-metadata",
    ) ?? [],
    codeChallengeMethodsSupported: optionalStringArray(
      object.code_challenge_methods_supported,
      "code_challenge_methods_supported",
      "authorization-server-metadata",
    ) ?? [],
    authorizationResponseIssuerRequired: optionalBoolean(
      object.authorization_response_iss_parameter_supported,
      "authorization_response_iss_parameter_supported",
      "authorization-server-metadata",
    ) ?? false,
  };
}

function decodeOAuthTokenSet(
  value: JsonRpcResult,
  previousRefreshToken?: string,
): McpOAuthTokenSet {
  const object = requireJsonObject(value, "token", "oauth-token");
  const tokenType = requireString(object.token_type, "token_type", "oauth-token");
  if (tokenType.toLowerCase() !== "bearer") {
    throw new Error("Malformed OAuth token response: token_type must be Bearer");
  }
  const scope = optionalString(object.scope, "scope", "oauth-token");
  const expiresIn = optionalNumber(object.expires_in, "expires_in", "oauth-token");
  const refreshToken = optionalString(object.refresh_token, "refresh_token", "oauth-token");
  return {
    accessToken: requireString(object.access_token, "access_token", "oauth-token"),
    scopes: splitScopeParam(scope),
    ...(refreshToken !== undefined
      ? { refreshToken }
      : previousRefreshToken !== undefined
        ? { refreshToken: previousRefreshToken }
        : {}),
    ...(expiresIn !== undefined
      ? { expiresAtMs: Date.now() + Math.max(0, expiresIn) * 1000 }
      : {}),
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

function decodeSamplingContentValue(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingContentBlock | McpSamplingContentBlock[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      decodeSamplingContentBlock(entry, `${label}[${index}]`, kind),
    );
  }
  return decodeSamplingContentBlock(value, label, kind);
}

function decodeSamplingContentBlock(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingContentBlock {
  const object = optionalJsonObject(value, label, kind);
  if (!object) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an object`);
  }
  const type = requireString(object.type, `${label}.type`, kind);
  const annotations = decodeAnnotations(object.annotations, `${label}.annotations`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  if (type === "text") {
    return {
      type: "text",
      text: requireString(object.text, `${label}.text`, kind),
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  if (type === "image") {
    return {
      type: "image",
      data: requireString(object.data, `${label}.data`, kind),
      mimeType: requireString(object.mimeType, `${label}.mimeType`, kind),
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  if (type === "audio") {
    return {
      type: "audio",
      data: requireString(object.data, `${label}.data`, kind),
      mimeType: requireString(object.mimeType, `${label}.mimeType`, kind),
      ...(annotations ? { annotations } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  if (type === "tool_use") {
    return {
      type: "tool_use",
      id: requireString(object.id, `${label}.id`, kind),
      name: requireString(object.name, `${label}.name`, kind),
      input: requireJsonObject(object.input, `${label}.input`, kind),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  if (type === "tool_result") {
    if (!Array.isArray(object.content)) {
      throw malformedMcpResult(kind, `${label}.content`, "an array");
    }
    const content = object.content.map((entry, index) =>
      decodeMcpContentBlock(entry, `${label}.content[${index}]`, kind),
    );
    if (content.some((block) => block.type === "unknown")) {
      throw new Error(
        `Malformed MCP ${kind} result: ${label}.content includes unsupported content block`,
      );
    }
    const structuredContent = optionalJsonObject(
      object.structuredContent,
      `${label}.structuredContent`,
      kind,
    );
    const isError = optionalBoolean(object.isError, `${label}.isError`, kind);
    return {
      type: "tool_result",
      toolUseId: requireString(object.toolUseId, `${label}.toolUseId`, kind),
      content,
      ...(structuredContent ? { structuredContent } : {}),
      ...(isError !== undefined ? { isError } : {}),
      ...(meta ? { _meta: meta } : {}),
    };
  }
  throw new Error(
    `Malformed MCP ${kind} result: ${label}.type must be text, image, audio, tool_use, or tool_result`,
  );
}

function samplingContentBlocks(
  content: McpSamplingMessage["content"],
): McpSamplingContentBlock[] {
  return Array.isArray(content) ? content : [content];
}

function decodeSamplingRole(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): "user" | "assistant" {
  const role = requireString(value, label, kind);
  if (role !== "user" && role !== "assistant") {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be user or assistant`);
  }
  return role;
}

function decodeSamplingMessage(
  value: KotaJsonValue,
  index: number,
  requestLabel: string,
  kind: McpResultKind,
): McpSamplingMessage {
  const label = `${requestLabel}.params.messages[${index}]`;
  const object = optionalJsonObject(value, label, kind);
  if (!object) {
    throw new Error(`Malformed MCP ${kind} result: ${label} must be an object`);
  }
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  return {
    role: decodeSamplingRole(object.role, `${label}.role`, kind),
    content: decodeSamplingContentValue(object.content, `${label}.content`, kind),
    ...(meta ? { _meta: meta } : {}),
  };
}

function validateSamplingMessages(
  messages: McpSamplingMessage[],
  requestLabel: string,
  kind: McpResultKind,
): void {
  let pendingToolUseIds: string[] = [];
  for (const [index, message] of messages.entries()) {
    const label = `${requestLabel}.params.messages[${index}]`;
    const blocks = samplingContentBlocks(message.content);
    const toolResults = blocks.filter(
      (block): block is McpSamplingToolResultContent => block.type === "tool_result",
    );
    const toolUses = blocks.filter(
      (block): block is McpSamplingToolUseContent => block.type === "tool_use",
    );

    if (toolResults.length > 0) {
      if (message.role !== "user") {
        throw new Error(
          `Malformed MCP ${kind} result: ${label}.role must be user when content contains tool_result blocks`,
        );
      }
      if (toolResults.length !== blocks.length) {
        throw new Error(
          `Malformed MCP ${kind} result: ${label}.content must contain only tool_result blocks`,
        );
      }
    }
    if (toolUses.length > 0 && message.role !== "assistant") {
      throw new Error(
        `Malformed MCP ${kind} result: ${label}.role must be assistant when content contains tool_use blocks`,
      );
    }

    if (pendingToolUseIds.length > 0) {
      const resultIds = new Set(toolResults.map((block) => block.toolUseId));
      const missing = pendingToolUseIds.filter((id) => !resultIds.has(id));
      if (message.role !== "user" || toolResults.length !== blocks.length || missing.length > 0) {
        throw new Error(
          `Malformed MCP ${kind} result: ${label} must answer pending tool_use ids ${pendingToolUseIds.join(", ")} before normal conversation continues`,
        );
      }
      const extras = [...resultIds].filter((id) => !pendingToolUseIds.includes(id));
      if (extras.length > 0) {
        throw new Error(
          `Malformed MCP ${kind} result: ${label}.content has tool_result ids without matching pending tool_use ids ${extras.join(", ")}`,
        );
      }
      pendingToolUseIds = [];
      continue;
    }

    if (toolResults.length > 0) {
      throw new Error(
        `Malformed MCP ${kind} result: ${label}.content has tool_result blocks without a preceding assistant tool_use message`,
      );
    }
    if (toolUses.length > 0) {
      pendingToolUseIds = toolUses.map((block) => block.id);
    }
  }

  if (pendingToolUseIds.length > 0) {
    throw new Error(
      `Malformed MCP ${kind} result: ${requestLabel}.params.messages must answer pending tool_use ids ${pendingToolUseIds.join(", ")}`,
    );
  }
}

function decodeSamplingModelPreferences(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingModelPreferences | undefined {
  const object = optionalJsonObject(value, label, kind);
  if (!object) return undefined;
  const hints = object.hints === undefined
    ? undefined
    : Array.isArray(object.hints)
      ? object.hints.map((hint, index) => {
        const hintObject = optionalJsonObject(hint, `${label}.hints[${index}]`, kind);
        if (!hintObject) {
          throw malformedMcpResult(kind, `${label}.hints[${index}]`, "an object");
        }
        const name = optionalString(hintObject.name, `${label}.hints[${index}].name`, kind);
        return name === undefined ? {} : { name };
      })
      : null;
  if (hints === null) {
    throw malformedMcpResult(kind, `${label}.hints`, "an array");
  }
  const costPriority = optionalNumber(object.costPriority, `${label}.costPriority`, kind);
  const speedPriority = optionalNumber(object.speedPriority, `${label}.speedPriority`, kind);
  const intelligencePriority = optionalNumber(
    object.intelligencePriority,
    `${label}.intelligencePriority`,
    kind,
  );
  return {
    ...(hints !== undefined ? { hints } : {}),
    ...(costPriority !== undefined ? { costPriority } : {}),
    ...(speedPriority !== undefined ? { speedPriority } : {}),
    ...(intelligencePriority !== undefined ? { intelligencePriority } : {}),
  };
}

function decodeSamplingTool(
  value: KotaJsonValue,
  index: number,
  label: string,
  kind: McpResultKind,
): McpSamplingTool {
  const toolLabel = `${label}[${index}]`;
  const object = optionalJsonObject(value, toolLabel, kind);
  if (!object) {
    throw malformedMcpResult(kind, toolLabel, "an object");
  }
  const inputSchema = requireJsonObject(object.inputSchema, `${toolLabel}.inputSchema`, kind);
  if (inputSchema.type !== "object") {
    throw new Error(`Malformed MCP ${kind} result: ${toolLabel}.inputSchema.type must be object`);
  }
  const outputSchema = object.outputSchema === undefined
    ? undefined
    : requireJsonObject(object.outputSchema, `${toolLabel}.outputSchema`, kind);
  if (outputSchema !== undefined && outputSchema.type !== "object") {
    throw new Error(`Malformed MCP ${kind} result: ${toolLabel}.outputSchema.type must be object`);
  }
  const description = optionalString(object.description, `${toolLabel}.description`, kind);
  return {
    name: requireString(object.name, `${toolLabel}.name`, kind),
    ...(description !== undefined ? { description } : {}),
    inputSchema: inputSchema as McpSamplingTool["inputSchema"],
    ...(outputSchema !== undefined
      ? { outputSchema: outputSchema as McpSamplingTool["outputSchema"] }
      : {}),
  };
}

function decodeSamplingToolChoice(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingToolChoice | undefined {
  const object = optionalJsonObject(value, label, kind);
  if (!object) return undefined;
  const mode = optionalString(object.mode, `${label}.mode`, kind);
  if (mode !== undefined && mode !== "none" && mode !== "required" && mode !== "auto") {
    throw new Error(
      `Malformed MCP ${kind} result: ${label}.mode must be none, required, or auto`,
    );
  }
  return mode === undefined ? {} : { mode };
}

function decodeSamplingCreateMessageParams(
  value: KotaJsonValue | undefined,
  requestLabel: string,
  kind: McpResultKind,
): McpSamplingCreateMessageParams {
  const object = requireJsonObject(value, `${requestLabel}.params`, kind);
  if (!Array.isArray(object.messages) || object.messages.length === 0) {
    throw malformedMcpResult(kind, `${requestLabel}.params.messages`, "a non-empty array");
  }
  const messages = object.messages.map((entry, index) =>
    decodeSamplingMessage(entry, index, requestLabel, kind),
  );
  validateSamplingMessages(messages, requestLabel, kind);
  const includeContext = optionalString(object.includeContext, `${requestLabel}.params.includeContext`, kind);
  if (
    includeContext !== undefined &&
    includeContext !== "none" &&
    includeContext !== "thisServer" &&
    includeContext !== "allServers"
  ) {
    throw new Error(
      `Malformed MCP ${kind} result: ${requestLabel}.params.includeContext must be none, thisServer, or allServers`,
    );
  }
  const stopSequences = optionalStringArray(
    object.stopSequences,
    `${requestLabel}.params.stopSequences`,
    kind,
  );
  const tools = object.tools === undefined
    ? undefined
    : Array.isArray(object.tools)
      ? object.tools.map((entry, index) =>
        decodeSamplingTool(entry, index, `${requestLabel}.params.tools`, kind),
      )
      : null;
  if (tools === null) {
    throw malformedMcpResult(kind, `${requestLabel}.params.tools`, "an array");
  }
  const meta = optionalJsonObject(object._meta, `${requestLabel}.params._meta`, kind);
  const metadata = optionalJsonObject(object.metadata, `${requestLabel}.params.metadata`, kind);
  const modelPreferences = decodeSamplingModelPreferences(
    object.modelPreferences,
    `${requestLabel}.params.modelPreferences`,
    kind,
  );
  const toolChoice = decodeSamplingToolChoice(
    object.toolChoice,
    `${requestLabel}.params.toolChoice`,
    kind,
  );
  const systemPrompt = optionalString(object.systemPrompt, `${requestLabel}.params.systemPrompt`, kind);
  const temperature = optionalNumber(object.temperature, `${requestLabel}.params.temperature`, kind);
  const maxTokens = optionalNumber(object.maxTokens, `${requestLabel}.params.maxTokens`, kind);
  if (maxTokens === undefined) {
    throw malformedMcpResult(kind, `${requestLabel}.params.maxTokens`, "a number");
  }
  return {
    messages,
    ...(modelPreferences !== undefined ? { modelPreferences } : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(includeContext !== undefined
      ? { includeContext: includeContext as "none" | "thisServer" | "allServers" }
      : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    maxTokens,
    ...(stopSequences !== undefined ? { stopSequences } : {}),
    ...(metadata ? { metadata } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(toolChoice !== undefined ? { toolChoice } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

function decodeSamplingCreateMessageResult(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind,
): McpSamplingCreateMessageResult {
  const object = requireJsonObject(value, label, kind);
  const stopReason = optionalString(object.stopReason, `${label}.stopReason`, kind);
  const meta = optionalJsonObject(object._meta, `${label}._meta`, kind);
  return {
    role: decodeSamplingRole(object.role, `${label}.role`, kind),
    content: decodeSamplingContentValue(object.content, `${label}.content`, kind),
    model: requireString(object.model, `${label}.model`, kind),
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
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

function decodeElicitationToolInputResponse(
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

function normalizeHttpUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return url.toString();
}

function normalizeHttpsUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use https`);
  }
  return url.toString();
}

function validateOAuthIssuer(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("OAuth issuer must use http or https");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error("OAuth issuer must not include query or fragment");
  }
  return value;
}

function normalizeOAuthClientIdentity(
  client: McpOAuthClientIdentityConfig,
): NormalizedMcpOAuthClientIdentity {
  if (client.kind === "registered") {
    if (client.clientId.length === 0) {
      throw new Error("OAuth registered clientId must not be empty");
    }
    return {
      kind: "registered",
      clientId: client.clientId,
      ...(client.clientSecret !== undefined ? { clientSecret: client.clientSecret } : {}),
    };
  }
  if (client.kind === "client-id-metadata-url") {
    return {
      kind: "client-id-metadata-url",
      clientId: normalizeHttpsUrl(
        client.clientId,
        "OAuth client-id metadata document URL",
      ),
    };
  }
  if (client.kind === "dynamic") {
    if (client.dynamicClientRegistration.enabled !== true) {
      throw new Error("OAuth dynamic client registration is disabled");
    }
    if (client.clientName.length === 0) {
      throw new Error("OAuth dynamic clientName must not be empty");
    }
    return {
      kind: "dynamic",
      clientName: client.clientName,
      dynamicClientRegistration: { enabled: true },
    };
  }
  throw new Error("OAuth client identity kind is unsupported");
}

function normalizeMcpAuthorizationConfig(
  authorization: McpStreamableHttpAuthorizationConfig,
): NormalizedMcpStreamableHttpAuthorizationConfig {
  if (authorization.type !== "oauth") {
    throw new Error("MCP HTTP authorization type must be oauth");
  }
  return {
    type: "oauth",
    issuer: validateOAuthIssuer(authorization.issuer),
    redirectUri: normalizeHttpUrl(authorization.redirectUri, "OAuth redirectUri"),
    scopes: [...new Set(authorization.scopes)],
    client: normalizeOAuthClientIdentity(authorization.client),
  };
}

function hasStaticAuthorizationHeader(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

function normalizeClientTransportConfig(
  config: McpClientTransportConfig,
): NormalizedMcpClientTransport {
  if (config.type === "http") {
    const url = new URL(config.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("MCP HTTP transport URL must use http or https");
    }
    if (hasStaticAuthorizationHeader(config.headers) && config.authorization) {
      throw new Error(
        "MCP HTTP transport cannot combine static Authorization headers with acquired OAuth tokens",
      );
    }
    return {
      type: "http",
      url: url.toString(),
      ...(config.headers ? { headers: { ...config.headers } } : {}),
      ...(config.authorization
        ? { authorization: normalizeMcpAuthorizationConfig(config.authorization) }
        : {}),
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
        authorization: transport.authorization
          ? {
              type: transport.authorization.type,
              issuer: transport.authorization.issuer,
              redirectUri: transport.authorization.redirectUri,
              scopes: transport.authorization.scopes,
              client: transport.authorization.client.kind === "registered"
                ? {
                    kind: "registered",
                    clientId: transport.authorization.client.clientId,
                    hasClientSecret: transport.authorization.client.clientSecret !== undefined,
                  }
                : transport.authorization.client,
            }
          : null,
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
  private httpListSubscriptionAbort: AbortController | null = null;
  private toolListSubscriptionId: number | null = null;
  private streamingRequestIds = new Set<number>();
  private toolListChangedHandlers = new Set<McpToolListChangedHandler>();
  private resourceListChangedHandlers = new Set<McpResourceListChangedHandler>();
  private promptListChangedHandlers = new Set<McpPromptListChangedHandler>();
  private activeProgressByRequestId = new Map<number, string>();
  private activeProgressByToken = new Map<string, ActiveProgressRequest>();
  private progressWarningCount = 0;
  private readonly deprecatedCapabilityWarnings = new Set<DeprecatedMcpFeature>();
  private readonly headerParametersByTool = new Map<string, McpHeaderParameterSpec[]>();
  private readonly supportedElicitationModes: readonly McpElicitationMode[];
  private readonly authorizationResolver?: McpAuthorizationResolver;
  private readonly logMessageHandler?: McpLogMessageHandler;
  private oauthTokenBinding: McpOAuthTokenBinding | null = null;
  private readonly oauthClients = new Map<string, McpOAuthResolvedClient>();

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
    this.authorizationResolver = resolvedOptions.authorizationResolver;
    this.logMessageHandler = resolvedOptions.onLogMessage;
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
    this.warnDeprecatedServerCapabilities(result);
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
    this.warnDeprecatedServerCapabilities(result);
    this.protocolVersion = result.protocolVersion;
    this.toolResultContract = "draft-tool-result";
    this.toolsSupported = result.toolsSupported;
    this.toolsListChanged = result.toolsListChanged;
    this.resourcesSupported = result.resourcesSupported;
    this.resourcesListChanged = result.resourcesListChanged;
    this.promptsSupported = result.promptsSupported;
    this.promptsListChanged = result.promptsListChanged;
    this.connected = true;
    if (this.toolsListChanged || this.resourcesListChanged || this.promptsListChanged) {
      this.openListChangedSubscription();
    }
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
    const decoded = decodeReadResourceResult(
      result,
      this.protocolVersion ?? MCP_DRAFT_PROTOCOL_VERSION,
    );
    this.warnDeprecatedInputRequiredResult(decoded);
    return decoded;
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
    const decoded = decodeGetPromptResult(
      result,
      this.protocolVersion ?? MCP_DRAFT_PROTOCOL_VERSION,
    );
    this.warnDeprecatedInputRequiredResult(decoded);
    return decoded;
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
    const decoded = decodeCallToolResult(
      result,
      this.protocolVersion ?? MCP_LEGACY_PROTOCOL_VERSION,
    );
    this.warnDeprecatedInputRequiredResult(decoded);
    return decoded;
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
      this.httpListSubscriptionAbort?.abort();
      this.httpListSubscriptionAbort = null;
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

  private handleLogMessageNotification(params: JsonRpcNotification["params"]): void {
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
      const requestParams = this.paramsWithDraftMetadata(params, progressToken);
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

  private httpHeadersForRequest(
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

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
      const text = await response.text();
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
      : this.parseJsonRpcHttpMessage((responseText = await response.text()), method);
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
        `HTTP ${response.status}: ${responseText || response.statusText || "empty response"}`,
      );
    }
    return message.result;
  }

  private async decodeHttpSseResponse(
    response: Response,
    method: string,
    requestId: number,
  ): Promise<JsonRpcIncomingMessage> {
    let finalMessage: JsonRpcIncomingMessage | null = null;
    await this.consumeSseJsonRpcMessageStream(response, method, (message) => {
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
          `response id ${message.id} did not match request id ${requestId}`,
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

  private async authorizeForHttpChallenge(
    error: McpAuthorizationError,
  ): Promise<boolean> {
    if (this.transport.type !== "http" || !this.transport.authorization) {
      return false;
    }
    const config = this.transport.authorization;
    const challenge = error.challenge;
    if (challenge.metadataDiscovery?.status !== "found") {
      const resource = this.oauthTokenBinding?.resource ?? this.transport.url;
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        uniqueScopes([...config.scopes, ...challenge.scopes]),
        `protected-resource metadata unavailable: ${
          challenge.metadataDiscovery?.error ?? "no protected-resource metadata"
        }`,
      );
    }

    const resourceMetadata = challenge.metadataDiscovery.metadata;
    if (!resourceMetadata.authorizationServers.includes(config.issuer)) {
      throw this.authorizationFlowError(
        resourceMetadata.resource,
        config.issuer,
        uniqueScopes([...config.scopes, ...challenge.scopes]),
        `issuer "${config.issuer}" is not advertised by protected resource metadata`,
      );
    }

    const requestedScopes = uniqueScopes([
      ...config.scopes,
      ...(challenge.error === "insufficient_scope" && this.oauthTokenBinding
        ? this.oauthTokenBinding.token.scopes
        : []),
      ...challenge.scopes,
    ]);
    const metadata = await this.fetchAuthorizationServerMetadata(
      config,
      resourceMetadata.resource,
      requestedScopes,
    );
    const client = await this.resolveOAuthClient(
      config,
      metadata,
      resourceMetadata.resource,
      requestedScopes,
    );
    const token = await this.runAuthorizationCodeFlow(
      config,
      metadata,
      client,
      resourceMetadata.resource,
      requestedScopes,
    );
    if (!scopeSetIncludesAll(token.scopes, requestedScopes)) {
      throw this.authorizationFlowError(
        resourceMetadata.resource,
        config.issuer,
        requestedScopes,
        "authorization did not grant the required scopes",
      );
    }
    this.oauthTokenBinding = {
      resource: resourceMetadata.resource,
      issuer: config.issuer,
      token,
    };
    return true;
  }

  private authorizationFlowError(
    resource: string,
    issuer: string,
    scopes: readonly string[],
    reason: string,
  ): McpAuthorizationFlowError {
    return new McpAuthorizationFlowError(
      this.serverName,
      resource,
      issuer,
      scopes,
      reason,
    );
  }

  private async fetchAuthorizationServerMetadata(
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpAuthorizationServerMetadata> {
    const errors: string[] = [];
    for (const url of authorizationServerMetadataUrls(config.issuer)) {
      let response: JsonRpcResult;
      try {
        response = await this.fetchOAuthJson(
          url,
          { method: "GET", headers: { Accept: "application/json" } },
          resource,
          config.issuer,
          scopes,
          `authorization-server metadata discovery at ${url}`,
        );
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        continue;
      }

      let metadata: McpAuthorizationServerMetadata;
      try {
        metadata = decodeAuthorizationServerMetadata(response);
      } catch (err) {
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (metadata.issuer !== config.issuer) {
        errors.push(
          `${url}: authorization-server metadata issuer mismatch: expected "${config.issuer}"`,
        );
        continue;
      }
      if (!metadata.codeChallengeMethodsSupported.includes("S256")) {
        errors.push(`${url}: authorization server does not support PKCE S256`);
        continue;
      }
      return {
        ...metadata,
        authorizationEndpoint: normalizeHttpUrl(
          metadata.authorizationEndpoint,
          "authorization_endpoint",
        ),
        tokenEndpoint: normalizeHttpUrl(metadata.tokenEndpoint, "token_endpoint"),
        ...(metadata.registrationEndpoint !== undefined
          ? {
              registrationEndpoint: normalizeHttpUrl(
                metadata.registrationEndpoint,
                "registration_endpoint",
              ),
            }
          : {}),
      };
    }

    throw this.authorizationFlowError(
      resource,
      config.issuer,
      scopes,
      `authorization-server metadata discovery failed: ${errors.join("; ")}`,
    );
  }

  private async resolveOAuthClient(
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    metadata: McpAuthorizationServerMetadata,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpOAuthResolvedClient> {
    const cacheKey = `${resource}\n${config.issuer}`;
    const cached = this.oauthClients.get(cacheKey);
    if (cached) return cached;

    if (config.client.kind === "registered") {
      const client = {
        clientId: config.client.clientId,
        ...(config.client.clientSecret !== undefined
          ? { clientSecret: config.client.clientSecret }
          : {}),
      };
      this.oauthClients.set(cacheKey, client);
      return client;
    }
    if (config.client.kind === "client-id-metadata-url") {
      const client = { clientId: config.client.clientId };
      this.oauthClients.set(cacheKey, client);
      return client;
    }
    if (!metadata.registrationEndpoint) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "authorization server does not advertise dynamic client registration",
      );
    }

    const registration = await this.fetchOAuthJson(
      metadata.registrationEndpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: config.client.clientName,
          redirect_uris: [config.redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      },
      resource,
      config.issuer,
      scopes,
      "dynamic client registration",
    );
    const object = requireJsonObject(
      registration,
      "registration",
      "authorization-server-metadata",
    );
    const clientId = requireString(
      object.client_id,
      "client_id",
      "authorization-server-metadata",
    );
    const clientSecret = optionalString(
      object.client_secret,
      "client_secret",
      "authorization-server-metadata",
    );
    const client = {
      clientId,
      ...(clientSecret !== undefined ? { clientSecret } : {}),
    };
    this.oauthClients.set(cacheKey, client);
    return client;
  }

  private async runAuthorizationCodeFlow(
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    metadata: McpAuthorizationServerMetadata,
    client: McpOAuthResolvedClient,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpOAuthTokenSet> {
    if (!this.authorizationResolver) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "interactive authorization is required but no MCP authorization resolver is configured; configure an operator authorization resolver or static headers for this server",
      );
    }

    const codeVerifier = generateOAuthVerifier();
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
    const state = generateOAuthState();
    const authorizationUrl = new URL(metadata.authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", client.clientId);
    authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("resource", resource);
    authorizationUrl.searchParams.set("scope", scopes.join(" "));
    authorizationUrl.searchParams.set("state", state);

    const callback = await this.authorizationResolver({
      server: this.serverName,
      resource,
      issuer: config.issuer,
      scopes: [...scopes],
      authorizationUrl: authorizationUrl.toString(),
      state,
    });
    const code = this.validateAuthorizationCallback(
      callback.callbackUrl.reveal(),
      config,
      metadata,
      resource,
      scopes,
      state,
    );
    const token = await this.exchangeAuthorizationCode(
      metadata,
      config,
      client,
      resource,
      scopes,
      code,
      codeVerifier,
    );
    return token.scopes.length > 0 ? token : { ...token, scopes: [...scopes] };
  }

  private validateAuthorizationCallback(
    callbackUrl: string,
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    metadata: McpAuthorizationServerMetadata,
    resource: string,
    scopes: readonly string[],
    state: string,
  ): string {
    const callback = new URL(callbackUrl);
    const expectedRedirect = new URL(config.redirectUri);
    if (
      callback.origin !== expectedRedirect.origin ||
      callback.pathname !== expectedRedirect.pathname
    ) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback URL did not match the configured redirectUri",
      );
    }
    const returnedState = callback.searchParams.get("state");
    if (returnedState !== state) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback state did not match the authorization request",
      );
    }
    const callbackIssuer = callback.searchParams.get("iss");
    if (metadata.authorizationResponseIssuerRequired && callbackIssuer === null) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback issuer parameter is required by authorization-server metadata",
      );
    }
    if (callbackIssuer !== null && callbackIssuer !== config.issuer) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback issuer did not match the selected authorization server",
      );
    }
    const callbackError = callback.searchParams.get("error");
    if (callbackError !== null) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        `OAuth callback returned error "${callbackError}"`,
      );
    }
    const code = callback.searchParams.get("code");
    if (code === null || code.length === 0) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback did not include an authorization code",
      );
    }
    return code;
  }

  private async exchangeAuthorizationCode(
    metadata: McpAuthorizationServerMetadata,
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    client: McpOAuthResolvedClient,
    resource: string,
    scopes: readonly string[],
    code: string,
    codeVerifier: string,
  ): Promise<McpOAuthTokenSet> {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: client.clientId,
      code_verifier: codeVerifier,
      resource,
      scope: scopes.join(" "),
    });
    if (client.clientSecret !== undefined) {
      form.set("client_secret", client.clientSecret);
    }
    const tokenJson = await this.fetchOAuthJson(
      metadata.tokenEndpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
      resource,
      config.issuer,
      scopes,
      "token endpoint",
    );
    return decodeOAuthTokenSet(tokenJson);
  }

  private async refreshExpiredOAuthTokenIfNeeded(): Promise<void> {
    if (this.transport.type !== "http" || !this.transport.authorization) return;
    const binding = this.oauthTokenBinding;
    if (!binding?.token.refreshToken || binding.token.expiresAtMs === undefined) return;
    if (Date.now() < binding.token.expiresAtMs) return;

    const config = this.transport.authorization;
    const scopes = binding.token.scopes.length > 0
      ? binding.token.scopes
      : config.scopes;
    const metadata = await this.fetchAuthorizationServerMetadata(
      config,
      binding.resource,
      scopes,
    );
    const client = await this.resolveOAuthClient(
      config,
      metadata,
      binding.resource,
      scopes,
    );
    const refreshed = await this.refreshOAuthToken(
      metadata,
      config,
      client,
      binding,
      scopes,
    );
    this.oauthTokenBinding = {
      resource: binding.resource,
      issuer: binding.issuer,
      token: refreshed.scopes.length > 0
        ? refreshed
        : { ...refreshed, scopes: binding.token.scopes },
    };
  }

  private async refreshOAuthToken(
    metadata: McpAuthorizationServerMetadata,
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    client: McpOAuthResolvedClient,
    binding: McpOAuthTokenBinding,
    scopes: readonly string[],
  ): Promise<McpOAuthTokenSet> {
    if (!binding.token.refreshToken) return binding.token;
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: binding.token.refreshToken,
      client_id: client.clientId,
      resource: binding.resource,
      scope: scopes.join(" "),
    });
    if (client.clientSecret !== undefined) {
      form.set("client_secret", client.clientSecret);
    }
    const tokenJson = await this.fetchOAuthJson(
      metadata.tokenEndpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
      binding.resource,
      config.issuer,
      scopes,
      "token endpoint",
    );
    return decodeOAuthTokenSet(tokenJson, binding.token.refreshToken);
  }

  private async fetchOAuthJson(
    url: string,
    init: RequestInit,
    resource: string,
    issuer: string,
    scopes: readonly string[],
    label: string,
  ): Promise<JsonRpcResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      const message = err instanceof Error && err.name === "AbortError"
        ? `request timed out after ${CONNECT_TIMEOUT}ms`
        : err instanceof Error ? err.message : String(err);
      throw this.authorizationFlowError(resource, issuer, scopes, `${label} failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw this.authorizationFlowError(
        resource,
        issuer,
        scopes,
        `${label} failed: HTTP ${response.status}`,
      );
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw this.authorizationFlowError(
        resource,
        issuer,
        scopes,
        `${label} failed: unsupported response content-type "${contentType || "(missing)"}"`,
      );
    }
    try {
      return JSON.parse(await response.text()) as JsonRpcResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw this.authorizationFlowError(resource, issuer, scopes, `${label} returned malformed JSON: ${message}`);
    }
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

  private parseSseJsonRpcResponse(
    text: string,
    method: string,
    requestId: number,
  ): JsonRpcIncomingMessage {
    const messages = this.parseSseDataMessages(text);
    let finalMessage: JsonRpcIncomingMessage | null = null;
    for (const data of messages) {
      const message = this.parseJsonRpcHttpMessage(data, method);
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
          `response id ${message.id} did not match request id ${requestId}`,
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

  private sensitiveValuesForRedaction(): string[] {
    const values: string[] = [];
    const add = (value: string | undefined) => {
      if (value && value.length > 0) values.push(value);
    };
    if (this.transport.type === "http") {
      for (const [key, value] of Object.entries(this.transport.headers ?? {})) {
        if (key.toLowerCase() !== "authorization") continue;
        add(value);
        const bearer = /^Bearer\s+(.+)$/i.exec(value);
        add(bearer?.[1]);
      }
      const client = this.transport.authorization?.client;
      if (client?.kind === "registered") {
        add(client.clientSecret);
      }
    }
    add(this.oauthTokenBinding?.token.accessToken);
    add(this.oauthTokenBinding?.token.refreshToken);
    return [...new Set(values)].sort((left, right) => right.length - left.length);
  }

  private redactSensitiveErrorMessage(message: string): string {
    let redacted = message;
    for (const value of this.sensitiveValuesForRedaction()) {
      redacted = redacted.replace(new RegExp(escapeRegExp(value), "g"), "[redacted]");
    }
    return redacted;
  }

  private requestErrorForMethod(method: string, message: string): Error {
    const redactedMessage = this.redactSensitiveErrorMessage(message);
    if (method === "tools/call" || method === "resources/read" || method === "prompts/get") {
      return new McpToolError(this.serverName, method, redactedMessage);
    }
    return new McpConnectionError(this.serverName, method, redactedMessage);
  }

  private defaultServerNameForTransport(): string {
    if (this.transport.type === "stdio") return this.transport.command;
    return this.transport.url;
  }

  private openListChangedSubscription(): void {
    if (this.transport.type === "http") {
      this.openHttpListChangedSubscription();
      return;
    }
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

  private openHttpListChangedSubscription(): void {
    if (this.transport.type !== "http" || this.httpListSubscriptionAbort !== null) return;
    const id = this.nextId++;
    this.toolListSubscriptionId = id;
    const notifications = {
      ...(this.toolsListChanged ? { toolsListChanged: true } : {}),
      ...(this.resourcesListChanged ? { resourcesListChanged: true } : {}),
      ...(this.promptsListChanged ? { promptsListChanged: true } : {}),
    };
    const params: JsonRpcParams = {
      _meta: this.draftRequestMeta(),
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
      console.error(
        `[kota] Warning: MCP server "${this.serverName}" failed to open subscription: ${message}`,
      );
    });
  }

  private async runHttpListChangedSubscription(
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
      const text = await response.text();
      throw this.requestErrorForMethod(
        "subscriptions/listen",
        `HTTP ${response.status}: ${text || response.statusText || "empty response"}`,
      );
    }
    await this.consumeSseJsonRpcMessageStream(
      response,
      "subscriptions/listen",
      (message) => {
        if (typeof message.id === "number" && message.id === id) {
          this.handleStreamingRequestResponse(message);
          return;
        }
        if (typeof message.method === "string") {
          this.handleNotification(message);
        }
      },
      { ignoreAbort: true },
    );
    if (this.httpListSubscriptionAbort === controller) {
      this.httpListSubscriptionAbort = null;
      this.toolListSubscriptionId = null;
    }
  }

  private async consumeSseJsonRpcMessageStream(
    response: Response,
    method: string,
    onMessage: (message: JsonRpcIncomingMessage) => boolean | void,
    options: { ignoreAbort?: boolean } = {},
  ): Promise<void> {
    if (!response.body) {
      for (const data of this.parseSseDataMessages(await response.text())) {
        if (onMessage(this.parseJsonRpcHttpMessage(data, method)) === true) return;
      }
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dataLines: string[] = [];
    let shouldStop = false;
    const flush = () => {
      if (dataLines.length === 0) return;
      shouldStop =
        onMessage(this.parseJsonRpcHttpMessage(dataLines.join("\n"), method)) === true;
      dataLines = [];
    };
    const consumeLine = (line: string) => {
      if (line.length === 0) {
        flush();
        return;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    };
    try {
      while (true) {
        if (shouldStop) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.search(/\r?\n/);
        while (newlineIndex !== -1 && !shouldStop) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          const newlineLength = buffer[newlineIndex] === "\r" && buffer[newlineIndex + 1] === "\n" ? 2 : 1;
          buffer = buffer.slice(newlineIndex + newlineLength);
          consumeLine(line);
          newlineIndex = buffer.search(/\r?\n/);
        }
      }
      if (shouldStop) {
        await reader.cancel();
      } else {
        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.length > 0) consumeLine(buffer);
        flush();
      }
    } catch (err) {
      if (options.ignoreAbort && err instanceof Error && err.name === "AbortError") return;
      throw err;
    } finally {
      reader.releaseLock();
    }
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

  private warnDeprecatedServerCapabilities(result: McpInitializeResult): void {
    if (!result.loggingSupported) return;
    this.warnDeprecatedCapability(
      "logging",
      result.protocolVersion,
      "server logging capability",
    );
  }

  private warnDeprecatedInputRequiredResult(
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

  private warnDeprecatedCapability(
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
