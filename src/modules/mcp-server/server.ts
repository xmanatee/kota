/**
 * MCP Server — expose KOTA tools via the Model Context Protocol.
 *
 * JSON-RPC 2.0 over stdio. The orchestrator owns lifecycle, transport, and
 * method-name dispatch only. Each MCP feature area lives in its own
 * `mcp-handlers-<feature>.ts` sibling and is the single place to edit when a
 * new method or capability lands in that area.
 */

import { createInterface, type Interface } from "node:readline";
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
import type {
	HandlerContext,
	JsonRpcMessage,
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
	McpRoot,
	McpTransport,
	SessionState,
} from "./mcp-protocol-types.js";
import { MCP_LEGACY_PROTOCOL_VERSION } from "./mcp-protocol-types.js";

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
	private readonly initialize: InitializeHandler;
	private readonly resources: ResourcesHandler;
	private readonly elicitation: ElicitationHandler;
	private readonly requestHandlers: Map<string, RequestHandler>;

	constructor(options: McpServerOptions = {}) {
		this.input = options.input ?? process.stdin;
		this.output = options.output ?? process.stdout;
		this.log = options.log ?? ((msg) => process.stderr.write(`[mcp-server] ${msg}\n`));
		const projectDir = options.projectDir ?? process.cwd();

		const send = (m: unknown) => this.output.write(`${JSON.stringify(m)}\n`);
		const transport: McpTransport = {
			send,
			sendResult: (m, result) => send({ jsonrpc: "2.0", id: m.id, result }),
			sendError: (m, code, message) => send({ jsonrpc: "2.0", id: m.id, error: { code, message } }),
			sendNotification: (method, params) => send({ jsonrpc: "2.0", method, params }),
		};
		const ctx: HandlerContext = { transport, log: this.log, session: this.session };

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
		this.resources = new ResourcesHandler(ctx, options.eventBus, () =>
			this.initialize.getEffectiveProjectDir(),
		);
		const prompts = new PromptsHandler(ctx);
		const tools = new ToolsHandler(ctx, this.elicitation, {
			...(options.toolFilter !== undefined && { toolFilter: options.toolFilter }),
			...(options.moduleTools !== undefined && { moduleTools: options.moduleTools }),
		});
		const completion = new CompletionHandler(ctx, projectDir);

		const ack: RequestHandler = (m) => { send({ jsonrpc: "2.0", id: m.id, result: {} }); };
		this.requestHandlers = new Map<string, RequestHandler>([
			["initialize", (m) => this.initialize.handleInitialize(m)],
			["tools/list", (m) => tools.handleList(m)],
			["tools/call", (m) => tools.handleCall(m)],
			["resources/list", (m) => this.resources.handleList(m)],
			["resources/read", (m) => this.resources.handleRead(m)],
			["resources/subscribe", (m) => this.resources.handleSubscribe(m)],
			["resources/unsubscribe", (m) => this.resources.handleUnsubscribe(m)],
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
		let parsed: Record<string, unknown>;
		try { parsed = JSON.parse(trimmed) as Record<string, unknown>; } catch { return; }
		if (parsed.jsonrpc !== "2.0") return;

		const hasMethod = "method" in parsed;
		if ("id" in parsed && parsed.id !== undefined && !hasMethod) {
			const response = parsed as unknown as JsonRpcResponse;
			if (!this.initialize.tryConsumeResponse(response)) this.elicitation.tryConsumeResponse(response);
			return;
		}

		const rpcMsg = parsed as unknown as JsonRpcMessage;
		if (!("id" in rpcMsg) || rpcMsg.id === undefined) {
			this.handleNotification(rpcMsg as JsonRpcNotification);
			return;
		}

		const request = rpcMsg as JsonRpcRequest;
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
		// Silently ignore unknown notifications per spec
	}

	private dispatchRequest(msg: JsonRpcRequest): Promise<void> | void {
		const handler = this.requestHandlers.get(msg.method);
		if (handler) return handler(msg);
		this.output.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } })}\n`,
		);
	}
}
