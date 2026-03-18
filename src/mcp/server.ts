/**
 * MCP Server — expose KOTA tools via the Model Context Protocol.
 *
 * JSON-RPC 2.0 over stdio, mirroring the client in mcp-client.ts.
 * Any MCP-compatible host (Claude Code, Cursor, VS Code, etc.) can
 * connect and use KOTA's tools without a custom integration.
 */

import { createInterface, type Interface } from "node:readline";
import type Anthropic from "@anthropic-ai/sdk";
import { executeTool, getAllTools, type ToolResult } from "../tools/index.js";

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

	constructor(options: McpServerOptions = {}) {
		this.toolFilter = options.toolFilter?.length ? new Set(options.toolFilter) : null;
		this.serverName = options.name ?? "kota";
		this.serverVersion = options.version ?? "0.1.0";
		this.input = options.input ?? process.stdin;
		this.output = options.output ?? process.stdout;
		this.log = options.log ?? ((msg) => process.stderr.write(`[mcp-server] ${msg}\n`));
	}

	/** Start listening for JSON-RPC messages on stdio. */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		this.rl = createInterface({ input: this.input });
		this.rl.on("line", (line) => this.handleLine(line));
		this.rl.on("close", () => {
			this.running = false;
		});

		this.log("MCP server started, waiting for initialize...");
	}

	/** Stop the server. */
	stop(): void {
		this.running = false;
		this.rl?.close();
		this.rl = null;
	}

	isRunning(): boolean {
		return this.running;
	}

	/** Get the tools this server exposes (respecting filter). */
	getExposedTools(): Anthropic.Tool[] {
		const all = getAllTools();
		if (!this.toolFilter) return [...all];
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
			},
			serverInfo: {
				name: this.serverName,
				version: this.serverVersion,
			},
		});
		this.log("Initialized successfully");
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
		const result = await executeTool(name, args);
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
