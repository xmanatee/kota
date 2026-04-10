/**
 * MCP Server — expose KOTA tools via the Model Context Protocol.
 *
 * JSON-RPC 2.0 over stdio, mirroring the client in mcp-client.ts.
 * Any MCP-compatible host (Claude Code, Cursor, VS Code, etc.) can
 * connect and use KOTA's tools without a custom integration.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "../config.js";
import type { EventBus } from "../core/events/event-bus.js";
import { getEventBus } from "../core/events/event-bus.js";
import { CostTracker } from "../core/loop/cost.js";
import { loadModuleMetadata } from "../core/modules/module-metadata.js";
import type { ToolDef } from "../core/modules/module-types.js";
import { getToolMcpAnnotations } from "../core/tools/guardrails-classify.js";
import { executeTool, getAllTools, type ToolResult } from "../core/tools/index.js";
import { WorkflowRunStore } from "../core/workflow/run-store.js";
import type { MessageCreateParams, ModelClient } from "../model/model-client.js";
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

type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: { code: number; message: string };
};

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

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
	 * Module-contributed tools to expose alongside project tools. These are
	 * routed through their own runners, not the global tool registry. Useful for
	 * the daemon-embedded MCP server and for tests.
	 */
	moduleTools?: ToolDef[];
	/**
	 * Model client to use for sampling/createMessage requests.
	 * Required when samplingEnabled is true.
	 */
	modelClient?: ModelClient;
	/** Default model name to use for sampling requests. */
	samplingModel?: string;
	/** Advertise and handle sampling capability (default: false). */
	samplingEnabled?: boolean;
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
	private moduleRunners = new Map<string, (input: Record<string, unknown>) => Promise<ToolResult>>();
	private moduleToolList: Anthropic.Tool[] = [];
	private clientSupportsElicitation = false;
	private pendingElicitations = new Map<
		number | string,
		{ resolve: (r: ElicitationResponse) => void; reject: (e: Error) => void }
	>();
	private elicitationIdCounter = 0;
	private samplingEnabled: boolean;
	private modelClient: ModelClient | null;
	private samplingModel: string;
	private clientSupportsRoots = false;
	private clientRoots: Array<{ uri: string; name?: string }> = [];
	private pendingRootsRequest: {
		id: number | string;
		resolve: (roots: Array<{ uri: string; name?: string }>) => void;
		reject: (e: Error) => void;
	} | null = null;
	private rootsRequestIdCounter = 0;

	constructor(options: McpServerOptions = {}) {
		this.toolFilter = options.toolFilter?.length ? new Set(options.toolFilter) : null;
		this.serverName = options.name ?? "kota";
		this.serverVersion = options.version ?? "0.1.0";
		this.input = options.input ?? process.stdin;
		this.output = options.output ?? process.stdout;
		this.log = options.log ?? ((msg) => process.stderr.write(`[mcp-server] ${msg}\n`));
		this.projectDir = options.projectDir ?? process.cwd();
		this.eventBusOverride = options.eventBus;
		this.samplingEnabled = options.samplingEnabled ?? false;
		this.modelClient = options.modelClient ?? null;
		this.samplingModel = options.samplingModel ?? "claude-sonnet-4-6";
		for (const def of options.moduleTools ?? []) {
			this.moduleRunners.set(def.tool.name, def.runner);
			this.moduleToolList.push(def.tool);
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

	/** Get the tools this server exposes (respecting filter). Merges project and module tools. */
	getExposedTools(): Anthropic.Tool[] {
		const builtinNames = new Set(getAllTools().map((t) => t.name));
		const all = [
			...getAllTools(),
			...this.moduleToolList.filter((t) => !builtinNames.has(t.name)),
		];
		if (!this.toolFilter) return all;
		return all.filter((t) => this.toolFilter!.has(t.name));
	}

	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;

		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			return; // Ignore non-JSON lines
		}

		const msg = parsed as Record<string, unknown>;
		if (msg.jsonrpc !== "2.0") return;

		// Response (has id, no method) — resolve pending elicitation
		if ("id" in msg && msg.id !== undefined && !("method" in msg)) {
			this.handleResponse(msg as unknown as JsonRpcResponse);
			return;
		}

		const rpcMsg = parsed as JsonRpcMessage;

		// Notification (no id) — fire and forget
		if (!("id" in rpcMsg) || rpcMsg.id === undefined) {
			this.handleNotification(rpcMsg as JsonRpcNotification);
			return;
		}

		// Request (has id and method) — must respond
		this.handleRequest(rpcMsg as JsonRpcRequest).catch((err) => {
			this.sendError(rpcMsg as JsonRpcRequest, -32603, `Internal error: ${err instanceof Error ? err.message : String(err)}`);
		});
	}

	private handleResponse(msg: JsonRpcResponse): void {
		if (this.pendingRootsRequest && msg.id === this.pendingRootsRequest.id) {
			const pending = this.pendingRootsRequest;
			this.pendingRootsRequest = null;
			if (msg.error) {
				pending.reject(new Error(msg.error.message));
				return;
			}
			const roots = ((msg.result as Record<string, unknown>)?.roots ?? []) as Array<{ uri: string; name?: string }>;
			pending.resolve(roots);
			return;
		}
		const pending = this.pendingElicitations.get(msg.id);
		if (!pending) return;
		this.pendingElicitations.delete(msg.id);
		if (msg.error) {
			pending.reject(new Error(msg.error.message));
			return;
		}
		const result = msg.result as { action?: string; content?: Record<string, unknown> } | undefined;
		const action = result?.action;
		if (action === "accept") {
			pending.resolve({ action: "accept", content: result?.content ?? {} });
		} else if (action === "reject") {
			pending.resolve({ action: "reject" });
		} else {
			pending.resolve({ action: "cancel" });
		}
	}

	private handleNotification(msg: JsonRpcNotification): void {
		if (msg.method === "notifications/initialized") {
			this.log("Client confirmed initialization");
		} else if (msg.method === "notifications/roots/list_changed" && this.clientSupportsRoots) {
			setImmediate(() => {
				this.fetchClientRoots().catch((err) => {
					this.log(`Failed to refresh client roots: ${err instanceof Error ? err.message : String(err)}`);
				});
			});
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
			case "sampling/createMessage":
				return this.handleSamplingCreateMessage(msg);
			case "completion/complete":
				return this.handleCompletionComplete(msg);
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
		const clientCaps = (msg.params?.capabilities ?? {}) as Record<string, unknown>;
		this.clientSupportsElicitation = typeof clientCaps.elicitation === "object" && clientCaps.elicitation !== null;
		this.clientSupportsRoots = typeof clientCaps.roots === "object" && clientCaps.roots !== null;
		const capabilities: Record<string, unknown> = {
			tools: {},
			resources: { subscribe: true },
			prompts: {},
			completions: {},
			roots: {},
		};
		if (this.clientSupportsElicitation) {
			capabilities.elicitation = {};
		}
		if (this.samplingEnabled && this.modelClient) {
			capabilities.sampling = {};
		}
		this.sendResult(msg, {
			protocolVersion: "2024-11-05",
			capabilities,
			serverInfo: {
				name: this.serverName,
				version: this.serverVersion,
			},
		});
		this.log(`Initialized successfully (elicitation: ${this.clientSupportsElicitation}, sampling: ${this.samplingEnabled && !!this.modelClient}, completions: true, roots: ${this.clientSupportsRoots})`);
		if (this.clientSupportsRoots) {
			// Defer so the initialize response is fully consumed by the client before
			// we send the roots/list request — avoids dropped writes on synchronous streams.
			setImmediate(() => {
				this.fetchClientRoots().catch((err) => {
					this.log(`Failed to fetch client roots: ${err instanceof Error ? err.message : String(err)}`);
				});
			});
		}
	}

	private async fetchClientRoots(): Promise<void> {
		const id = `roots-${++this.rootsRequestIdCounter}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRootsRequest = null;
				reject(new Error("roots/list request timed out"));
			}, 10_000);
			this.pendingRootsRequest = {
				id,
				resolve: (roots) => {
					clearTimeout(timer);
					this.clientRoots = roots;
					resolve();
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			};
			this.send({ jsonrpc: "2.0", id, method: "roots/list", params: {} });
		});
	}

	/** Returns the client-provided workspace roots, or an empty array if none. */
	getClientRoots(): Array<{ uri: string; name?: string }> {
		return [...this.clientRoots];
	}

	/**
	 * Returns the effective project directory: the first client root's file path
	 * when roots are provided, otherwise the configured projectDir.
	 */
	getEffectiveProjectDir(): string {
		if (this.clientRoots.length > 0) {
			const firstUri = this.clientRoots[0].uri;
			if (firstUri.startsWith("file://")) {
				try {
					return new URL(firstUri).pathname;
				} catch {
					// Fall through to default
				}
			}
		}
		return this.projectDir;
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
		const text = readKotaResource(uri, this.getEffectiveProjectDir());
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

		const tools = this.getExposedTools().map((t) => {
			const mcp = anthropicToMcp(t);
			const annotations = getToolMcpAnnotations(t.name);
			return annotations ? { ...mcp, annotations } : mcp;
		});
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

		// When the confirm tool is called over MCP and the client supports elicitation,
		// use the standard elicitation protocol instead of falling back to /dev/tty.
		if (name === "confirm" && this.clientSupportsElicitation) {
			const action = args.action as string;
			const details = args.details as string | undefined;
			const risk = (args.risk as string) ?? "medium";
			const timeoutSec = typeof args.timeout === "number" ? args.timeout : { low: 60, medium: 300, high: 600 }[risk] ?? 300;
			const elicitMessage = `Approve this action? [${risk.toUpperCase()} risk]\n${action}${details ? `\n\nDetails: ${details}` : ""}`;
			let elicitResult: ElicitationResponse | null;
			try {
				elicitResult = await this.requestElicitation(
					elicitMessage,
					{
						type: "object",
						properties: {
							confirmed: { type: "boolean", title: "Approve?" },
						},
					},
					timeoutSec * 1000,
				);
			} catch {
				elicitResult = null;
			}
			let text: string;
			if (!elicitResult || elicitResult.action === "cancel") {
				text = `REJECTED: ${action}\nReason: Timed out or cancelled`;
			} else if (elicitResult.action === "reject") {
				text = `REJECTED: ${action}`;
			} else {
				const approved = elicitResult.content.confirmed === true;
				text = approved ? `APPROVED: ${action}` : `REJECTED: ${action}`;
			}
			this.sendResult(msg, { content: [{ type: "text", text }] });
			return;
		}

		let result: ToolResult;
		const extRunner = this.moduleRunners.get(name);
		if (extRunner) {
			try {
				result = await extRunner(args);
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				result = { content: `Tool error: ${errMsg}`, is_error: true };
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

	private async handleCompletionComplete(msg: JsonRpcRequest): Promise<void> {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}
		const params = (msg.params ?? {}) as Record<string, unknown>;
		const ref = params.ref as { type?: string; name?: string } | undefined;
		const argument = params.argument as { name?: string; value?: string } | undefined;

		if (!ref || !argument) {
			this.sendResult(msg, { completion: { values: [], hasMore: false } });
			return;
		}

		const argName = argument.name ?? "";
		const partial = (argument.value ?? "").toLowerCase();
		let values: string[] = [];

		if (ref.type === "ref/prompt") {
			const promptName = ref.name ?? "";
			if (promptName === "kota-trigger-workflow" && argName === "workflow") {
				const loader = await loadModuleMetadata(
					loadConfig(this.projectDir),
					this.projectDir,
					false,
				);
				const defs = loader.getContributedWorkflows();
				values = defs.map((d) => d.name).filter((n) => n.toLowerCase().startsWith(partial));
			} else if (promptName === "kota-summarize-run" && argName === "run_id") {
				try {
					const store = new WorkflowRunStore(this.projectDir);
					const runs = store.listRuns({ limit: 20 });
					values = runs.map((r) => r.id).filter((id) => id.toLowerCase().startsWith(partial));
				} catch {
					values = [];
				}
			}
		}

		this.sendResult(msg, { completion: { values, hasMore: false } });
	}

	private async handleSamplingCreateMessage(msg: JsonRpcRequest): Promise<void> {
		if (!this.initialized) {
			this.sendError(msg, -32002, "Server not initialized");
			return;
		}
		if (!this.samplingEnabled || !this.modelClient) {
			this.sendError(msg, -32601, "Sampling capability not enabled");
			return;
		}

		const params = (msg.params ?? {}) as Record<string, unknown>;
		const rawMessages = params.messages as Array<{ role: string; content: { type: string; text?: string; data?: string; mimeType?: string } }> | undefined;
		if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
			this.sendError(msg, -32602, "Missing required parameter: messages");
			return;
		}

		const maxTokens = typeof params.maxTokens === "number" && params.maxTokens > 0 ? params.maxTokens : 1024;
		const systemPrompt = typeof params.systemPrompt === "string" ? params.systemPrompt : undefined;

		// Convert MCP message format to Anthropic format
		const messages: Anthropic.MessageParam[] = rawMessages.map((m) => {
			const role = m.role === "assistant" ? "assistant" : "user";
			const content: string =
				m.content.type === "text" && m.content.text != null
					? m.content.text
					: "";
			return { role, content };
		});

		const callParams: MessageCreateParams = {
			model: this.samplingModel,
			max_tokens: maxTokens,
			messages,
			...(systemPrompt && { system: systemPrompt }),
		};

		let response: Anthropic.Message;
		try {
			response = await this.modelClient.messages.create(callParams);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			this.sendError(msg, -32603, `Model call failed: ${errMsg}`);
			return;
		}

		// Track cost by writing a synthetic run artifact
		this.writeSamplingRunArtifact(response.usage, response.model);

		// Extract text from response
		const textBlock = response.content.find((b) => b.type === "text");
		const text = textBlock && "text" in textBlock ? textBlock.text : "";

		const stopReason = response.stop_reason === "end_turn" ? "endTurn"
			: response.stop_reason === "max_tokens" ? "maxTokens"
			: (response.stop_reason ?? "endTurn");

		this.sendResult(msg, {
			role: "assistant",
			content: { type: "text", text },
			model: response.model,
			stopReason,
		});
	}

	private writeSamplingRunArtifact(usage: { input_tokens: number; output_tokens: number }, model: string): void {
		try {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			const suffix = Math.random().toString(36).slice(2, 8);
			const runId = `${stamp}-mcp-sampling-${suffix}`;
			const runDir = join(this.projectDir, ".kota", "runs", runId);

			const tracker = new CostTracker();
			tracker.addUsage(model, { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });
			const costUsd = tracker.getTotalCost();

			const now = new Date().toISOString();
			const metadata = {
				id: runId,
				workflow: "mcp-sampling",
				definitionPath: "",
				trigger: { event: "mcp.sampling", payload: {} },
				startedAt: now,
				completedAt: now,
				durationMs: 0,
				status: "success",
				runDir,
				steps: [],
				totalCostUsd: costUsd,
			};

			mkdirSync(runDir, { recursive: true });
			writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
		} catch {
			// Non-fatal: cost tracking failure should not break the sampling response
			this.log("Warning: failed to write sampling run artifact");
		}
	}

	/**
	 * Send a `sampling/elicit` request to the client and await the user's response.
	 * Returns null if the client does not support elicitation.
	 * Rejects with an error if the timeout expires before the client responds.
	 */
	async requestElicitation(
		message: string,
		requestedSchema: ElicitationSchema,
		timeoutMs = 300_000,
	): Promise<ElicitationResponse | null> {
		if (!this.clientSupportsElicitation) return null;
		const id = `elicit-${++this.elicitationIdCounter}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingElicitations.delete(id);
				reject(new Error("Elicitation timed out"));
			}, timeoutMs);
			this.pendingElicitations.set(id, {
				resolve: (r) => {
					clearTimeout(timer);
					resolve(r);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			this.send({ jsonrpc: "2.0", id, method: "sampling/elicit", params: { message, requestedSchema } });
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
