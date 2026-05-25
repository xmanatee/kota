import type {
  KotaJsonObject,
  KotaJsonValue,
  KotaMcpAnnotations,
  KotaMcpIcon,
  KotaMcpPreservedContent,
  KotaMcpResourceContents,
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

export type McpToolArguments = Record<string, unknown>;

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: McpToolArguments;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: McpToolArguments;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type JsonRpcParams = JsonRpcRequest["params"];
export type JsonRpcResult = JsonRpcResponse["result"];
export type JsonRpcError = NonNullable<JsonRpcResponse["error"]>;
export type JsonRpcIncomingMessage = {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: McpToolArguments;
  result?: JsonRpcResult;
  error?: JsonRpcError;
};

export type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export type McpResultKind =
  | "initialize"
  | "authorization-server-metadata"
  | "oauth-token"
  | "protected-resource-metadata"
  | "server/discover"
  | "tasks/cancel"
  | "tasks/get"
  | "tasks/update"
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
export type McpRejectedToolDefinition = {
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
export const MCP_TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks";

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

export type McpCompleteResultFields = {
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

export const MCP_TASK_STATUSES = [
  "working",
  "input_required",
  "completed",
  "failed",
  "cancelled",
] as const;

export type McpTaskStatus = typeof MCP_TASK_STATUSES[number];

export type McpTaskState = {
  resultType?: "task";
  taskId: string;
  status: McpTaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number | null;
  pollIntervalMs?: number;
  statusMessage?: string;
  inputRequests?: McpToolInputRequests;
  requestState?: string;
  result?: KotaJsonValue;
  error?: JsonRpcError;
  _meta?: KotaJsonObject;
};

export type McpCreateTaskResult = McpTaskState & {
  resultType: "task";
  protocolVersion: McpProtocolVersion;
};

export type McpGetTaskResult = McpTaskState;

export type McpTaskAckResult = {
  resultType: "complete";
  _meta?: KotaJsonObject;
};

export type McpUpdateTaskResult = McpTaskAckResult;

export type McpCancelTaskResult = McpTaskAckResult;

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
  | McpInputRequiredCallToolResult
  | McpCreateTaskResult;

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


export const CONNECT_TIMEOUT = 10_000;
export const CALL_TIMEOUT = 120_000;
export const DEFAULT_MAX_PROGRESS_EVENTS = 20;
export const MAX_PROGRESS_WARNINGS = 20;
export const MCP_HEADER_ANNOTATION = "x-mcp-header";
export const KOTA_MCP_CLIENT_INFO = { name: "kota", version: "0.1.0" } as const;
export const MCP_META_PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
export const MCP_META_CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
export const MCP_META_CLIENT_CAPABILITIES_KEY =
  "io.modelcontextprotocol/clientCapabilities";
export const MCP_LOG_LEVELS = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
] as const satisfies readonly McpLogLevel[];

export type McpInitializeResult = {
  protocolVersion: McpProtocolVersion;
  toolsSupported: boolean;
  toolsListChanged: boolean;
  resourcesSupported: boolean;
  resourcesListChanged: boolean;
  promptsSupported: boolean;
  promptsListChanged: boolean;
  loggingSupported: boolean;
  tasksSupported: boolean;
  serverInfo?: { name?: string };
};

export type ActiveProgressRequest = {
  requestId: number;
  progressToken: McpProgressToken;
  lastProgress: number | null;
  sequence: number;
  maxEvents: number;
  droppedEvents: number;
  dropWarningEmitted: boolean;
  onProgress: McpProgressHandler;
};

export type McpHeaderParameterSpec = {
  paramName: string;
  headerName: string;
};

export type DeprecatedMcpFeature = "roots" | "sampling" | "logging";
