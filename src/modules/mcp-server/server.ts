/**
 * MCP Server — expose KOTA tools via the Model Context Protocol.
 *
 * JSON-RPC 2.0 over stdio. The orchestrator owns lifecycle, transport, and
 * method-name dispatch only. Each MCP feature area lives in its own
 * `mcp-handlers-<feature>.ts` sibling and is the single place to edit when a
 * new method or capability lands in that area.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createInterface, type Interface } from "node:readline";
import type { KotaJsonObject, KotaJsonValue, KotaTool } from "#core/agent-harness/message-protocol.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { ModelClient } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type { ToolDef } from "#core/modules/module-types.js";
import {
	DeprecatedMcpCapabilityWarnings,
	hasDeprecatedClientCapability,
} from "./deprecated-capabilities.js";
import { CompletionHandler } from "./mcp-handlers-completion.js";
import { ElicitationHandler } from "./mcp-handlers-elicitation.js";
import { InitializeHandler } from "./mcp-handlers-initialize.js";
import { PromptsHandler } from "./mcp-handlers-prompts.js";
import { ResourcesHandler } from "./mcp-handlers-resources.js";
import { SamplingHandler } from "./mcp-handlers-sampling.js";
import { TasksHandler } from "./mcp-handlers-tasks.js";
import { ToolsHandler } from "./mcp-handlers-tools.js";
import { McpMrtrStateCodec } from "./mcp-mrtr.js";
import type {
	HandlerContext,
	JsonRpcNotification,
	JsonRpcOutboundPayload,
	JsonRpcRequest,
	JsonRpcResponse,
	McpLogLevel,
	McpLogOptions,
	McpProgressToken,
	McpRequestContext,
	McpRoot,
	McpTransport,
	SessionState,
} from "./mcp-protocol-types.js";
import {
	hasLegacySessionContext,
	isMcpProgressToken,
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_DRAFT_PROTOCOL_VERSIONS,
	MCP_LEGACY_PROTOCOL_VERSION,
	MCP_LOG_LEVELS,
	MCP_META_CLIENT_CAPABILITIES_KEY,
	MCP_META_CLIENT_INFO_KEY,
	MCP_META_LOG_LEVEL_KEY,
	MCP_META_PROTOCOL_VERSION_KEY,
	mcpProgressTokenKey,
} from "./mcp-protocol-types.js";
import { McpTaskStore } from "./mcp-task-store.js";

export { kotaToolToMcp, toolResultToMcp } from "./mcp-handlers-tools.js";
export type { ElicitationResponse, ElicitationSchema, McpRoot, McpToolResult } from "./mcp-protocol-types.js";

export type McpServerOptions = {
	toolFilter?: string[];
	name?: string;
	version?: string;
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
	log?: (msg: string) => void;
	projectDir?: string;
	eventBus?: EventBus | null;
	moduleTools?: ToolDef[];
	modelClient?: ModelClient;
	samplingModel?: string;
	samplingEnabled?: boolean;
	taskStore?: McpTaskStore;
};

type RequestHandler = (msg: JsonRpcRequest) => Promise<void> | void;

export type McpServerDispatchResult =
	| { kind: "invalid" }
	| { kind: "accepted" }
	| { kind: "response"; response: JsonRpcOutboundPayload }
	| { kind: "stream"; messages: JsonRpcOutboundPayload[] };

type DraftRequestContextResult =
	| { ok: true; context: McpRequestContext }
	| { ok: false; code: number; message: string; data?: JsonRpcOutboundPayload };

type ActiveProgressRequest = {
	requestId: JsonRpcRequest["id"];
	token: McpProgressToken;
	tokenKey: string;
	lastProgress: number | null;
};

function protocolErrorData(requestedVersion?: string): KotaJsonObject {
	return {
		supportedVersions: [...MCP_DRAFT_PROTOCOL_VERSIONS],
		...(requestedVersion !== undefined && { requestedVersion }),
	};
}

function isJsonObject(value: KotaJsonValue | undefined): value is KotaJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: KotaJsonValue | undefined): value is JsonRpcRequest["id"] {
	return typeof value === "string" || typeof value === "number";
}

function isMcpLogLevel(value: string): value is McpLogLevel {
	return (MCP_LOG_LEVELS as readonly string[]).includes(value);
}

function logLevelRank(level: McpLogLevel): number {
	return MCP_LOG_LEVELS.indexOf(level);
}

function shouldEmitLogMessage(level: McpLogLevel, threshold: McpLogLevel): boolean {
	return logLevelRank(level) >= logLevelRank(threshold);
}

function isSensitiveLogKey(key: string): boolean {
	return /authorization|api[-_]?key|cookie|credential|password|secret|token/i.test(key);
}

function sanitizeLogString(value: string): string {
	return value
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
		.replace(/\b(api[-_]?key|authorization|cookie|credential|password|secret|token)\s*[:=]\s*[^,\s;]+/gi, "$1=[redacted]")
		.replace(/\/(?:Users|home|private|tmp|var|etc)\/[^\s"',)]+/g, "[redacted-path]");
}

function sanitizeLogData(value: KotaJsonValue, depth = 0): KotaJsonValue {
	if (depth > 6) return "[truncated]";
	if (value === null) return null;
	if (typeof value === "string") return sanitizeLogString(value);
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "boolean") return value;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeLogData(item, depth + 1));
	}
	const out: KotaJsonObject = {};
	for (const [key, entry] of Object.entries(value)) {
		out[key] = isSensitiveLogKey(key)
			? "[redacted]"
			: sanitizeLogData(entry, depth + 1);
	}
	return out;
}

function decodeJsonRpcError(value: KotaJsonValue | undefined): JsonRpcResponse["error"] | null {
	if (!isJsonObject(value)) return null;
	const code = value.code;
	const message = value.message;
	if (typeof code !== "number" || typeof message !== "string") return null;
	return {
		code,
		message,
		...(value.data !== undefined && { data: value.data }),
	};
}

function decodeJsonRpcResponse(parsed: KotaJsonObject): JsonRpcResponse | null {
	if (parsed.jsonrpc !== "2.0" || !isJsonRpcId(parsed.id) || "method" in parsed) {
		return null;
	}
	let error: JsonRpcResponse["error"] | undefined;
	if (parsed.error !== undefined) {
		const decodedError = decodeJsonRpcError(parsed.error);
		if (!decodedError) return null;
		error = decodedError;
	}
	return {
		jsonrpc: "2.0",
		id: parsed.id,
		...(parsed.result !== undefined && { result: parsed.result }),
		...(error !== undefined && { error }),
	};
}

function decodeJsonRpcRequest(parsed: KotaJsonObject): JsonRpcRequest | null {
	if (
		parsed.jsonrpc !== "2.0" ||
		!isJsonRpcId(parsed.id) ||
		typeof parsed.method !== "string"
	) {
		return null;
	}
	if (parsed.params !== undefined && !isJsonObject(parsed.params)) return null;
	return {
		jsonrpc: "2.0",
		id: parsed.id,
		method: parsed.method,
		...(parsed.params !== undefined && { params: parsed.params }),
	};
}

function decodeJsonRpcNotification(parsed: KotaJsonObject): JsonRpcNotification | null {
	if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") return null;
	if ("id" in parsed && parsed.id !== undefined) return null;
	if (parsed.params !== undefined && !isJsonObject(parsed.params)) return null;
	return {
		jsonrpc: "2.0",
		method: parsed.method,
		...(parsed.params !== undefined && { params: parsed.params }),
	};
}

function decodeDraftRequestContext(msg: JsonRpcRequest): DraftRequestContextResult {
	const meta = msg.params?._meta;
	if (!isJsonObject(meta)) {
		return {
			ok: false,
			code: -32602,
			message: `Missing required MCP draft _meta or malformed _meta object. Supported protocol versions: ${MCP_DRAFT_PROTOCOL_VERSIONS.join(", ")}`,
			data: protocolErrorData(),
		};
	}

	const protocolVersion = meta[MCP_META_PROTOCOL_VERSION_KEY];
	if (typeof protocolVersion !== "string") {
		return {
			ok: false,
			code: -32602,
			message: `Missing required MCP draft _meta field: ${MCP_META_PROTOCOL_VERSION_KEY}`,
			data: protocolErrorData(),
		};
	}
	if (protocolVersion !== MCP_DRAFT_PROTOCOL_VERSION) {
		return {
			ok: false,
			code: -32602,
			message: `Unsupported protocol version: ${protocolVersion}. Supported protocol versions: ${MCP_DRAFT_PROTOCOL_VERSIONS.join(", ")}`,
			data: protocolErrorData(protocolVersion),
		};
	}

	const clientInfo = meta[MCP_META_CLIENT_INFO_KEY];
	if (!isJsonObject(clientInfo)) {
		return {
			ok: false,
			code: -32602,
			message: `Malformed MCP draft _meta field: ${MCP_META_CLIENT_INFO_KEY}`,
		};
	}
	const clientName = clientInfo.name;
	const clientVersion = clientInfo.version;
	if (typeof clientName !== "string" || typeof clientVersion !== "string") {
		return {
			ok: false,
			code: -32602,
			message: `Malformed MCP draft _meta field: ${MCP_META_CLIENT_INFO_KEY}`,
		};
	}

	const clientCapabilities = meta[MCP_META_CLIENT_CAPABILITIES_KEY];
	if (!isJsonObject(clientCapabilities)) {
		return {
			ok: false,
			code: -32602,
			message: `Malformed MCP draft _meta field: ${MCP_META_CLIENT_CAPABILITIES_KEY}`,
		};
	}

	for (const key of ["elicitation", "experimental", "roots", "sampling", "tasks"]) {
		const value = clientCapabilities[key];
		if (value !== undefined && !isJsonObject(value)) {
			return {
				ok: false,
				code: -32602,
				message: `Malformed MCP draft client capability: ${key}`,
			};
		}
	}

	const progressToken = meta.progressToken;
	if (progressToken !== undefined && !isMcpProgressToken(progressToken)) {
		return {
			ok: false,
			code: -32602,
			message: "Malformed MCP draft _meta field: progressToken",
		};
	}

	const logLevel = meta[MCP_META_LOG_LEVEL_KEY];
	if (logLevel !== undefined && (typeof logLevel !== "string" || !isMcpLogLevel(logLevel))) {
		return {
			ok: false,
			code: -32602,
			message: `Malformed MCP draft _meta field: ${MCP_META_LOG_LEVEL_KEY}`,
		};
	}

	return {
		ok: true,
		context: {
			protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
			clientInfo: { name: clientName, version: clientVersion },
			clientCapabilities,
			requestId: msg.id,
			...(logLevel !== undefined ? { logLevel } : {}),
			...(progressToken !== undefined ? { progressToken } : {}),
		},
	};
}

export class McpServer {
	private rl: Interface | null = null;
	private running = false;
	private readonly input: NodeJS.ReadableStream;
	private readonly output: NodeJS.WritableStream;
	private readonly log: (msg: string) => void;
	private readonly outboundSink = new AsyncLocalStorage<(msg: JsonRpcOutboundPayload) => void>();
	private readonly deprecatedWarnings: DeprecatedMcpCapabilityWarnings;
	private readonly session: SessionState = {
		initialized: false,
		protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
		clientElicitation: { form: false, url: false },
		clientSupportsRoots: false,
	};
	private readonly requestContext = new AsyncLocalStorage<McpRequestContext>();
	private readonly activeProgressByRequestId = new Map<string, ActiveProgressRequest>();
	private readonly activeProgressByToken = new Map<string, JsonRpcRequest["id"]>();
	private readonly initialize: InitializeHandler;
	private readonly resources: ResourcesHandler;
	private readonly elicitation: ElicitationHandler;
	private readonly tools: ToolsHandler;
	private readonly requestHandlers: Map<string, RequestHandler>;

	constructor(options: McpServerOptions = {}) {
		this.input = options.input ?? process.stdin;
		this.output = options.output ?? process.stdout;
		this.log = options.log ?? ((msg) => process.stderr.write(`[mcp-server] ${msg}\n`));
		this.deprecatedWarnings = new DeprecatedMcpCapabilityWarnings((message) =>
			this.log(message),
		);
		const projectDir = options.projectDir ?? process.cwd();

		const send = (m: JsonRpcOutboundPayload) => this.sendPayload(m);
		const transport: McpTransport = {
			send,
			sendResult: (m, result) => send({ jsonrpc: "2.0", id: m.id, result }),
			sendError: (m, code, message, data) => send({
				jsonrpc: "2.0",
				id: m.id,
				error: {
					code,
					message,
					...(data !== undefined && { data }),
				},
			}),
			sendNotification: (method, params) => send({ jsonrpc: "2.0", method, params }),
		};
		const ctx: HandlerContext = {
			transport,
			log: (message, options) => this.logFromHandler(message, options),
			session: this.session,
			getRequestContext: () => this.requestContext.getStore() ?? null,
			sendProgress: (progress, details) => this.sendProgress(progress, details),
		};
		const mrtr = new McpMrtrStateCodec();

		this.elicitation = new ElicitationHandler(ctx);
		const sampling = new SamplingHandler(ctx, {
			enabled: options.samplingEnabled ?? false,
			modelClient: options.modelClient ?? null,
			samplingModel:
				options.samplingModel ??
				resolveActivePresetFromConfig(undefined).defaultModel,
			projectDir,
		});
		this.initialize = new InitializeHandler(ctx, {
			serverName: options.name ?? "kota",
			serverVersion: options.version ?? "0.1.0",
			projectDir,
			advertiseSampling: () => sampling.isAvailable(),
			warnDeprecatedCapability: (warning) => this.deprecatedWarnings.warn(warning),
		});
		this.resources = new ResourcesHandler(
			ctx,
			options.eventBus,
			() => this.initialize.getEffectiveProjectDir(),
			mrtr,
		);
		const prompts = new PromptsHandler(
			ctx,
			() => this.initialize.getEffectiveProjectDir(),
			mrtr,
		);
		const taskStore = options.taskStore ?? new McpTaskStore();
		this.tools = new ToolsHandler(ctx, this.elicitation, mrtr, taskStore, {
			...(options.toolFilter !== undefined && { toolFilter: options.toolFilter }),
			...(options.moduleTools !== undefined && { moduleTools: options.moduleTools }),
		});
		const completion = new CompletionHandler(
			ctx,
			() => this.initialize.getEffectiveProjectDir(),
		);
		const tasks = new TasksHandler(ctx, taskStore, {
			resumeInput: (args) => this.tools.prepareTaskInputResponse(args),
			forgetTaskContinuation: (taskId) => this.tools.forgetTaskContinuation(taskId),
		});

		const ack: RequestHandler = (m) => { send({ jsonrpc: "2.0", id: m.id, result: {} }); };
		this.requestHandlers = new Map<string, RequestHandler>([
			["initialize", (m) => this.initialize.handleInitialize(m)],
			["server/discover", (m) => this.initialize.handleDiscover(m)],
			["tools/list", (m) => this.tools.handleList(m)],
			["tools/call", (m) => this.tools.handleCall(m)],
			["resources/list", (m) => this.resources.handleList(m)],
			["resources/templates/list", (m) => this.resources.handleTemplatesList(m)],
			["resources/read", (m) => this.resources.handleRead(m)],
			["resources/subscribe", (m) => this.resources.handleSubscribe(m)],
			["resources/unsubscribe", (m) => this.resources.handleUnsubscribe(m)],
			["subscriptions/listen", (m) => this.resources.handleListen(m)],
			["prompts/list", (m) => prompts.handleList(m)],
			["prompts/get", (m) => prompts.handleGet(m)],
			["sampling/createMessage", (m) => sampling.handleCreateMessage(m)],
			["completion/complete", (m) => completion.handleComplete(m)],
			["tasks/get", (m) => tasks.handleGet(m)],
			["tasks/result", (m) => tasks.handleResult(m)],
			["tasks/input_response", (m) => tasks.handleInputResponse(m)],
			["tasks/list", (m) => tasks.handleList(m)],
			["tasks/cancel", (m) => tasks.handleCancel(m)],
			["ping", ack],
			["shutdown", ack],
		]);
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.rl = createInterface({ input: this.input });
		this.rl.on("line", (line) => this.handleLine(line));
		this.rl.on("close", () => {
			this.running = false;
			this.resources.cleanup();
		});
		this.resources.registerBusListeners();
		this.log("MCP server started, waiting for initialize...");
	}

	stop(): void {
		this.running = false;
		this.resources.cleanup();
		this.rl?.close();
		this.rl = null;
	}

	isRunning(): boolean {
		return this.running;
	}

	getClientRoots(): McpRoot[] {
		return this.initialize.getClientRoots();
	}

	getEffectiveProjectDir(): string {
		return this.initialize.getEffectiveProjectDir();
	}

	getExposedTools(): KotaTool[] {
		return this.tools.getExposedTools();
	}

	requestElicitation(
		message: string,
		requestedSchema: Parameters<ElicitationHandler["request"]>[1],
		timeoutMs?: number,
	) {
		return this.elicitation.request(message, requestedSchema, timeoutMs);
	}

	async handleJsonRpcMessage(parsedValue: KotaJsonValue): Promise<McpServerDispatchResult> {
		if (!isJsonObject(parsedValue) || parsedValue.jsonrpc !== "2.0") return { kind: "invalid" };

		if (!("method" in parsedValue)) {
			const response = decodeJsonRpcResponse(parsedValue);
			if (!response) return { kind: "invalid" };
			if (!this.initialize.tryConsumeResponse(response)) this.elicitation.tryConsumeResponse(response);
			return { kind: "accepted" };
		}

		if (!("id" in parsedValue) || parsedValue.id === undefined) {
			const notification = decodeJsonRpcNotification(parsedValue);
			if (!notification) return { kind: "invalid" };
			this.handleNotification(notification);
			return { kind: "accepted" };
		}

		const request = decodeJsonRpcRequest(parsedValue);
		if (!request) return { kind: "invalid" };
		const messages: JsonRpcOutboundPayload[] = [];
		await this.outboundSink.run((msg) => messages.push(msg), async () => {
			try {
				await this.dispatchRequest(request);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.sendPayload({
					jsonrpc: "2.0",
					id: request.id,
					error: { code: -32603, message: `Internal error: ${message}` },
				});
			}
		});
		if (messages.length === 0) return { kind: "accepted" };
		if (messages.length === 1) return { kind: "response", response: messages[0]! };
		return { kind: "stream", messages };
	}

	private sendPayload(msg: JsonRpcOutboundPayload): void {
		const sink = this.outboundSink.getStore();
		if (sink) {
			sink(msg);
			return;
		}
		this.output.write(`${JSON.stringify(msg)}\n`);
	}

	private logFromHandler(message: string, options: McpLogOptions = {}): void {
		this.log(message);
		const context = this.requestContext.getStore();
		if (!context?.logLevel) return;
		const level = options.level ?? "info";
		if (!shouldEmitLogMessage(level, context.logLevel)) return;
		const params: KotaJsonObject = {
			level,
			data: sanitizeLogData(options.data ?? { message }),
		};
		if (options.logger) {
			const logger = sanitizeLogString(options.logger);
			if (logger.length > 0) params.logger = logger;
		}
		this.sendPayload({
			jsonrpc: "2.0",
			method: "notifications/message",
			params,
		});
	}

	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		let parsedValue: KotaJsonValue;
		try { parsedValue = JSON.parse(trimmed) as KotaJsonValue; } catch { return; }
		if (!isJsonObject(parsedValue) || parsedValue.jsonrpc !== "2.0") return;

		if (!("method" in parsedValue)) {
			const response = decodeJsonRpcResponse(parsedValue);
			if (!response) return;
			if (!this.initialize.tryConsumeResponse(response)) this.elicitation.tryConsumeResponse(response);
			return;
		}

		if (!("id" in parsedValue) || parsedValue.id === undefined) {
			const notification = decodeJsonRpcNotification(parsedValue);
			if (!notification) return;
			this.handleNotification(notification);
			return;
		}

		const request = decodeJsonRpcRequest(parsedValue);
		if (!request) return;
		Promise.resolve(this.dispatchRequest(request)).catch((err) => {
			const message = err instanceof Error ? err.message : String(err);
			this.sendPayload({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: `Internal error: ${message}` } });
		});
	}

	private handleNotification(msg: JsonRpcNotification): void {
		if (msg.method === "notifications/initialized") this.log("Client confirmed initialization");
		else if (msg.method === "notifications/roots/list_changed") this.initialize.handleRootsListChangedNotification();
		else if (msg.method === "notifications/cancelled") {
			this.clearProgressFromCancelledNotification(msg);
			this.resources.handleCancelledNotification(msg);
		}
		// Silently ignore unknown notifications per spec
	}

	private async dispatchRequest(msg: JsonRpcRequest): Promise<void> {
		const handler = this.requestHandlers.get(msg.method);
		if (!handler) {
			this.sendPayload({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
			return;
		}
		const hasMetaField =
			msg.params !== undefined &&
			Object.hasOwn(msg.params, "_meta");
		if (msg.method === "initialize") {
			if (hasMetaField) {
				await this.dispatchDraftRequest(msg, handler);
				return;
			}
			await handler(msg);
			return;
		}

		const requiresDraftContext =
			msg.method === "server/discover" || hasMetaField || !hasLegacySessionContext(this.session);
		if (!requiresDraftContext && this.session.initialized) {
			await handler(msg);
			return;
		}

		await this.dispatchDraftRequest(msg, handler);
	}

	private async dispatchDraftRequest(msg: JsonRpcRequest, handler: RequestHandler): Promise<void> {
		const decoded = decodeDraftRequestContext(msg);
		if (!decoded.ok) {
			this.sendPayload({
				jsonrpc: "2.0",
				id: msg.id,
				error: {
					code: decoded.code,
					message: decoded.message,
					...(decoded.data !== undefined && { data: decoded.data }),
				},
			});
			return;
		}

		if (!this.activateProgress(decoded.context)) {
			this.sendPayload({
				jsonrpc: "2.0",
				id: msg.id,
				error: {
					code: -32602,
					message: "Duplicate active MCP progressToken",
				},
			});
			return;
		}
		try {
			this.warnDeprecatedDraftRequestContext(decoded.context);
			await this.requestContext.run(decoded.context, () => Promise.resolve(handler(msg)));
		} finally {
			this.clearProgressForRequest(msg.id);
		}
	}

	private warnDeprecatedDraftRequestContext(context: McpRequestContext): void {
		for (const feature of ["roots", "sampling"] as const) {
			if (!hasDeprecatedClientCapability(context.clientCapabilities, feature)) continue;
			this.deprecatedWarnings.warn({
				feature,
				peer: context.clientInfo,
				protocolVersion: context.protocolVersion,
				source: `client ${feature} capability`,
			});
		}
		if (context.logLevel !== undefined) {
			this.deprecatedWarnings.warn({
				feature: "logging",
				peer: context.clientInfo,
				protocolVersion: context.protocolVersion,
				source: `${MCP_META_LOG_LEVEL_KEY} request metadata`,
			});
		}
	}

	private activateProgress(context: McpRequestContext): boolean {
		if (context.progressToken === undefined) return true;
		const tokenKey = mcpProgressTokenKey(context.progressToken);
		if (this.activeProgressByToken.has(tokenKey)) return false;
		const requestKey = String(context.requestId);
		this.activeProgressByRequestId.set(requestKey, {
			requestId: context.requestId,
			token: context.progressToken,
			tokenKey,
			lastProgress: null,
		});
		this.activeProgressByToken.set(tokenKey, context.requestId);
		return true;
	}

	private sendProgress(
		progress: number,
		details: { total?: number; message?: string } = {},
	): void {
		const context = this.requestContext.getStore();
		if (!context || context.progressToken === undefined) return;
		const active = this.activeProgressByRequestId.get(String(context.requestId));
		if (!active || active.tokenKey !== mcpProgressTokenKey(context.progressToken)) return;
		if (!Number.isFinite(progress)) {
			this.log(`Ignored invalid MCP progress value for request ${String(context.requestId)}`);
			return;
		}
		if (active.lastProgress !== null && progress <= active.lastProgress) {
			this.log(`Ignored non-monotonic MCP progress value for request ${String(context.requestId)}`);
			return;
		}
		if (details.total !== undefined && !Number.isFinite(details.total)) {
			this.log(`Ignored invalid MCP progress total for request ${String(context.requestId)}`);
			return;
		}
		active.lastProgress = progress;
		this.ctxSendProgress(active.token, progress, details);
	}

	private ctxSendProgress(
		progressToken: McpProgressToken,
		progress: number,
		details: { total?: number; message?: string },
	): void {
		this.sendPayload({
			jsonrpc: "2.0",
			method: "notifications/progress",
			params: {
				progressToken,
				progress,
				...(details.total !== undefined ? { total: details.total } : {}),
				...(details.message !== undefined ? { message: details.message } : {}),
			},
		});
	}

	private clearProgressFromCancelledNotification(msg: JsonRpcNotification): void {
		const requestId = msg.params?.requestId;
		if (typeof requestId !== "string" && typeof requestId !== "number") return;
		this.clearProgressForRequest(requestId);
	}

	private clearProgressForRequest(requestId: JsonRpcRequest["id"]): void {
		const active = this.activeProgressByRequestId.get(String(requestId));
		if (!active) return;
		this.activeProgressByRequestId.delete(String(requestId));
		this.activeProgressByToken.delete(active.tokenKey);
	}
}
