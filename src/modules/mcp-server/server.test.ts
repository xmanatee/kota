import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { EventBus } from "#core/events/event-bus.js";
import { networkReadEffect } from "#core/tools/effect.js";
import { buildMcpServerDiscoverCapabilities } from "./mcp-capabilities.js";
import {
	type JsonRpcOutboundPayload,
	MCP_CURRENT_PROTOCOL_VERSION,
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_META_CLIENT_CAPABILITIES_KEY,
	MCP_META_CLIENT_INFO_KEY,
	MCP_META_LOG_LEVEL_KEY,
	MCP_META_PROTOCOL_VERSION_KEY,
	MCP_TASKS_EXTENSION_ID,
} from "./mcp-protocol-types.js";
import { McpTaskStore } from "./mcp-task-store.js";
import { McpServer, type McpServerDispatchResult, type McpServerOptions } from "./server.js";

type RpcResponse = {
	jsonrpc: "2.0";
	id: string | number;
	result?: KotaJsonValue;
	error?: { code: number; message: string; data?: KotaJsonValue };
};

let requestId = 0;

function requestMeta(
	capabilities: KotaJsonObject = {},
	extra: KotaJsonObject = {},
	protocolVersion = MCP_CURRENT_PROTOCOL_VERSION,
): KotaJsonObject {
	return {
		...extra,
		_meta: {
			[MCP_META_PROTOCOL_VERSION_KEY]: protocolVersion,
			[MCP_META_CLIENT_INFO_KEY]: { name: "server-handler-test", version: "1" },
			[MCP_META_CLIENT_CAPABILITIES_KEY]: capabilities,
		},
	};
}

function responseFromDispatch(dispatch: McpServerDispatchResult): RpcResponse {
	if (dispatch.kind === "response") return dispatch.response as RpcResponse;
	if (dispatch.kind === "stream") {
		const response = dispatch.messages.find((message) =>
			typeof message === "object" && message !== null && "id" in message
		);
		if (response) return response as RpcResponse;
	}
	throw new Error(`Expected one JSON-RPC response, received ${dispatch.kind}`);
}

async function call(
	server: McpServer,
	method: string,
	params: KotaJsonObject = {},
): Promise<RpcResponse> {
	requestId += 1;
	return responseFromDispatch(await server.handleJsonRpcMessage({
		jsonrpc: "2.0",
		id: requestId,
		method,
		params,
	}));
}

async function initialize(
	server: McpServer,
	capabilities: KotaJsonObject = {},
	protocolVersion = MCP_CURRENT_PROTOCOL_VERSION,
): Promise<RpcResponse> {
	return call(server, "initialize", {
		protocolVersion,
		capabilities,
		clientInfo: { name: "server-handler-test", version: "1" },
	});
}

function resultObject(response: RpcResponse): KotaJsonObject {
	expect(response.error).toBeUndefined();
	expect(response.result).toBeTypeOf("object");
	return response.result as KotaJsonObject;
}

function tasksCapabilities(): KotaJsonObject {
	return { extensions: { [MCP_TASKS_EXTENSION_ID]: {} } };
}

function taskInputCapabilities(): KotaJsonObject {
	return {
		elicitation: { form: {} },
		...tasksCapabilities(),
	};
}

async function eventually<T>(read: () => T, accept: (value: T) => boolean): Promise<T> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const value = read();
		if (accept(value)) return value;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for MCP handler state");
}

describe("McpServer method handlers", () => {
	it("negotiates supported revisions and derives discovery capabilities from the server owner", async () => {
		const logs: string[] = [];
		const server = new McpServer({ name: "test-kota", version: "2", log: (line) => logs.push(line) });

		const discover = resultObject(await call(server, "server/discover", requestMeta()));
		expect(discover).toEqual({
			supportedVersions: expect.arrayContaining([MCP_CURRENT_PROTOCOL_VERSION, MCP_DRAFT_PROTOCOL_VERSION]),
			capabilities: buildMcpServerDiscoverCapabilities(),
			serverInfo: { name: "test-kota", version: "2" },
		});

		const initialized = resultObject(await initialize(server));
		expect(initialized).toMatchObject({
			protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
			capabilities: buildMcpServerDiscoverCapabilities(),
			serverInfo: { name: "test-kota", version: "2" },
		});
		expect(logs.some((line) => line.includes("Initialized successfully"))).toBe(true);

		const unsupported = await initialize(server, {}, "2099-01-01");
		expect(unsupported.error).toMatchObject({ code: -32602, message: "Unsupported protocol version" });
	});

	it("rejects malformed request metadata without falling back to a legacy session", async () => {
		const server = new McpServer({ log: () => {} });
		const missing = await call(server, "tools/list");
		expect(missing.error).toMatchObject({ code: -32602, message: expect.stringContaining("_meta") });

		const malformed = await call(server, "tools/list", {
			_meta: {
				[MCP_META_PROTOCOL_VERSION_KEY]: MCP_CURRENT_PROTOCOL_VERSION,
				[MCP_META_CLIENT_INFO_KEY]: { name: "peer", version: "1" },
				[MCP_META_CLIENT_CAPABILITIES_KEY]: [],
			},
		});
		expect(malformed.error).toMatchObject({ code: -32602, message: expect.stringContaining("Capabilities") });
	});

	it("projects filtered module tools and validates complete structured results", async () => {
		const runner = vi.fn(async () => ({
			content: "counted",
			structuredContent: { count: 2 },
		}));
		const server = new McpServer({
			log: () => {},
			toolFilter: ["counter"],
			moduleTools: [{
				tool: {
					name: "counter",
					description: "Count values",
					input_schema: {
						type: "object",
						properties: { amount: { type: "number" } },
						required: ["amount"],
					},
					output_schema: {
						type: "object",
						properties: { count: { type: "number" } },
						required: ["count"],
					},
				},
				runner,
				effect: networkReadEffect(),
			}],
		});
		await initialize(server);

		const listed = resultObject(await call(server, "tools/list"));
		expect(listed.tools).toEqual([expect.objectContaining({
			name: "counter",
			outputSchema: expect.objectContaining({ type: "object" }),
		})]);

		const called = resultObject(await call(server, "tools/call", {
			name: "counter",
			arguments: { amount: 2 },
		}));
		expect(called).toMatchObject({
			resultType: "complete",
			content: [{ type: "text", text: "counted" }],
			structuredContent: { count: 2 },
		});
		expect(runner).toHaveBeenCalledWith({ amount: 2 });

		const unknown = await call(server, "tools/call", { name: "missing", arguments: {} });
		expect(unknown.error).toMatchObject({ code: -32602, message: "Unknown tool: missing" });
	});

	it("keeps official Tasks calls asynchronous and exposes their terminal result", async () => {
		const store = new McpTaskStore({ generateTaskId: () => "task-handler-1" });
		const server = new McpServer({
			log: () => {},
			taskStore: store,
			moduleTools: [{
				tool: { name: "slow_read", description: "Read later", input_schema: { type: "object", properties: {} } },
				runner: async () => ({ content: "finished" }),
				effect: networkReadEffect(),
			}],
		});
		await initialize(server, tasksCapabilities());

		const started = resultObject(await call(server, "tools/call", {
			name: "slow_read",
			arguments: {},
		}));
		expect(started).toMatchObject({ resultType: "task", taskId: "task-handler-1", status: "working" });

		const settled = await eventually(
			() => store.read("task-handler-1"),
			(task) => task.status === "completed",
		);
		expect(settled).toMatchObject({ status: "completed", result: { resultType: "complete" } });
		const fetched = resultObject(await call(server, "tasks/get", { taskId: "task-handler-1" }));
		expect(fetched).toMatchObject({ taskId: "task-handler-1", status: "completed" });
	});

	it("resumes task-owned input_required calls only with their bound requestState", async () => {
		const store = new McpTaskStore({ generateTaskId: () => "task-input-1" });
		const server = new McpServer({
			log: () => {},
			taskStore: store,
			toolFilter: ["confirm"],
		});
		const capabilities = taskInputCapabilities();
		await initialize(server, capabilities);

		const started = resultObject(await call(server, "tools/call", {
			name: "confirm",
			arguments: { action: "Rotate signing key", risk: "high" },
		}));
		expect(started).toMatchObject({ resultType: "task", taskId: "task-input-1" });

		const waiting = await eventually(
			() => store.read("task-input-1"),
			(task) => task.status === "input_required",
		);
		expect(waiting).toMatchObject({
			status: "input_required",
			inputRequests: { confirm: { method: "elicitation/create" } },
			requestState: expect.any(String),
		});
		if (typeof waiting.requestState !== "string") throw new Error("Expected task requestState");

		const stale = await call(server, "tasks/update", {
			taskId: "task-input-1",
			inputResponses: { confirm: { action: "accept", content: { confirmed: true } } },
			requestState: "stale-state",
		});
		expect(stale.error).toMatchObject({ code: -32602, message: "Stale requestState for task input" });
		expect(store.read("task-input-1").status).toBe("input_required");

		const accepted = resultObject(await call(server, "tasks/update", {
			taskId: "task-input-1",
			inputResponses: { confirm: { action: "accept", content: { confirmed: true } } },
			requestState: waiting.requestState,
		}));
		expect(accepted).toEqual({});

		const completed = await eventually(
			() => store.read("task-input-1"),
			(task) => task.status === "completed",
		);
		expect(completed).toMatchObject({
			status: "completed",
			result: {
				resultType: "complete",
				content: [{ type: "text", text: expect.stringContaining("APPROVED: Rotate signing key") }],
			},
		});
	});

	it("adapts task and workflow resources through resources/list and resources/read", async () => {
		const scopeRoot = mkdtempSync(join(tmpdir(), "kota-mcp-resources-fallback-"));
		const tasksDir = join(scopeRoot, "data", "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeFileSync(join(tasksDir, "task-example.md"), [
			"---", "status: open", "priority: p1", "---", "", "# Example task", "",
		].join("\n"));
		const rootScope = mkdtempSync(join(tmpdir(), "kota-mcp-resources-root-"));
		const rootTasksDir = join(rootScope, "data", "tasks");
		mkdirSync(rootTasksDir, { recursive: true });
		writeFileSync(join(rootTasksDir, "task-root.md"), [
			"---", "status: open", "priority: p1", "---", "", "# Root task", "",
		].join("\n"));
		const server = new McpServer({ scopeRoot, log: () => {} });
		const capabilities = { roots: {} };
		await initialize(server, capabilities, MCP_DRAFT_PROTOCOL_VERSION);

		const listed = resultObject(await call(server, "resources/list", requestMeta(
			capabilities,
			{},
			MCP_DRAFT_PROTOCOL_VERSION,
		)));
		expect(listed.resources).toEqual(expect.arrayContaining([
			expect.objectContaining({ uri: "kota://tasks/open" }),
			expect.objectContaining({ uri: "kota://workflow/status" }),
		]));

		const requested = resultObject(await call(server, "resources/read", requestMeta(
			capabilities,
			{ uri: "kota://tasks/open" },
			MCP_DRAFT_PROTOCOL_VERSION,
		)));
		expect(requested).toMatchObject({
			resultType: "input_required",
			inputRequests: { roots: { method: "roots/list" } },
			requestState: expect.any(String),
		});
		const changedParams = await call(server, "resources/read", requestMeta(capabilities, {
			uri: "kota://workflow/status",
			inputResponses: { roots: { roots: [{ uri: pathToFileURL(rootScope).href }] } },
			requestState: requested.requestState,
		}, MCP_DRAFT_PROTOCOL_VERSION));
		expect(changedParams.error).toMatchObject({
			code: -32602,
			message: "requestState does not match requested parameters",
		});

		const read = resultObject(await call(server, "resources/read", requestMeta(capabilities, {
			uri: "kota://tasks/open",
			inputResponses: { roots: { roots: [{ uri: pathToFileURL(rootScope).href }] } },
			requestState: requested.requestState,
		}, MCP_DRAFT_PROTOCOL_VERSION)));
		const contents = read.contents as Array<{ text: string }>;
		expect(JSON.parse(contents[0]!.text)).toEqual([
			expect.objectContaining({ id: "task-root", title: "Root task", priority: "p1" }),
		]);
		const unknown = await call(server, "resources/read", requestMeta(
			{},
			{ uri: "kota://unknown" },
			MCP_DRAFT_PROTOCOL_VERSION,
		));
		expect(unknown.error).toMatchObject({ code: -32002, message: expect.stringContaining("Unknown resource") });
	});

	it("discovers and renders built-in and project prompt semantics", async () => {
		const scopeRoot = mkdtempSync(join(tmpdir(), "kota-mcp-prompts-fallback-"));
		const promptDir = join(scopeRoot, ".kota", "prompts");
		mkdirSync(promptDir, { recursive: true });
		writeFileSync(join(promptDir, "review.md"), [
			"---", "name: review", "description: Review a change", "variables:", "  - target", "---", "Review {{target}}", "",
		].join("\n"));
		const rootScope = mkdtempSync(join(tmpdir(), "kota-mcp-prompts-root-"));
		const rootPromptDir = join(rootScope, ".kota", "prompts");
		mkdirSync(rootPromptDir, { recursive: true });
		writeFileSync(join(rootPromptDir, "root-review.md"), [
			"---", "name: root-review", "description: Review from a returned root", "variables:", "  - target", "---", "Root review {{target}}", "",
		].join("\n"));
		const server = new McpServer({ scopeRoot, log: () => {} });
		const capabilities = { roots: {} };
		await initialize(server, capabilities, MCP_DRAFT_PROTOCOL_VERSION);

		const listed = resultObject(await call(server, "prompts/list", requestMeta(
			capabilities,
			{},
			MCP_DRAFT_PROTOCOL_VERSION,
		)));
		expect(listed.prompts).toEqual(expect.arrayContaining([
			expect.objectContaining({ name: "kota-create-task" }),
			expect.objectContaining({ name: "review", arguments: [expect.objectContaining({ name: "target", required: true })] }),
		]));
		const rendered = resultObject(await call(server, "prompts/get", requestMeta(
			{},
			{
				name: "review",
				arguments: { target: "MCP handlers" },
			},
			MCP_DRAFT_PROTOCOL_VERSION,
		)));
		expect(rendered.messages).toEqual([
			expect.objectContaining({ content: { type: "text", text: "Review MCP handlers" } }),
		]);

		const requested = resultObject(await call(server, "prompts/get", requestMeta(capabilities, {
			name: "root-review",
			arguments: { target: "MCP handlers" },
		}, MCP_DRAFT_PROTOCOL_VERSION)));
		expect(requested).toMatchObject({
			resultType: "input_required",
			inputRequests: { roots: { method: "roots/list" } },
			requestState: expect.any(String),
		});
		const rootRendered = resultObject(await call(server, "prompts/get", requestMeta(capabilities, {
			name: "root-review",
			arguments: { target: "MCP handlers" },
			inputResponses: { roots: { roots: [{ uri: pathToFileURL(rootScope).href }] } },
			requestState: requested.requestState,
		}, MCP_DRAFT_PROTOCOL_VERSION)));
		expect(rootRendered.messages).toEqual([
			expect.objectContaining({ content: { type: "text", text: "Root review MCP handlers" } }),
		]);

		const missing = await call(server, "prompts/get", requestMeta(
			{},
			{ name: "review", arguments: {} },
			MCP_DRAFT_PROTOCOL_VERSION,
		));
		expect(missing.error).toMatchObject({ code: -32602, message: expect.stringContaining("target") });
	});

	it("routes resource subscription events only to the registered draft stream", async () => {
		const bus = new EventBus();
		const server = new McpServer({ eventBus: bus, log: () => {} });
		await server.start();
		await initialize(server, {}, MCP_DRAFT_PROTOCOL_VERSION);
		const messages: JsonRpcOutboundPayload[] = [];
		const opened = await server.handleJsonRpcMessage({
			jsonrpc: "2.0",
			id: "subscription-1",
			method: "subscriptions/listen",
			params: {
				...requestMeta({}, { notifications: { resourceSubscriptions: ["kota://workflow/status"] } }),
				_meta: {
					[MCP_META_PROTOCOL_VERSION_KEY]: MCP_DRAFT_PROTOCOL_VERSION,
					[MCP_META_CLIENT_INFO_KEY]: { name: "subscriber", version: "1" },
					[MCP_META_CLIENT_CAPABILITIES_KEY]: {},
				},
			},
		}, (message) => messages.push(message));
		expect(opened.kind).toBe("accepted");
		const unregister = server.registerStreamSink("subscription-1", (message) => messages.push(message));

		bus.emit("workflow.completed", {
			scopeId: "test-scope",
			workflow: "builder",
			runId: "run-1",
			status: "success",
			triggerEvent: "runtime.idle",
			durationMs: 5,
			definitionPath: "builder/workflow.ts",
			runDir: ".kota/runs/run-1",
			tags: [],
		});
		await eventually(() => messages.length, (count) => count >= 2);
		expect(messages).toEqual(expect.arrayContaining([
			expect.objectContaining({ method: "notifications/subscriptions/acknowledged" }),
			expect.objectContaining({
				method: "notifications/resources/updated",
				params: expect.objectContaining({ uri: "kota://workflow/status" }),
			}),
		]));
		unregister();
		server.stop();
	});

	it("sanitizes request-scoped log data before emitting protocol notifications", async () => {
		const server = new McpServer({
			log: () => {},
			moduleTools: [{
				tool: { name: "loggable", description: "Log safely", input_schema: { type: "object", properties: {} } },
				runner: async () => ({
					content: "Authorization: Bearer top-secret-token at /Users/operator/private",
					is_error: true,
				}),
				effect: networkReadEffect(),
			}],
		});
		const params = requestMeta({}, { name: "loggable", arguments: {} });
		(params._meta as KotaJsonObject)[MCP_META_LOG_LEVEL_KEY] = "debug";
		const dispatch = await server.handleJsonRpcMessage({
			jsonrpc: "2.0",
			id: 900,
			method: "tools/call",
			params,
		});
		expect(dispatch.kind).toBe("stream");
		if (dispatch.kind !== "stream") throw new Error("Expected streamed log notifications");
		const serialized = JSON.stringify(dispatch.messages.filter((message) =>
			typeof message === "object" && message !== null && "method" in message
		));
		expect(serialized).toContain("[redacted]");
		expect(serialized).not.toContain("top-secret-token");
		expect(serialized).not.toContain("/Users/operator/private");
	});

	it("forwards legacy sampling requests while rejecting them on modern revisions", async () => {
		const create = vi.fn(async () => ({
			id: "message-1",
			type: "message" as const,
			role: "assistant" as const,
			model: "test-model",
			content: [{ type: "text" as const, text: "sampled", citations: null }],
			stop_reason: "end_turn" as const,
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null },
		}));
		const modelClient: McpServerOptions["modelClient"] = {
			messages: { create, stream: () => { throw new Error("not used"); } },
		};
		const legacy = new McpServer({ log: () => {}, samplingEnabled: true, samplingModel: "test-model", modelClient });
		await initialize(legacy, {}, "2024-11-05");
		const sampled = resultObject(await call(legacy, "sampling/createMessage", {
			messages: [{ role: "user", content: { type: "text", text: "hello" } }],
			maxTokens: 12,
		}));
		expect(sampled).toMatchObject({ role: "assistant", content: { text: "sampled" }, model: "test-model" });
		expect(create).toHaveBeenCalledOnce();

		const modern = new McpServer({ log: () => {}, samplingEnabled: true, modelClient });
		await initialize(modern);
		const rejected = await call(modern, "sampling/createMessage", {
			messages: [{ role: "user", content: { type: "text", text: "hello" } }],
		});
		expect(rejected.error).toMatchObject({ code: -32601, message: expect.stringContaining("sampling/createMessage") });
	});

	it("completes only known prompt arguments from their production catalogs", async () => {
		const server = new McpServer({ log: () => {} });
		await initialize(server);
		const completed = resultObject(await call(server, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-create-task" },
			argument: { name: "priority", value: "p" },
			context: { arguments: { title: "MCP", area: "protocol" } },
		}));
		expect(completed.completion).toEqual({ values: ["p1", "p2", "p3"], total: 3, hasMore: false });

		const invalid = await call(server, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-create-task" },
			argument: { name: "unknown", value: "" },
		});
		expect(invalid.error).toMatchObject({ code: -32602, message: expect.stringContaining("Unknown prompt argument") });
	});
});
