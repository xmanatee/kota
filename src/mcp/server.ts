/**
 * MCP Server — expose KOTA tools via the Model Context Protocol.
 *
 * JSON-RPC 2.0 over stdio, mirroring the client in mcp-client.ts.
 * Any MCP-compatible host (Claude Code, Cursor, VS Code, etc.) can
 * connect and use KOTA's tools without a custom integration.
 */

import { createInterface, type Interface } from "node:readline";
import type Anthropic from "@anthropic-ai/sdk";
import type { EventBus } from "../event-bus.js";
import { getEventBus } from "../event-bus.js";
import type { ToolDef } from "../extension-types.js";
import { executeTool, getAllTools, type ToolResult } from "../tools/index.js";
import { isKnownPrompt, KOTA_PROMPTS, renderPrompt } from "./prompts.js";
import {
	KNOWN_RESOURCE_URIS,
	KOTA_RESOURCES,
	readKotaResource,
} from "./resources.js";

type JsonRpcRequest = {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: Record<string, unknown>;
};

type JsonRpcNotification = {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
};

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

type McpContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export type McpServerOptions = {
	/** Only expose tools matching these names. If empty/undefined, expose all. */
	toolFilter?: string[];
	/** Server name reported in initialize response. */
	name?: string;
	/** Server version reported in initialize response. */
	version?: string;
	/** Readable stream (default: process.stdin). */
	input?: NodeJS.ReadableStream;
	/** Writable stream (default: process.stdout). */
	output?: NodeJS.WritableStream;
	/** Logger for diagnostics (default: console.error). */
	log?: (msg: string) => void;
	/** Project root used for resource reads (default: process.cwd()). */
	projectDir?: string;
	/** Event bus to drive resource subscription notifications (default: global singleton). */
	eventBus?: EventBus | null;
	/**
	 * Extension-contributed tools to expose alongside built-in tools. These are
	 * routed through their own runners, not the global tool registry. Useful for
	 * the daemon-embedded MCP server and for tests.
	 */
	extensionTools?: ToolDef[];
};

export class McpServer {
	private rl: Interface | null = null;
	private initialized = false;
	private running = false;
	private toolFilter: Set<string> | null;
	private serverName: string;
	private serverVersion: string;
	private input: NodeJS.ReadableStream;
	private output: NodeJS.WritableStream;
	private log: (msg: string) => void;
	private projectDir: string;
	private eventBusOverride: EventBus | null | undefined;
	private subscriptions = new Set<string>();
	private busUnsubs: (() => void)[] = [];
	private extensionRunners = new Map<string, (input: Record<string, unknown>) => Promise<ToolResult>>();
	private extensionToolList: Anthropic.Tool[] = [];

	constructor(options: McpServerOptions = {}) {
		this.toolFilter = options.toolFilter?.length ? new Set(options.toolFilter) : null;
		this.serverName = options.name ?? "kota";
		this.serverVersion = options.version ?? "0.1.0";
		this.input = options.input ?? process.stdin;
		this.output = options.output ?? process.stdout;
		this.log = options.log ?? ((msg) => process.stderr.write(`[mcp-server] ${msg}\n`));
		this.projectDir = options.projectDir ?? process.cwd();
		this.eventBusOverride = options.eventBus;
		for (const def of options.extensionTools ?? []) {
			this.extensionRunners.set(def.tool.name, def.runner);
			this.extensionToolList.push(def.tool);
		}
	}

	/** Start listening for JSON-RPC messages on stdio. */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		this.rl = createInterface({ input: this.input });
		this.rl.on("line", (line) => this.handleLine(line));
		this.rl.on("close", () => {
			this.running = false;
			this.cleanupBusSubscriptions();
		});

		this.registerBusListeners();
		this.log("MCP server started, waiting for initialize...");
	}

	/** Stop the server. */
	stop(): void {
		this.running = false;
		this.cleanupBusSubscriptions();
		this.rl?.close();
		this.rl = null;
	}

	isRunning(): boolean {
		return this.running;
	}

	/** Get the tools this server exposes (respecting filter). Merges built-in and extension tools. */
	getExposedTools(): Anthropic.Tool[] {
		const builtinNames = new Set(getAllTools().map((t) => t.name));
		const all = [
			...getAllTools(),
			...this.extensionToolList.filter((t) => !builtinNames.has(t.name)),
		];
		if (!this.toolFilter) return all;
		return all.filter((t) => this.toolFilter!.has(t.name));
	}

	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;

		let msg: JsonRpcMessage;
		try {
			msg = JSON.parse(trimmed) as JsonRpcMessage;
		} catch {
			return; // Ignore non-JSON lines
		}

		if (!msg.jsonrpc || msg.jsonrpc !== "2.0") return;

		// Notification (no id) — fire and forget
		if (!("id" in msg) || msg.id === undefined) {
			this.handleNotification(msg as JsonRpcNotification);
			return;
		}

		// Request (has id) — must respond
		this.handleRequest(msg as JsonRpcRequest).catch((err) => {
			this.sendError(msg as JsonRpcRequest, -32603, `Internal error: ${err instanceof Error ? err.message : String(err)}`);
		});
	}

	private handleNotification(msg: JsonRpcNotification): void {
		if (msg.method === "notifications/initialized") {
			this.log("Client confirmed initialization");
		}
		// Silently ignore unknown notifications per spec
	}

	private async handleRequest(msg: JsonRpcRequest): Promise<void> {
		switch (msg.method) {
			case "initialize":
				return this.handleInitialize(msg);
			case "tools/list":
				return this.handleToolsList(msg);
			case "tools/call":
				return this.handleToolsCall(msg);
			case "resources/list":
				return this.handleResourcesList(msg);
			case "resources/read":
				return this.handleResourcesRead(msg);
			case "resources/subscribe":
				return this.handleResourcesSubscribe(msg);
			case "resources/unsubscribe":
				return this.handleResourcesUnsubscribe(msg);
			case "prompts/list":
				return this.handlePromptsList(msg);
			case "prompts/get":
				return this.handlePromptsGet(msg);
			case "ping":
				return this.sendResult(msg, {});
			case "shutdown":
				this.sendResult(msg, {});
				return;
			default:
				return this.sendError(msg, -32601, `Method not found: ${msg.method}`);
		}
	}

	private handleInitialize(msg: JsonRpcRequest): void {
		this.initialized = true;
		this.sendResult(msg, {
			protocolVersion: "2024-11-05",
			capabilities: {
				tools: {},
				resources: { subscribe: true },
				prompts: {},
			},
			serverInfo: {
				name: this.serverName,
				version: this.serverVersion,
			},
		});
		this.log("Initialized successfully");
	}

	private handleResourcesSubscribe(msg: JsonRpcRequest): void {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const uri = (msg.params as Record<string, unknown> | undefined)?.uri as string | undefined;
		if (!uri || typeof uri !== "string") {
			this.sendError(msg, -32602, "Missing required parameter: uri");
			return;
		}
		if (!KNOWN_RESOURCE_URIS.has(uri)) {
			this.sendError(msg, -32002, `Unknown resource: ${uri}`);
			return;
		}
		this.subscriptions.add(uri);
		this.sendResult(msg, {});
	}

	private handleResourcesUnsubscribe(msg: JsonRpcRequest): void {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const uri = (msg.params as Record<string, unknown> | undefined)?.uri as string | undefined;
		if (!uri || typeof uri !== "string") {
			this.sendError(msg, -32602, "Missing required parameter: uri");
			return;
		}
		this.subscriptions.delete(uri);
		this.sendResult(msg, {});
	}

	private registerBusListeners(): void {
		const bus = this.eventBusOverride !== undefined ? this.eventBusOverride : getEventBus();
		if (!bus) return;

		const notifyWorkflowStatus = () => {
			if (this.subscriptions.has("kota://workflow/status")) {
				this.sendNotification("notifications/resources/updated", { uri: "kota://workflow/status" });
			}
		};

		const notifyTasksReady = () => {
			if (this.subscriptions.has("kota://tasks/ready")) {
				this.sendNotification("notifications/resources/updated", { uri: "kota://tasks/ready" });
			}
		};

		this.busUnsubs.push(bus.on("workflow.started", notifyWorkflowStatus));
		this.busUnsubs.push(bus.on("workflow.completed", notifyWorkflowStatus));
		this.busUnsubs.push(bus.on("task.changed", notifyTasksReady));
	}

	private cleanupBusSubscriptions(): void {
		for (const unsub of this.busUnsubs) unsub();
		this.busUnsubs = [];
	}

	private sendNotification(method: string, params: Record<string, unknown>): void {
		this.send({ jsonrpc: "2.0", method, params });
	}

	private handleResourcesList(msg: JsonRpcRequest): void {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}
		this.sendResult(msg, { resources: KOTA_RESOURCES });
	}

	private handleResourcesRead(msg: JsonRpcRequest): void {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const uri = (msg.params as Record<string, unknown> | undefined)?.uri as string | undefined;
		if (!uri || typeof uri !== "string") {
			this.sendError(msg, -32602, "Missing required parameter: uri");
			return;
		}
		if (!KNOWN_RESOURCE_URIS.has(uri)) {
			this.sendError(msg, -32002, `Unknown resource: ${uri}`);
			return;
		}
		const text = readKotaResource(uri, this.projectDir);
		this.sendResult(msg, {
			contents: [{ uri, mimeType: "application/json", text }],
		});
	}

	private handlePromptsList(msg: JsonRpcRequest): void {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}
		this.sendResult(msg, { prompts: KOTA_PROMPTS });
	}

	private handlePromptsGet(msg: JsonRpcRequest): void {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const params = msg.params ?? {};
		const name = params.name as string | undefined;
		if (!name || typeof name !== "string") {
			this.sendError(msg, -32602, "Missing required parameter: name");
			return;
		}
		if (!isKnownPrompt(name)) {
			this.sendError(msg, -32602, `Unknown prompt: ${name}`);
			return;
		}
		const args = (params.arguments ?? {}) as Record<string, string>;
		const result = renderPrompt(name, args);
		this.sendResult(msg, result);
	}

	private handleToolsList(msg: JsonRpcRequest): void {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}

		const tools = this.getExposedTools().map(anthropicToMcp);
		this.sendResult(msg, { tools });
	}

	private async handleToolsCall(msg: JsonRpcRequest): Promise<void> {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}

		const params = msg.params ?? {};
		const name = params.name as string;
		const args = (params.arguments ?? {}) as Record<string, unknown>;

		if (!name || typeof name !== "string") {
			return this.sendError(msg, -32602, "Missing required parameter: name");
		}

		// Verify tool exists and is exposed
		const exposed = this.getExposedTools();
		if (!exposed.some((t) => t.name === name)) {
			return this.sendError(msg, -32602, `Unknown tool: ${name}`);
		}

		this.log(`Calling tool: ${name}`);
		let result: ToolResult;
		const extRunner = this.extensionRunners.get(name);
		if (extRunner) {
			try {
				result = await extRunner(args);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				result = { content: `Tool error: ${msg}`, is_error: true };
			}
		} else {
			result = await executeTool(name, args);
		}
		const content = toolResultToMcp(result);

		this.sendResult(msg, {
			content,
			...(result.is_error && { isError: true }),
		});
	}

	private sendResult(msg: JsonRpcRequest, result: unknown): void {
		this.send({ jsonrpc: "2.0", id: msg.id, result });
	}

	private sendError(msg: JsonRpcRequest, code: number, message: string): void {
		this.send({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
	}

	private send(msg: unknown): void {
		this.output.write(`${JSON.stringify(msg)}\n`);
	}
}

/** Convert Anthropic tool format to MCP tool format. */
export function anthropicToMcp(tool: Anthropic.Tool): {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
} {
	return {
		name: tool.name,
		description: tool.description ?? "",
		inputSchema: tool.input_schema as Record<string, unknown>,
	};
}

/** Convert KOTA ToolResult to MCP content blocks. */
export function toolResultToMcp(result: ToolResult): McpContentBlock[] {
	if (result.blocks?.length) {
		return result.blocks.map((block) => {
			if (block.type === "image") {
				return {
					type: "image" as const,
					data: block.source.data,
					mimeType: block.source.media_type,
				};
			}
			return { type: "text" as const, text: block.text };
		});
	}
	return [{ type: "text", text: result.content }];
}
