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
import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { ModelClient } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { CompletionHandler } from "./mcp-handlers-completion.js";
import { ElicitationHandler } from "./mcp-handlers-elicitation.js";
import { InitializeHandler } from "./mcp-handlers-initialize.js";
import { PromptsHandler } from "./mcp-handlers-prompts.js";
import { ResourcesHandler } from "./mcp-handlers-resources.js";
import { SamplingHandler } from "./mcp-handlers-sampling.js";
import { ToolsHandler } from "./mcp-handlers-tools.js";
import { McpMrtrStateCodec } from "./mcp-mrtr.js";
import type {
	HandlerContext,
	JsonRpcNotification,
	JsonRpcOutboundPayload,
	JsonRpcRequest,
	JsonRpcResponse,
	McpRequestContext,
	McpRoot,
	McpTransport,
	SessionState,
} from "./mcp-protocol-types.js";
import {
	hasLegacySessionContext,
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_DRAFT_PROTOCOL_VERSIONS,
	MCP_LEGACY_PROTOCOL_VERSION,
	MCP_META_CLIENT_CAPABILITIES_KEY,
	MCP_META_CLIENT_INFO_KEY,
	MCP_META_PROTOCOL_VERSION_KEY,
} from "./mcp-protocol-types.js";

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
};

type RequestHandler = (msg: JsonRpcRequest) => Promise<void> | void;

type DraftRequestContextResult =
	| { ok: true; context: McpRequestContext }
	| { ok: false; code: number; message: string; data?: JsonRpcOutboundPayload };

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

	return {
		ok: true,
		context: {
			protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
			clientInfo: { name: clientName, version: clientVersion },
			clientCapabilities,
		},
	};
}

export class McpServer {
	private rl: Interface | null = null;
	private running = false;
	private readonly input: NodeJS.ReadableStream;
	private readonly output: NodeJS.WritableStream;
	private readonly log: (msg: string) => void;
	private readonly session: SessionState = {
		initialized: false,
		protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
		clientSupportsElicitation: false,
		clientSupportsRoots: false,
	};
	private readonly requestContext = new AsyncLocalStorage<McpRequestContext>();
	private readonly initialize: InitializeHandler;
	private readonly resources: ResourcesHandler;
	private readonly elicitation: ElicitationHandler;
	private readonly requestHandlers: Map<string, RequestHandler>;

	constructor(options: McpServerOptions = {}) {
		this.input = options.input ?? process.stdin;
		this.output = options.output ?? process.stdout;
		this.log = options.log ?? ((msg) => process.stderr.write(`[mcp-server] ${msg}\n`));
		const projectDir = options.projectDir ?? process.cwd();

		const send = (m: JsonRpcOutboundPayload) => this.output.write(`${JSON.stringify(m)}\n`);
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
			log: this.log,
			session: this.session,
			getRequestContext: () => this.requestContext.getStore() ?? null,
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
		const tools = new ToolsHandler(ctx, this.elicitation, mrtr, {
			...(options.toolFilter !== undefined && { toolFilter: options.toolFilter }),
			...(options.moduleTools !== undefined && { moduleTools: options.moduleTools }),
		});
		const completion = new CompletionHandler(
			ctx,
			() => this.initialize.getEffectiveProjectDir(),
		);

		const ack: RequestHandler = (m) => { send({ jsonrpc: "2.0", id: m.id, result: {} }); };
		this.requestHandlers = new Map<string, RequestHandler>([
			["initialize", (m) => this.initialize.handleInitialize(m)],
			["server/discover", (m) => this.initialize.handleDiscover(m)],
			["tools/list", (m) => tools.handleList(m)],
			["tools/call", (m) => tools.handleCall(m)],
			["resources/list", (m) => this.resources.handleList(m)],
			["resources/read", (m) => this.resources.handleRead(m)],
			["resources/subscribe", (m) => this.resources.handleSubscribe(m)],
			["resources/unsubscribe", (m) => this.resources.handleUnsubscribe(m)],
			["subscriptions/listen", (m) => this.resources.handleListen(m)],
			["prompts/list", (m) => prompts.handleList(m)],
			["prompts/get", (m) => prompts.handleGet(m)],
			["sampling/createMessage", (m) => sampling.handleCreateMessage(m)],
			["completion/complete", (m) => completion.handleComplete(m)],
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

	requestElicitation(
		message: string,
		requestedSchema: Parameters<ElicitationHandler["request"]>[1],
		timeoutMs?: number,
	) {
		return this.elicitation.request(message, requestedSchema, timeoutMs);
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
			this.output.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: `Internal error: ${message}` } })}\n`,
			);
		});
	}

	private handleNotification(msg: JsonRpcNotification): void {
		if (msg.method === "notifications/initialized") this.log("Client confirmed initialization");
		else if (msg.method === "notifications/roots/list_changed") this.initialize.handleRootsListChangedNotification();
		else if (msg.method === "notifications/cancelled") this.resources.handleCancelledNotification(msg);
		// Silently ignore unknown notifications per spec
	}

	private async dispatchRequest(msg: JsonRpcRequest): Promise<void> {
		const handler = this.requestHandlers.get(msg.method);
		if (!handler) {
			this.output.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } })}\n`,
			);
			return;
		}
		if (msg.method === "initialize") {
			await handler(msg);
			return;
		}

		const hasMetaField =
			msg.params !== undefined &&
			Object.hasOwn(msg.params, "_meta");
		const requiresDraftContext =
			msg.method === "server/discover" || hasMetaField || !hasLegacySessionContext(this.session);
		if (!requiresDraftContext && this.session.initialized) {
			await handler(msg);
			return;
		}

		const decoded = decodeDraftRequestContext(msg);
		if (!decoded.ok) {
			this.output.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: msg.id,
					error: {
						code: decoded.code,
						message: decoded.message,
						...(decoded.data !== undefined && { data: decoded.data }),
					},
				})}\n`,
			);
			return;
		}

		await this.requestContext.run(decoded.context, () => Promise.resolve(handler(msg)));
	}
}
