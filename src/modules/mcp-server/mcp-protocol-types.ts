/**
 * Cross-cutting JSON-RPC and MCP protocol types shared by the orchestrator
 * (`server.ts`) and the per-feature handler files. Single-feature types stay
 * in their owning handler module.
 */

import type {
	KotaJsonObject,
	KotaJsonValue,
	KotaMcpAnnotations,
	KotaMcpPreservedContent,
} from "#core/agent-harness/message-protocol.js";
import {
	MCP_UI_EXTENSION_ID,
	MCP_UI_RESOURCE_MIME_TYPE,
} from "./mcp-apps.js";

export const MCP_LEGACY_PROTOCOL_VERSION = "2024-11-05";
export const MCP_CURRENT_PROTOCOL_VERSION = "2025-11-25";
export const MCP_DRAFT_PROTOCOL_VERSION = "DRAFT-2026-v1";
export const MCP_CURRENT_STABLE_PROTOCOL_VERSIONS = [MCP_CURRENT_PROTOCOL_VERSION] as const;
export const MCP_DRAFT_PROTOCOL_VERSIONS = [MCP_DRAFT_PROTOCOL_VERSION] as const;
export const MCP_MODERN_PROTOCOL_VERSIONS = [
	MCP_CURRENT_PROTOCOL_VERSION,
	MCP_DRAFT_PROTOCOL_VERSION,
] as const;
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
	MCP_CURRENT_PROTOCOL_VERSION,
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_LEGACY_PROTOCOL_VERSION,
] as const;

export const MCP_META_PROTOCOL_VERSION_KEY =
	"io.modelcontextprotocol/protocolVersion";
export const MCP_META_CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
export const MCP_META_CLIENT_CAPABILITIES_KEY =
	"io.modelcontextprotocol/clientCapabilities";
export const MCP_META_LOG_LEVEL_KEY = "io.modelcontextprotocol/logLevel";
export const MCP_TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks";

export const MCP_LOG_LEVELS = [
	"debug",
	"info",
	"notice",
	"warning",
	"error",
	"critical",
	"alert",
	"emergency",
] as const;

export type McpLogLevel = typeof MCP_LOG_LEVELS[number];

export type McpProtocolVersion =
	| typeof MCP_LEGACY_PROTOCOL_VERSION
	| typeof MCP_CURRENT_PROTOCOL_VERSION
	| typeof MCP_DRAFT_PROTOCOL_VERSION;

export type McpModernProtocolVersion =
	| typeof MCP_CURRENT_PROTOCOL_VERSION
	| typeof MCP_DRAFT_PROTOCOL_VERSION;

export type McpProtocolBooleanFeature =
	| "requestMetadata"
	| "sessionScopedRequests"
	| "completeToolResult"
	| "listChangedSubscriptions"
	| "tasksExtension"
	| "skillsExtension"
	| "elicitation"
	| "multiRoundTripRequests"
	| "draftCompatibilityWarnings"
	| "legacyDraftTaskCompatibility";

export type McpProtocolCapabilities = {
	revision: "legacy" | "current-stable" | "active-draft";
	requestMetadata: boolean;
	sessionScopedRequests: boolean;
	completeToolResult: boolean;
	listChangedSubscriptions: boolean;
	tasksExtension: boolean;
	skillsExtension: boolean;
	elicitation: boolean;
	multiRoundTripRequests: boolean;
	draftCompatibilityWarnings: boolean;
	legacyDraftTaskCompatibility: boolean;
};

const MCP_PROTOCOL_CAPABILITIES: Record<McpProtocolVersion, McpProtocolCapabilities> = {
	[MCP_LEGACY_PROTOCOL_VERSION]: {
		revision: "legacy",
		requestMetadata: false,
		sessionScopedRequests: true,
		completeToolResult: false,
		listChangedSubscriptions: false,
		tasksExtension: false,
		skillsExtension: false,
		elicitation: false,
		multiRoundTripRequests: false,
		draftCompatibilityWarnings: false,
		legacyDraftTaskCompatibility: false,
	},
	[MCP_CURRENT_PROTOCOL_VERSION]: {
		revision: "current-stable",
		requestMetadata: true,
		sessionScopedRequests: true,
		completeToolResult: true,
		listChangedSubscriptions: true,
		tasksExtension: true,
		skillsExtension: false,
		elicitation: true,
		multiRoundTripRequests: true,
		draftCompatibilityWarnings: false,
		legacyDraftTaskCompatibility: false,
	},
	[MCP_DRAFT_PROTOCOL_VERSION]: {
		revision: "active-draft",
		requestMetadata: true,
		sessionScopedRequests: false,
		completeToolResult: true,
		listChangedSubscriptions: true,
		tasksExtension: true,
		skillsExtension: true,
		elicitation: true,
		multiRoundTripRequests: true,
		draftCompatibilityWarnings: true,
		legacyDraftTaskCompatibility: true,
	},
};

export function isMcpProtocolVersion(value: string): value is McpProtocolVersion {
	return (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

export function isMcpModernProtocolVersion(value: string): value is McpModernProtocolVersion {
	return (MCP_MODERN_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

export function mcpProtocolCapabilities(
	protocolVersion: McpProtocolVersion,
): McpProtocolCapabilities {
	return MCP_PROTOCOL_CAPABILITIES[protocolVersion];
}

export function mcpProtocolSupports(
	protocolVersion: McpProtocolVersion,
	feature: McpProtocolBooleanFeature,
): boolean {
	return mcpProtocolCapabilities(protocolVersion)[feature];
}

export type McpProgressToken = string | number;

export type McpCacheScope = "public" | "private";

export type McpCacheHints = {
	ttlMs: number;
	cacheScope: McpCacheScope;
};

export const MCP_PUBLIC_CATALOG_CACHE_HINTS: McpCacheHints = {
	ttlMs: 60_000,
	cacheScope: "public",
};

export const MCP_PRIVATE_RESOURCE_CACHE_HINTS: McpCacheHints = {
	ttlMs: 0,
	cacheScope: "private",
};

export type JsonRpcRequest = {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: KotaJsonObject;
};

export type JsonRpcNotification = {
	jsonrpc: "2.0";
	method: string;
	params?: KotaJsonObject;
};

export type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: number | string;
	result?: KotaJsonValue;
	error?: { code: number; message: string; data?: KotaJsonValue };
};

export type JsonRpcErrorObject = NonNullable<JsonRpcResponse["error"]>;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

export const MCP_RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task";

export const MCP_TASK_STATUSES = [
	"working",
	"input_required",
	"completed",
	"failed",
	"cancelled",
] as const;

export type McpTaskStatus = typeof MCP_TASK_STATUSES[number];

export const MCP_TASK_TERMINAL_STATUSES = [
	"completed",
	"failed",
	"cancelled",
] as const;

export type McpTaskTerminalStatus = typeof MCP_TASK_TERMINAL_STATUSES[number];

export type McpTask = {
	taskId: string;
	status: McpTaskStatus;
	statusMessage?: string;
	createdAt: string;
	lastUpdatedAt: string;
	ttlMs: number;
	pollIntervalMs: number;
	inputRequests?: McpInputRequests;
	requestState?: string;
	result?: KotaJsonValue;
	error?: JsonRpcErrorObject;
};

export type McpCreateTaskResult = McpTask & {
	resultType: "task";
	_meta?: KotaJsonObject;
};

export type McpStoredTaskTerminalResult =
	| { kind: "result"; result: KotaJsonValue }
	| { kind: "error"; error: JsonRpcErrorObject };

export type McpTaskListPage = {
	tasks: McpTask[];
	nextCursor?: string;
};

export function isMcpTaskTerminalStatus(
	status: McpTaskStatus,
): status is McpTaskTerminalStatus {
	return (MCP_TASK_TERMINAL_STATUSES as readonly McpTaskStatus[]).includes(status);
}

export type McpContentBlock =
	| {
			type: "text";
			text: string;
			annotations?: KotaMcpAnnotations;
			_meta?: KotaJsonObject;
		}
	| {
			type: "image";
			data: string;
			mimeType: string;
			annotations?: KotaMcpAnnotations;
			_meta?: KotaJsonObject;
		}
	| KotaMcpPreservedContent;

/** A workspace root advertised by the MCP client via the `roots/list` response. */
export type McpRoot = { uri: string; name?: string };

/** Simplified JSON Schema subset supported by MCP elicitation. */
export type ElicitationSchema = {
	type: "object";
	properties: Record<
		string,
		{ type: "string" | "number" | "boolean"; title?: string; description?: string; enum?: string[] }
	>;
	required?: string[];
};

export type ElicitationResponse =
	| { action: "accept"; content?: KotaJsonObject }
	| { action: "decline" }
	| { action: "cancel" };

export type McpElicitationMode = "form" | "url";

export type McpFormElicitationInputRequest = {
	method: "elicitation/create";
	params: {
		mode: "form";
		message: string;
		requestedSchema: ElicitationSchema;
	};
};

export type McpUrlElicitationInputRequest = {
	method: "elicitation/create";
	params: {
		mode: "url";
		message: string;
		url: string;
		elicitationId: string;
	};
};

export type McpElicitationInputRequest =
	| McpFormElicitationInputRequest
	| McpUrlElicitationInputRequest;

export type McpRootsInputRequest = {
	method: "roots/list";
	params?: KotaJsonObject;
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
	content: McpContentBlock[];
	structuredContent?: KotaJsonObject;
	isError?: boolean;
	_meta?: KotaJsonObject;
};

export type McpSamplingContentBlock =
	| Extract<McpContentBlock, { type: "text" | "image" }>
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

export type McpSamplingTool = {
	name: string;
	description?: string;
	inputSchema: KotaJsonObject;
	outputSchema?: KotaJsonObject;
};

export type McpSamplingToolChoice = {
	mode?: "none" | "required" | "auto";
};

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

export type McpInputRequest =
	| McpElicitationInputRequest
	| McpRootsInputRequest
	| McpSamplingInputRequest;

export type McpInputRequests = { [requestId: string]: McpInputRequest };

export type McpRootsInputResponse = { roots: McpRoot[] };
export type McpSamplingCreateMessageResult = {
	role: "user" | "assistant";
	content: McpSamplingContentBlock | McpSamplingContentBlock[];
	model: string;
	stopReason?: string;
	_meta?: KotaJsonObject;
};
export type McpInputResponse =
	| ElicitationResponse
	| McpRootsInputResponse
	| McpSamplingCreateMessageResult;
export type McpInputResponses = { [requestId: string]: McpInputResponse };

export type McpToolCompleteResult = {
	resultType: "complete";
	content: McpContentBlock[];
	structuredContent?: KotaJsonObject;
	_meta?: KotaJsonObject;
	isError: boolean;
};

type McpInputRequiredResultFields =
	| {
			inputRequests: McpInputRequests;
			requestState?: string;
		}
	| {
			inputRequests?: McpInputRequests;
			requestState: string;
		};

export type McpInputRequiredResult = McpInputRequiredResultFields & {
	resultType: "input_required";
};

export type McpTaskResultSettlement =
	| {
			kind: "terminal";
			task: McpTask;
			terminal: McpStoredTaskTerminalResult;
		}
	| {
			kind: "input_required";
			task: McpTask;
			inputRequired: McpInputRequiredResult;
		};

export type McpToolInputRequest = McpElicitationInputRequest;
export type McpToolInputRequests = McpInputRequests;
export type McpToolInputResponses = McpInputResponses;
export type McpToolInputRequiredResult = McpInputRequiredResult;

export type McpToolResult = McpToolCompleteResult | McpInputRequiredResult;

/**
 * Transport-side surface every per-feature handler uses to write JSON-RPC
 * frames back to the client. The orchestrator owns the underlying writer.
 */
export type JsonRpcOutboundPayload = object | string | number | boolean | null;

export type McpTransport = {
	send(msg: JsonRpcOutboundPayload): void;
	sendResult(msg: JsonRpcRequest, result: JsonRpcOutboundPayload): void;
	sendError(msg: JsonRpcRequest, code: number, message: string, data?: JsonRpcOutboundPayload): void;
	sendNotification(method: string, params: KotaJsonObject): void;
};

export type McpImplementation = {
	name: string;
	version: string;
};

export type McpClientCapabilities = KotaJsonObject;

export type McpElicitationClientCapabilities = {
	form: boolean;
	url: boolean;
};

export type McpUiClientCapabilities = {
	supported: boolean;
};

export type McpTasksClientCapabilities = {
	supported: boolean;
};

export type McpUiClientCapabilityDecodeResult =
	| { ok: true; capabilities: McpUiClientCapabilities }
	| { ok: false; message: string };

export type McpTasksClientCapabilityDecodeResult =
	| { ok: true; capabilities: McpTasksClientCapabilities }
	| { ok: false; message: string };

export type McpRequestContext = {
	protocolVersion: McpModernProtocolVersion;
	clientInfo: McpImplementation;
	clientCapabilities: McpClientCapabilities;
	requestId: JsonRpcRequest["id"];
	logLevel?: McpLogLevel;
	progressToken?: McpProgressToken;
};

export type McpLogOptions = {
	level?: McpLogLevel;
	logger?: string;
	data?: KotaJsonValue;
};

/**
 * Mutable cross-feature session state. The orchestrator owns the instance and
 * passes a reference to each handler that needs to read or update it. Stays
 * intentionally narrow — only the handshake-level flags shared across feature
 * areas live here. Feature-private state lives on the owning handler.
 */
export type SessionState = {
	initialized: boolean;
	protocolVersion: McpProtocolVersion;
	clientCapabilities: McpClientCapabilities;
	clientElicitation: McpElicitationClientCapabilities;
	clientSupportsRoots: boolean;
};

/** Shared dependencies every feature handler receives from the orchestrator. */
export type HandlerContext = {
	transport: McpTransport;
	log: (msg: string, options?: McpLogOptions) => void;
	session: SessionState;
	getRequestContext: () => McpRequestContext | null;
	sendProgress: (
		progress: number,
		details?: { total?: number; message?: string },
	) => void;
};

export function isMcpProgressToken(value: KotaJsonValue | undefined): value is McpProgressToken {
	return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

export function mcpProgressTokenKey(token: McpProgressToken): string {
	return `${typeof token}:${String(token)}`;
}

function hasObjectCapability(
	capabilities: McpClientCapabilities,
	key: string,
): boolean {
	const value = capabilities[key];
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProtocolObject(value: KotaJsonValue | undefined): value is KotaJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeClientElicitationCapabilities(
	capabilities: McpClientCapabilities,
): McpElicitationClientCapabilities {
	const value = capabilities.elicitation;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { form: false, url: false };
	}

	const form = hasObjectCapability(value, "form");
	const url = hasObjectCapability(value, "url");
	const legacyEmptyObject = Object.keys(value).length === 0;
	return {
		form: form || legacyEmptyObject,
		url,
	};
}

export function decodeClientMcpUiCapabilities(
	capabilities: McpClientCapabilities,
): McpUiClientCapabilityDecodeResult {
	const extensions = capabilities.extensions;
	if (extensions === undefined) return { ok: true, capabilities: { supported: false } };
	if (!isProtocolObject(extensions)) {
		return { ok: false, message: "Malformed MCP client capability: extensions" };
	}

	const uiCapability = extensions[MCP_UI_EXTENSION_ID];
	if (uiCapability === undefined) return { ok: true, capabilities: { supported: false } };
	if (!isProtocolObject(uiCapability)) {
		return {
			ok: false,
			message: `Malformed MCP client extension capability: ${MCP_UI_EXTENSION_ID}`,
		};
	}

	const mimeTypes = uiCapability.mimeTypes;
	if (mimeTypes === undefined) return { ok: true, capabilities: { supported: false } };
	if (!Array.isArray(mimeTypes) || mimeTypes.some((mimeType) => typeof mimeType !== "string")) {
		return {
			ok: false,
			message: `Malformed MCP client extension capability: ${MCP_UI_EXTENSION_ID}.mimeTypes`,
		};
	}

	return {
		ok: true,
		capabilities: { supported: mimeTypes.includes(MCP_UI_RESOURCE_MIME_TYPE) },
	};
}

export function decodeClientMcpTasksCapabilities(
	capabilities: McpClientCapabilities,
): McpTasksClientCapabilityDecodeResult {
	const extensions = capabilities.extensions;
	if (extensions === undefined) return { ok: true, capabilities: { supported: false } };
	if (!isProtocolObject(extensions)) {
		return { ok: false, message: "Malformed MCP client capability: extensions" };
	}

	const tasksCapability = extensions[MCP_TASKS_EXTENSION_ID];
	if (tasksCapability === undefined) return { ok: true, capabilities: { supported: false } };
	if (!isProtocolObject(tasksCapability)) {
		return {
			ok: false,
			message: `Malformed MCP client extension capability: ${MCP_TASKS_EXTENSION_ID}`,
		};
	}

	return { ok: true, capabilities: { supported: true } };
}

export function hasSessionScopedMcpContext(session: SessionState): boolean {
	return session.initialized &&
		mcpProtocolSupports(session.protocolVersion, "sessionScopedRequests");
}

export function hasActiveMcpContext(ctx: HandlerContext): boolean {
	return ctx.getRequestContext() !== null || hasSessionScopedMcpContext(ctx.session);
}

export function activeMcpProtocolVersion(ctx: HandlerContext): McpProtocolVersion {
	return ctx.getRequestContext()?.protocolVersion ?? ctx.session.protocolVersion;
}

export function activeClientSupportsElicitation(
	ctx: HandlerContext,
	mode: McpElicitationMode = "form",
): boolean {
	const request = ctx.getRequestContext();
	if (request) {
		return decodeClientElicitationCapabilities(request.clientCapabilities)[mode];
	}
	return ctx.session.clientElicitation[mode];
}

export function activeClientSupportsMcpUi(ctx: HandlerContext): boolean {
	const request = ctx.getRequestContext();
	const capabilities = request?.clientCapabilities ??
		(hasSessionScopedMcpContext(ctx.session) ? ctx.session.clientCapabilities : null);
	if (!capabilities) return false;
	const decoded = decodeClientMcpUiCapabilities(capabilities);
	return decoded.ok && decoded.capabilities.supported;
}

export function activeClientSupportsMcpTasks(ctx: HandlerContext): boolean {
	const request = ctx.getRequestContext();
	const protocolVersion = request?.protocolVersion ??
		(hasSessionScopedMcpContext(ctx.session) ? ctx.session.protocolVersion : null);
	if (!protocolVersion || !mcpProtocolSupports(protocolVersion, "tasksExtension")) return false;
	const capabilities = request?.clientCapabilities ?? ctx.session.clientCapabilities;
	const decoded = decodeClientMcpTasksCapabilities(capabilities);
	return decoded.ok && decoded.capabilities.supported;
}

export function activeClientSupportsLegacyDraftTasks(ctx: HandlerContext): boolean {
	const request = ctx.getRequestContext();
	if (!request) return false;
	if (!mcpProtocolSupports(request.protocolVersion, "legacyDraftTaskCompatibility")) return false;
	return hasObjectCapability(request.clientCapabilities, "tasks");
}

export function activeClientSupportsRoots(ctx: HandlerContext): boolean {
	const request = ctx.getRequestContext();
	if (request) {
		return hasObjectCapability(request.clientCapabilities, "roots");
	}
	return ctx.session.clientSupportsRoots;
}
