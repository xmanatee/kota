import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { KotaJsonObject, KotaJsonValue, KotaTool } from "#core/agent-harness/message-protocol.js";
import {
	type JsonRpcOutboundPayload,
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_DRAFT_PROTOCOL_VERSIONS,
	MCP_META_LOG_LEVEL_KEY,
	MCP_META_PROTOCOL_VERSION_KEY,
} from "./mcp-protocol-types.js";
import type { McpServer } from "./server.js";
import {
	MCP_SERVER_CARD_WELL_KNOWN_PATH,
	readMcpServerCard,
} from "./server-card.js";

const HEADER_MISMATCH_CODE = -32001;
const AUTHORIZATION_ERROR_CODE = -32005;
const UNSUPPORTED_PROTOCOL_VERSION_CODE = -32004;
const DEFAULT_ENDPOINT_PATH = "/mcp";
const HTTP_UNAVAILABLE_METHODS = new Set([
	"resources/subscribe",
	"resources/unsubscribe",
]);

export type StreamableHttpRequest = {
	method: string;
	url: string;
	headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
	body?: string;
};

export type StreamableHttpResponse = {
	status: number;
	headers: Record<string, string>;
	body?: string;
	stream?: StreamableHttpSseStream;
};

type StreamableHttpSseStream = {
	initialMessages: JsonRpcOutboundPayload[];
	subscribe: (
		send: (message: JsonRpcOutboundPayload) => void,
		close?: () => void,
	) => () => void;
};

export type StreamableHttpTokenVerification =
	| {
		ok: true;
		audience: string | string[];
		scopes: string[];
		subject?: string;
	}
	| {
		ok: false;
		reason: "invalid" | "expired" | "wrong_audience";
	};

export type StreamableHttpTokenVerifier = (
	token: string,
	context: {
		resource: string;
		requiredScopes: string[];
		request: StreamableHttpRequest;
	},
) => Promise<StreamableHttpTokenVerification> | StreamableHttpTokenVerification;

export type StreamableHttpAuthorizationOptions = {
	resource: string;
	authorizationServers: string[];
	requiredScopes: string[];
	scopesSupported?: string[];
	metadataPath?: string;
	tokenVerifier: StreamableHttpTokenVerifier;
};

export type StreamableHttpHandlerOptions = {
	endpointPath?: string;
	allowedOrigins?: string[];
	authorization?: StreamableHttpAuthorizationOptions;
};

export type StartStreamableHttpServerOptions = StreamableHttpHandlerOptions & {
	server: McpServer;
	host?: string;
	port?: number;
	log?: (message: string) => void;
};

export type StartedStreamableHttpServer = {
	url: string;
	close: () => Promise<void>;
};

type JsonRpcErrorId = string | number | null | undefined;

type HeaderValidationResult =
	| { ok: true; body: KotaJsonObject }
	| { ok: false; response: StreamableHttpResponse };

type AuthorizationValidationResult =
	| { ok: true }
	| { ok: false; response: StreamableHttpResponse };

type RecognizedParamHeader = {
	headerName: string;
	paramName: string;
};

type ToolInputSchemaProperty = KotaTool["input_schema"]["properties"][string];

export async function handleStreamableHttpRequest(
	server: McpServer,
	request: StreamableHttpRequest,
	options: StreamableHttpHandlerOptions = {},
): Promise<StreamableHttpResponse> {
	const endpointPath = options.endpointPath ?? DEFAULT_ENDPOINT_PATH;
	const requestPath = new URL(request.url, "http://127.0.0.1").pathname;
	if (requestPath === MCP_SERVER_CARD_WELL_KNOWN_PATH) {
		if (request.method !== "GET") {
			return {
				status: 405,
				headers: {
					allow: "GET",
					"content-type": "text/plain",
				},
				body: "Method not allowed",
			};
		}
		try {
			return serverCardResponse(readMcpServerCard());
		} catch {
			return {
				status: 500,
				headers: { "content-type": "text/plain" },
				body: "Server Card unavailable",
			};
		}
	}
	if (options.authorization && requestPath === protectedResourceMetadataPath(endpointPath, options.authorization)) {
		if (request.method !== "GET") {
			return { status: 405, headers: { allow: "GET", "content-type": "text/plain" }, body: "Method not allowed" };
		}
		return jsonResponse(200, protectedResourceMetadata(options.authorization));
	}
	if (requestPath !== endpointPath) {
		return { status: 404, headers: { "content-type": "text/plain" }, body: "Not found" };
	}

	if (!isOriginAllowed(readHeader(request.headers, "origin"), options.allowedOrigins)) {
		return jsonErrorResponse(403, undefined, HEADER_MISMATCH_CODE, "Forbidden: invalid Origin header");
	}

	if (options.authorization) {
		const authorization = await validateProtectedResourceAuthorization(request, endpointPath, options.authorization);
		if (!authorization.ok) return authorization.response;
	}

	if (request.method === "GET") {
		return { status: 405, headers: { allow: "POST", "content-type": "text/plain" }, body: "SSE is not available" };
	}
	if (request.method !== "POST") {
		return { status: 405, headers: { allow: "POST", "content-type": "text/plain" }, body: "Method not allowed" };
	}

	const bodyValidation = validatePostBodyAndHeaders(server, request);
	if (!bodyValidation.ok) return bodyValidation.response;

	if (
		requiresHttpResponseStream(bodyValidation.body) &&
		!accepts(readHeader(request.headers, "accept"), "text/event-stream")
	) {
		return jsonErrorResponse(
			406,
			readJsonRpcId(bodyValidation.body),
			-32602,
			"Response stream requires Accept: text/event-stream",
		);
	}

	if (HTTP_UNAVAILABLE_METHODS.has(String(bodyValidation.body.method))) {
		return jsonErrorResponse(
			404,
			readJsonRpcId(bodyValidation.body),
			-32601,
			`Method not found: ${String(bodyValidation.body.method)}`,
		);
	}

	if (bodyValidation.body.method === "subscriptions/listen") {
		const dispatch = await server.handleJsonRpcMessage(bodyValidation.body);
		if (dispatch.kind === "invalid") {
			return jsonErrorResponse(400, readJsonRpcId(bodyValidation.body), -32600, "Invalid JSON-RPC message");
		}
		const messages = dispatchMessages(dispatch).map((message) =>
			normalizeHttpResponse(bodyValidation.body, message)
		);
		const error = messages.find(isJsonRpcErrorPayload);
		if (error) return jsonResponse(responseStatusForPayload(error), error);
		const requestId = readJsonRpcId(bodyValidation.body);
		if (requestId === null || requestId === undefined) {
			return jsonErrorResponse(400, null, -32600, "Invalid JSON-RPC message");
		}
		return sseResponse(200, messages, {
			subscribe: (send) =>
				server.registerStreamSink(requestId, (message) =>
					send(normalizeHttpResponse(bodyValidation.body, message))
				),
		});
	}

	if (hasHttpRequestScopedStream(bodyValidation.body)) {
		return requestScopedSseResponse(server, bodyValidation.body);
	}

	const dispatch = await server.handleJsonRpcMessage(bodyValidation.body);
	if (dispatch.kind === "invalid") {
		return jsonErrorResponse(400, readJsonRpcId(bodyValidation.body), -32600, "Invalid JSON-RPC message");
	}
	if (dispatch.kind === "accepted") {
		return { status: 202, headers: {} };
	}
	if (dispatch.kind === "stream") {
		if (!accepts(readHeader(request.headers, "accept"), "text/event-stream")) {
			return jsonErrorResponse(
				406,
				readJsonRpcId(bodyValidation.body),
				-32602,
				"Response stream requires Accept: text/event-stream",
			);
		}
		return sseResponse(
			200,
			dispatch.messages.map((message) => normalizeHttpResponse(bodyValidation.body, message)),
		);
	}
	const response = normalizeHttpResponse(bodyValidation.body, dispatch.response);
	const status = responseStatusForPayload(response);
	return jsonResponse(status, response);
}

export async function startMcpStreamableHttpServer(
	options: StartStreamableHttpServerOptions,
): Promise<StartedStreamableHttpServer> {
	const host = options.host ?? "127.0.0.1";
	assertLocalBindHost(host, options.authorization);
	const port = options.port ?? 0;
	const endpointPath = options.endpointPath ?? DEFAULT_ENDPOINT_PATH;
	const httpServer = createServer(async (req, res) => {
		try {
			const body = await readRequestBody(req);
			const response = await handleStreamableHttpRequest(
				options.server,
				{
					method: req.method ?? "",
					url: req.url ?? endpointPath,
					headers: req.headers,
					body,
				},
				{
					endpointPath,
					...(options.allowedOrigins !== undefined && {
						allowedOrigins: options.allowedOrigins,
					}),
					...(options.authorization !== undefined && {
						authorization: options.authorization,
					}),
				},
			);
			writeResponse(res, response);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			writeResponse(res, jsonErrorResponse(500, undefined, -32603, `Internal error: ${message}`));
		}
	});
	await listen(httpServer, port, host);
	const address = httpServer.address();
	if (!address || typeof address === "string") {
		throw new Error("MCP HTTP server did not expose a TCP address");
	}
	const url = `http://${formatAddressHost(address)}:${address.port}${endpointPath}`;
	options.log?.(`MCP Streamable HTTP server listening on ${url}`);
	return {
		url,
		close: () => closeServer(httpServer),
	};
}

async function validateProtectedResourceAuthorization(
	request: StreamableHttpRequest,
	endpointPath: string,
	authorization: StreamableHttpAuthorizationOptions,
): Promise<AuthorizationValidationResult> {
	const authorizationHeader = readHeader(request.headers, "authorization");
	if (!authorizationHeader) {
		return {
			ok: false,
			response: authorizationChallengeResponse(401, endpointPath, authorization),
		};
	}
	const token = readBearerToken(authorizationHeader);
	if (!token) {
		return {
			ok: false,
			response: authorizationChallengeResponse(
				401,
				endpointPath,
				authorization,
				"invalid_request",
			),
		};
	}

	let verification: StreamableHttpTokenVerification;
	try {
		verification = await authorization.tokenVerifier(token, {
			resource: authorization.resource,
			requiredScopes: authorization.requiredScopes,
			request,
		});
	} catch {
		verification = { ok: false, reason: "invalid" };
	}

	if (!verification.ok) {
		return {
			ok: false,
			response: authorizationChallengeResponse(
				401,
				endpointPath,
				authorization,
				"invalid_token",
			),
		};
	}

	if (!audienceMatches(verification.audience, authorization.resource)) {
		return {
			ok: false,
			response: authorizationChallengeResponse(
				401,
				endpointPath,
				authorization,
				"invalid_token",
			),
		};
	}

	const missingScopes = authorization.requiredScopes.filter((scope) => !verification.scopes.includes(scope));
	if (missingScopes.length > 0) {
		return {
			ok: false,
			response: authorizationChallengeResponse(
				403,
				endpointPath,
				authorization,
				"insufficient_scope",
				missingScopes,
			),
		};
	}

	return { ok: true };
}

function readBearerToken(value: string): string | null {
	const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(value);
	return match?.[1] ?? null;
}

function audienceMatches(audience: string | string[], resource: string): boolean {
	return Array.isArray(audience) ? audience.includes(resource) : audience === resource;
}

function protectedResourceMetadata(
	authorization: StreamableHttpAuthorizationOptions,
): KotaJsonObject {
	const scopesSupported = authorization.scopesSupported ?? authorization.requiredScopes;
	return {
		resource: authorization.resource,
		authorization_servers: [...authorization.authorizationServers],
		bearer_methods_supported: ["header"],
		...(scopesSupported.length > 0 && {
			scopes_supported: [...scopesSupported],
		}),
	};
}

function protectedResourceMetadataPath(
	endpointPath: string,
	authorization: StreamableHttpAuthorizationOptions,
): string {
	if (authorization.metadataPath !== undefined) return authorization.metadataPath;
	return endpointPath === "/"
		? "/.well-known/oauth-protected-resource"
		: `/.well-known/oauth-protected-resource${endpointPath}`;
}

function protectedResourceMetadataUrl(
	endpointPath: string,
	authorization: StreamableHttpAuthorizationOptions,
): string {
	return new URL(protectedResourceMetadataPath(endpointPath, authorization), authorization.resource).toString();
}

function authorizationChallengeResponse(
	status: 401 | 403,
	endpointPath: string,
	authorization: StreamableHttpAuthorizationOptions,
	error?: "invalid_request" | "invalid_token" | "insufficient_scope",
	scopes = authorization.requiredScopes,
): StreamableHttpResponse {
	const params: string[] = [];
	if (error) params.push(headerParam("error", error));
	params.push(headerParam("resource_metadata", protectedResourceMetadataUrl(endpointPath, authorization)));
	if (scopes.length > 0) params.push(headerParam("scope", scopes.join(" ")));
	const response = jsonErrorResponse(
		status,
		undefined,
		AUTHORIZATION_ERROR_CODE,
		status === 403
			? "Forbidden: insufficient MCP authorization scope"
			: "Unauthorized: MCP authorization required",
	);
	return {
		...response,
		headers: {
			...response.headers,
			"www-authenticate": `Bearer ${params.join(", ")}`,
		},
	};
}

function headerParam(name: string, value: string): string {
	if (/[\r\n]/.test(value)) {
		throw new Error("MCP authorization challenge values must not contain newlines");
	}
	return `${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function validatePostBodyAndHeaders(
	server: McpServer,
	request: StreamableHttpRequest,
): HeaderValidationResult {
	const accept = readHeader(request.headers, "accept");
	if (!accepts(accept, "application/json")) {
		return {
			ok: false,
			response: jsonErrorResponse(
				406,
				undefined,
				HEADER_MISMATCH_CODE,
				"Accept header must include application/json",
			),
		};
	}
	const contentType = readHeader(request.headers, "content-type");
	if (!contentType?.toLowerCase().split(";")[0]?.trim().includes("application/json")) {
		return {
			ok: false,
			response: jsonErrorResponse(415, undefined, -32600, "Content-Type must be application/json"),
		};
	}

	let parsed: KotaJsonValue;
	try {
		parsed = JSON.parse(request.body ?? "") as KotaJsonValue;
	} catch {
		return { ok: false, response: jsonErrorResponse(400, null, -32700, "Parse error") };
	}
	if (!isJsonObject(parsed) || parsed.jsonrpc !== "2.0") {
		return { ok: false, response: jsonErrorResponse(400, null, -32600, "Invalid JSON-RPC message") };
	}
	const id = readJsonRpcId(parsed);
	const versionHeader = readHeader(request.headers, "mcp-protocol-version");
	if (!versionHeader) {
		return {
			ok: false,
			response: jsonErrorResponse(400, id, HEADER_MISMATCH_CODE, "Header mismatch: missing MCP-Protocol-Version header"),
		};
	}
	if (!isSafeHeaderValue(versionHeader)) {
		return {
			ok: false,
			response: jsonErrorResponse(400, id, HEADER_MISMATCH_CODE, "Header mismatch: malformed MCP-Protocol-Version header"),
		};
	}
	if (versionHeader !== MCP_DRAFT_PROTOCOL_VERSION) {
		return {
			ok: false,
			response: jsonErrorResponse(400, id, UNSUPPORTED_PROTOCOL_VERSION_CODE, "Unsupported protocol version", {
				supported: [...MCP_DRAFT_PROTOCOL_VERSIONS],
				requested: versionHeader,
			}),
		};
	}
	const bodyVersion = readBodyProtocolVersion(parsed);
	if (bodyVersion !== versionHeader) {
		return {
			ok: false,
			response: jsonErrorResponse(
				400,
				id,
				HEADER_MISMATCH_CODE,
				`Header mismatch: MCP-Protocol-Version header value '${versionHeader}' does not match body value '${String(bodyVersion)}'`,
			),
		};
	}

	if (typeof parsed.method === "string") {
		const methodValidation = validateMethodHeaders(server, parsed, request.headers);
		if (!methodValidation.ok) return methodValidation;
	}
	return { ok: true, body: parsed };
}

function validateMethodHeaders(
	server: McpServer,
	body: KotaJsonObject,
	headers: StreamableHttpRequest["headers"],
): HeaderValidationResult {
	const id = readJsonRpcId(body);
	const methodHeader = readHeader(headers, "mcp-method");
	if (!methodHeader) {
		return {
			ok: false,
			response: jsonErrorResponse(400, id, HEADER_MISMATCH_CODE, "Header mismatch: missing Mcp-Method header"),
		};
	}
	if (!isSafeHeaderValue(methodHeader)) {
		return {
			ok: false,
			response: jsonErrorResponse(400, id, HEADER_MISMATCH_CODE, "Header mismatch: malformed Mcp-Method header"),
		};
	}
	if (methodHeader !== body.method) {
		return {
			ok: false,
			response: jsonErrorResponse(
				400,
				id,
				HEADER_MISMATCH_CODE,
				`Header mismatch: Mcp-Method header value '${methodHeader}' does not match body value '${String(body.method)}'`,
			),
		};
	}

	const expectedName = expectedMcpName(body);
	if (expectedName !== null) {
		const nameHeader = readHeader(headers, "mcp-name");
		if (!nameHeader) {
			return {
				ok: false,
				response: jsonErrorResponse(400, id, HEADER_MISMATCH_CODE, "Header mismatch: missing Mcp-Name header"),
			};
		}
		if (!isSafeHeaderValue(nameHeader)) {
			return {
				ok: false,
				response: jsonErrorResponse(400, id, HEADER_MISMATCH_CODE, "Header mismatch: malformed Mcp-Name header"),
			};
		}
		if (nameHeader !== expectedName) {
			return {
				ok: false,
				response: jsonErrorResponse(
					400,
					id,
					HEADER_MISMATCH_CODE,
					`Header mismatch: Mcp-Name header value '${nameHeader}' does not match body value '${expectedName}'`,
				),
			};
		}
	}

	const paramValidation = validateRecognizedParamHeaders(server, body, headers);
	if (!paramValidation.ok) return paramValidation;
	return { ok: true, body };
}

function validateRecognizedParamHeaders(
	server: McpServer,
	body: KotaJsonObject,
	headers: StreamableHttpRequest["headers"],
): HeaderValidationResult {
	if (body.method !== "tools/call") return { ok: true, body };
	const params = isJsonObject(body.params) ? body.params : {};
	if (typeof params.name !== "string") return { ok: true, body };
	const tool = server.getExposedTools().find((candidate) => candidate.name === params.name);
	if (!tool) return { ok: true, body };
	const id = readJsonRpcId(body);
	const args = isJsonObject(params.arguments) ? params.arguments : {};
	for (const spec of recognizedParamHeaders(tool)) {
		const rawHeader = readHeader(headers, `mcp-param-${spec.headerName}`);
		const bodyValue = args[spec.paramName];
		if (bodyValue === undefined || bodyValue === null) {
			if (rawHeader !== undefined) {
				return {
					ok: false,
					response: jsonErrorResponse(
						400,
						id,
						HEADER_MISMATCH_CODE,
						`Header mismatch: Mcp-Param-${spec.headerName} header has no matching body parameter`,
					),
				};
			}
			continue;
		}
		const expected = primitiveParamHeaderValue(bodyValue);
		if (expected === null) continue;
		if (rawHeader === undefined) {
			return {
				ok: false,
				response: jsonErrorResponse(
					400,
					id,
					HEADER_MISMATCH_CODE,
					`Header mismatch: missing Mcp-Param-${spec.headerName} header`,
				),
			};
		}
		const decoded = decodeParamHeaderValue(rawHeader);
		if (decoded === null) {
			return {
				ok: false,
				response: jsonErrorResponse(
					400,
					id,
					HEADER_MISMATCH_CODE,
					`Header mismatch: malformed Mcp-Param-${spec.headerName} header`,
				),
			};
		}
		if (decoded !== expected) {
			return {
				ok: false,
				response: jsonErrorResponse(
					400,
					id,
					HEADER_MISMATCH_CODE,
					`Header mismatch: Mcp-Param-${spec.headerName} header value '${rawHeader}' does not match body value '${expected}'`,
				),
			};
		}
	}
	return { ok: true, body };
}

function recognizedParamHeaders(tool: KotaTool): RecognizedParamHeader[] {
	const out: RecognizedParamHeader[] = [];
	for (const [paramName, rawSchema] of Object.entries(tool.input_schema.properties)) {
		const headerName = decodeRecognizedParamHeaderName(rawSchema);
		if (headerName === null) continue;
		out.push({ headerName, paramName });
	}
	return out;
}

function decodeRecognizedParamHeaderName(value: ToolInputSchemaProperty): string | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const headerName = "x-mcp-header" in value ? value["x-mcp-header"] : undefined;
	const paramType = "type" in value ? value.type : undefined;
	if (typeof headerName !== "string") return null;
	if (!isValidMcpHeaderNamePart(headerName)) return null;
	if (paramType !== "string" && paramType !== "number" && paramType !== "boolean") return null;
	return headerName;
}

function readBodyProtocolVersion(body: KotaJsonObject): string | undefined {
	const params = isJsonObject(body.params) ? body.params : {};
	const meta = isJsonObject(params._meta) ? params._meta : {};
	const version = meta[MCP_META_PROTOCOL_VERSION_KEY];
	return typeof version === "string" ? version : undefined;
}

function expectedMcpName(body: KotaJsonObject): string | null {
	const params = isJsonObject(body.params) ? body.params : {};
	if (body.method === "tools/call" || body.method === "prompts/get") {
		return typeof params.name === "string" ? params.name : "";
	}
	if (body.method === "resources/read") {
		return typeof params.uri === "string" ? params.uri : "";
	}
	return null;
}

function hasHttpProgressToken(body: KotaJsonObject): boolean {
	const params = isJsonObject(body.params) ? body.params : {};
	const meta = isJsonObject(params._meta) ? params._meta : {};
	return meta.progressToken !== undefined;
}

function hasHttpLogLevel(body: KotaJsonObject): boolean {
	const params = isJsonObject(body.params) ? body.params : {};
	const meta = isJsonObject(params._meta) ? params._meta : {};
	return meta[MCP_META_LOG_LEVEL_KEY] !== undefined;
}

function hasHttpRequestScopedStream(body: KotaJsonObject): boolean {
	return hasHttpProgressToken(body) || hasHttpLogLevel(body);
}

function requiresHttpResponseStream(body: KotaJsonObject): boolean {
	return body.method === "subscriptions/listen" || hasHttpRequestScopedStream(body);
}

function readHeader(
	headers: StreamableHttpRequest["headers"],
	name: string,
): string | undefined {
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== wanted) continue;
		if (typeof value === "string") return value === "" ? undefined : value;
		if (Array.isArray(value) && value.length === 1 && value[0]) return value[0];
		return undefined;
	}
	return undefined;
}

function accepts(header: string | undefined, mediaType: string): boolean {
	if (!header) return false;
	return header
		.split(",")
		.map((part) => part.split(";")[0]?.trim().toLowerCase())
		.includes(mediaType);
}

function isOriginAllowed(origin: string | undefined, allowedOrigins?: string[]): boolean {
	if (!origin) return true;
	if (allowedOrigins) return allowedOrigins.includes(origin);
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
			isLocalHostname(parsed.hostname);
	} catch {
		return false;
	}
}

function isLocalHostname(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function assertLocalBindHost(
	host: string,
	authorization?: StreamableHttpAuthorizationOptions,
): void {
	if (isLocalHostname(host)) return;
	if (authorization) return;
	throw new Error(
		"Non-local MCP HTTP binding is not available without an authentication story; bind to 127.0.0.1 or localhost.",
	);
}

function isSafeHeaderValue(value: string): boolean {
	return /^[\x21-\x7e]+$/.test(value);
}

function isValidMcpHeaderNamePart(value: string): boolean {
	return value.length > 0 && /^[\x21-\x39\x3b-\x7e]+$/.test(value);
}

function primitiveParamHeaderValue(value: KotaJsonValue): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	return null;
}

function decodeParamHeaderValue(value: string): string | null {
	if (value.startsWith("=?base64?") && value.endsWith("?=")) {
		const encoded = value.slice("=?base64?".length, -"?=".length);
		try {
			return Buffer.from(encoded, "base64").toString("utf-8");
		} catch {
			return null;
		}
	}
	if (!/^[\x20-\x7e\t]+$/.test(value)) return null;
	if (value.trim() !== value) return null;
	return value;
}

function isJsonObject(value: KotaJsonValue | JsonRpcOutboundPayload | undefined): value is KotaJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonRpcId(body: KotaJsonObject): JsonRpcErrorId {
	return typeof body.id === "string" || typeof body.id === "number" ? body.id : null;
}

function normalizeHttpResponse(
	request: KotaJsonObject,
	payload: JsonRpcOutboundPayload,
): JsonRpcOutboundPayload {
	if (!isJsonObject(payload)) return payload;
	if (!isJsonObject(payload.result)) return payload;
	const result: KotaJsonObject = { ...payload.result };
	if (request.method === "server/discover") {
		result.supportedVersions = [...MCP_DRAFT_PROTOCOL_VERSIONS];
	}
	return {
		...payload,
		result,
	};
}

function responseStatusForPayload(payload: JsonRpcOutboundPayload): number {
	if (!isJsonObject(payload)) return 200;
	if (!isJsonObject(payload.error)) return 200;
	if (payload.error.code === -32601) return 404;
	return 200;
}

function isJsonRpcErrorPayload(payload: JsonRpcOutboundPayload): boolean {
	return isJsonObject(payload) && isJsonObject(payload.error);
}

function dispatchMessages(
	dispatch: Awaited<ReturnType<McpServer["handleJsonRpcMessage"]>>,
): JsonRpcOutboundPayload[] {
	if (dispatch.kind === "accepted" || dispatch.kind === "invalid") return [];
	if (dispatch.kind === "response") return [dispatch.response];
	return dispatch.messages;
}

function jsonErrorResponse(
	status: number,
	id: JsonRpcErrorId,
	code: number,
	message: string,
	data?: KotaJsonObject,
): StreamableHttpResponse {
	const body: KotaJsonObject = {
		jsonrpc: "2.0",
		...(id !== undefined ? { id } : {}),
		error: {
			code,
			message,
			...(data !== undefined ? { data } : {}),
		},
	};
	return jsonResponse(status, body);
}

function jsonResponse(status: number, payload: JsonRpcOutboundPayload): StreamableHttpResponse {
	return {
		status,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	};
}

function serverCardResponse(payload: KotaJsonObject): StreamableHttpResponse {
	return {
		status: 200,
		headers: {
			"content-type": "application/json",
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET",
			"access-control-allow-headers": "content-type",
			"cache-control": "public, max-age=3600",
		},
		body: JSON.stringify(payload),
	};
}

function sseResponse(
	status: number,
	messages: JsonRpcOutboundPayload[],
	stream?: Pick<StreamableHttpSseStream, "subscribe">,
): StreamableHttpResponse {
	const body = encodeSseMessages(messages);
	return {
		status,
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
		},
		body,
		...(stream ? { stream: { initialMessages: messages, subscribe: stream.subscribe } } : {}),
	};
}

function requestScopedSseResponse(
	server: McpServer,
	request: KotaJsonObject,
): StreamableHttpResponse {
	const requestId = readJsonRpcId(request);
	if (requestId === null || requestId === undefined) {
		return jsonErrorResponse(400, null, -32600, "Invalid JSON-RPC message");
	}
	return sseResponse(200, [], {
		subscribe: (send, close) => {
			let closed = false;
			let completed = false;
			const sendIfOpen = (message: JsonRpcOutboundPayload) => {
				if (closed) return;
				send(normalizeHttpResponse(request, message));
			};
			void server.handleJsonRpcMessage(request, sendIfOpen)
				.then((dispatch) => {
					if (dispatch.kind !== "invalid") return;
					sendIfOpen({
						jsonrpc: "2.0",
						id: requestId,
						error: { code: -32600, message: "Invalid JSON-RPC message" },
					});
				})
				.catch((err) => {
					const message = err instanceof Error ? err.message : String(err);
					sendIfOpen({
						jsonrpc: "2.0",
						id: requestId,
						error: { code: -32603, message: `Internal error: ${message}` },
					});
				})
				.finally(() => {
					completed = true;
					if (closed) return;
					closed = true;
					close?.();
				});
			return () => {
				if (closed) return;
				closed = true;
				if (!completed) {
					void server.handleJsonRpcMessage({
						jsonrpc: "2.0",
						method: "notifications/cancelled",
						params: { requestId },
					});
				}
			};
		},
	});
}

function encodeSseMessage(message: JsonRpcOutboundPayload): string {
	return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

function encodeSseMessages(messages: JsonRpcOutboundPayload[]): string {
	return messages.map(encodeSseMessage).join("");
}

function formatAddressHost(address: AddressInfo): string {
	if (address.family === "IPv6") return `[${address.address}]`;
	return address.address;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
	}
	return Buffer.concat(chunks).toString("utf-8");
}

function writeResponse(res: ServerResponse, response: StreamableHttpResponse): void {
	res.writeHead(response.status, response.headers);
	if (response.stream) {
		for (const message of response.stream.initialMessages) {
			res.write(encodeSseMessage(message));
		}
		let unsubscribe = () => {};
		let closed = false;
		const cleanup = () => {
			if (closed) return;
			closed = true;
			unsubscribe();
		};
		const close = () => {
			if (!res.destroyed && !res.writableEnded) {
				res.end();
			}
			cleanup();
		};
		unsubscribe = response.stream.subscribe((message) => {
			if (!res.destroyed && !res.writableEnded) {
				res.write(encodeSseMessage(message));
			}
		}, close);
		res.on("close", cleanup);
		res.on("error", cleanup);
		return;
	}
	res.end(response.body ?? "");
}

function listen(server: Server, port: number, host: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (err: Error) => {
			server.off("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}
