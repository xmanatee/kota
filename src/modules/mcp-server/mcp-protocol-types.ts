/**
 * Cross-cutting JSON-RPC and MCP protocol types shared by the orchestrator
 * (`server.ts`) and the per-feature handler files. Single-feature types stay
 * in their owning handler module.
 */

import type {
	KotaJsonObject,
	KotaMcpAnnotations,
	KotaMcpPreservedContent,
} from "#core/agent-harness/message-protocol.js";

export const MCP_LEGACY_PROTOCOL_VERSION = "2024-11-05";
export const MCP_DRAFT_PROTOCOL_VERSION = "DRAFT-2026-v1";

export type McpProtocolVersion =
	| typeof MCP_LEGACY_PROTOCOL_VERSION
	| typeof MCP_DRAFT_PROTOCOL_VERSION;

export type JsonRpcRequest = {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: Record<string, unknown>;
};

export type JsonRpcNotification = {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: { code: number; message: string };
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
	| { action: "accept"; content: Record<string, unknown> }
	| { action: "reject" }
	| { action: "cancel" };

export type McpToolInputRequest = {
	method: "elicitation/create";
	params: {
		mode: "form";
		message: string;
		requestedSchema: ElicitationSchema;
	};
};

export type McpToolInputRequests = { [requestId: string]: McpToolInputRequest };
export type McpToolInputResponses = { [requestId: string]: ElicitationResponse };

export type McpToolCompleteResult = {
	resultType: "complete";
	content: McpContentBlock[];
	structuredContent?: KotaJsonObject;
	_meta?: KotaJsonObject;
	isError: boolean;
};

export type McpToolInputRequiredResult = {
	resultType: "input_required";
	inputRequests: McpToolInputRequests;
	requestState: string;
};

export type McpToolResult = McpToolCompleteResult | McpToolInputRequiredResult;

/**
 * Transport-side surface every per-feature handler uses to write JSON-RPC
 * frames back to the client. The orchestrator owns the underlying writer.
 */
export type McpTransport = {
	send(msg: unknown): void;
	sendResult(msg: JsonRpcRequest, result: unknown): void;
	sendError(msg: JsonRpcRequest, code: number, message: string): void;
	sendNotification(method: string, params: Record<string, unknown>): void;
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
	clientSupportsElicitation: boolean;
	clientSupportsRoots: boolean;
};

/** Shared dependencies every feature handler receives from the orchestrator. */
export type HandlerContext = {
	transport: McpTransport;
	log: (msg: string) => void;
	session: SessionState;
};
