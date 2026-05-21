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

export const MCP_LEGACY_PROTOCOL_VERSION = "2024-11-05";
export const MCP_DRAFT_PROTOCOL_VERSION = "DRAFT-2026-v1";
export const MCP_DRAFT_PROTOCOL_VERSIONS = [MCP_DRAFT_PROTOCOL_VERSION] as const;
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_LEGACY_PROTOCOL_VERSION,
] as const;

export const MCP_META_PROTOCOL_VERSION_KEY =
	"io.modelcontextprotocol/protocolVersion";
export const MCP_META_CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
export const MCP_META_CLIENT_CAPABILITIES_KEY =
	"io.modelcontextprotocol/clientCapabilities";

export type McpProtocolVersion =
	| typeof MCP_LEGACY_PROTOCOL_VERSION
	| typeof MCP_DRAFT_PROTOCOL_VERSION;

export type McpProgressToken = string | number;

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

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

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

export type McpSamplingInputRequest = {
	method: "sampling/createMessage";
	params: KotaJsonObject;
};

export type McpInputRequest =
	| McpElicitationInputRequest
	| McpRootsInputRequest
	| McpSamplingInputRequest;

export type McpInputRequests = { [requestId: string]: McpInputRequest };

export type McpRootsInputResponse = { roots: McpRoot[] };
export type McpInputResponse = ElicitationResponse | McpRootsInputResponse | KotaJsonObject;
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

export type McpRequestContext = {
	protocolVersion: typeof MCP_DRAFT_PROTOCOL_VERSION;
	clientInfo: McpImplementation;
	clientCapabilities: McpClientCapabilities;
	requestId: JsonRpcRequest["id"];
	progressToken?: McpProgressToken;
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
	clientElicitation: McpElicitationClientCapabilities;
	clientSupportsRoots: boolean;
};

/** Shared dependencies every feature handler receives from the orchestrator. */
export type HandlerContext = {
	transport: McpTransport;
	log: (msg: string) => void;
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

export function hasLegacySessionContext(session: SessionState): boolean {
	return session.initialized && session.protocolVersion === MCP_LEGACY_PROTOCOL_VERSION;
}

export function hasActiveMcpContext(ctx: HandlerContext): boolean {
	return ctx.getRequestContext() !== null || hasLegacySessionContext(ctx.session);
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

export function activeClientSupportsRoots(ctx: HandlerContext): boolean {
	const request = ctx.getRequestContext();
	if (request) {
		return hasObjectCapability(request.clientCapabilities, "roots");
	}
	return ctx.session.clientSupportsRoots;
}
