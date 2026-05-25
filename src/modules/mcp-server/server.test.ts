import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import {
	legacyEffect,
	networkDestructiveEffect,
	networkReadEffect,
	networkWriteEffect,
} from "#core/tools/effect.js";
import { getToolMcpAnnotations } from "#core/tools/guardrails-classify.js";
import { clearCustomTools, registerTool } from "#core/tools/index.js";
import executionModule from "#modules/execution/index.js";
import filesystemModule from "#modules/filesystem/index.js";
import {
	KOTA_STATUS_UI_RESOURCE_URI,
	MCP_UI_EXTENSION_ID,
	MCP_UI_RESOURCE_MIME_TYPE,
} from "./mcp-apps.js";
import {
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_META_CLIENT_CAPABILITIES_KEY,
	MCP_META_CLIENT_INFO_KEY,
	MCP_META_LOG_LEVEL_KEY,
	MCP_META_PROTOCOL_VERSION_KEY,
	MCP_RELATED_TASK_META_KEY,
	MCP_TASKS_EXTENSION_ID,
	type McpInputRequiredResult,
} from "./mcp-protocol-types.js";
import { McpTaskStore } from "./mcp-task-store.js";
import { kotaToolToMcp, McpServer, type McpServerOptions, toolResultToMcp } from "./server.js";

vi.mock("#core/modules/provider-registry.js", () => ({
	getMemoryProvider: vi.fn(() => ({ list: () => [] })),
	getKnowledgeProvider: vi.fn(() => ({ list: () => [] })),
}));

vi.mock("#core/modules/module-metadata.js", () => ({
	loadModuleMetadata: vi.fn(async () => ({
		getContributedWorkflows: () => [
			{ name: "builder", triggers: [], steps: [], enabled: true, definitionPath: "" },
			{ name: "explorer", triggers: [], steps: [], enabled: true, definitionPath: "" },
			{ name: "inbox-sorter", triggers: [], steps: [], enabled: true, definitionPath: "" },
			{ name: "improver", triggers: [], steps: [], enabled: true, definitionPath: "" },
			{ name: "attention-digest", triggers: [], steps: [], enabled: true, definitionPath: "" },
			{ name: "dispatcher", triggers: [], steps: [], enabled: true, definitionPath: "" },
		],
	})),
}));

import { getKnowledgeProvider, getMemoryProvider } from "#core/modules/provider-registry.js";

function mockDefaultProviders(): void {
	vi.mocked(getMemoryProvider).mockReturnValue({
		list: () => [],
		save: vi.fn(),
		search: vi.fn(() => []),
		update: vi.fn(),
		delete: vi.fn(),
		supportsSemanticSearch: vi.fn(() => false),
		semanticSearch: vi.fn(async () => []),
		reindex: vi.fn(async () => ({ indexed: 0, failed: 0, skipped: true })),
	});
	vi.mocked(getKnowledgeProvider).mockReturnValue({
		list: () => [],
		read: () => null,
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		search: vi.fn(() => []),
		count: vi.fn(() => 0),
		supportsSemanticSearch: vi.fn(() => false),
		semanticSearch: vi.fn(async () => []),
		reindex: vi.fn(async () => ({ indexed: 0, failed: 0, skipped: true })),
	});
}

beforeAll(async () => {
	const loader = new ModuleLoader({});
	await loader.loadAll([filesystemModule, executionModule]);

	// Register stubs for tools whose owning modules need real credentials at
	// load time but whose effect declarations the MCP annotation tests want
	// to verify. Each stub declares the same effect the production module
	// would.
	registerTool(
		{ name: "github_list_prs", description: "stub", input_schema: { type: "object", properties: {} } },
		async () => ({ content: "" }),
		"github",
		{ effect: networkReadEffect() },
	);
	registerTool(
		{ name: "github_merge_pr", description: "stub", input_schema: { type: "object", properties: {} } },
		async () => ({ content: "" }),
		"github",
		{ effect: networkDestructiveEffect() },
	);
	registerTool(
		{ name: "http_request", description: "stub", input_schema: { type: "object", properties: {} } },
		async () => ({ content: "" }),
		"web-access",
		{ effect: networkWriteEffect() },
	);
});

beforeEach(() => {
	mockDefaultProviders();
});

afterAll(() => {
	clearCustomTools();
});

// --- Helper: send a JSON-RPC request and read the response ---

function createTestStreams() {
	const input = new PassThrough();
	const output = new PassThrough();
	return { input, output };
}

function sendRequest(
	input: PassThrough,
	id: number | string,
	method: string,
	params?: Record<string, unknown>,
): void {
	const msg = { jsonrpc: "2.0", id, method, ...(params && { params }) };
	input.write(`${JSON.stringify(msg)}\n`);
}

function sendNotification(
	input: PassThrough,
	method: string,
	params?: Record<string, unknown>,
): void {
	const msg = { jsonrpc: "2.0", method, ...(params && { params }) };
	input.write(`${JSON.stringify(msg)}\n`);
}

async function readResponse(output: PassThrough): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Timeout reading response")), 2000);
		const onData = (chunk: Buffer) => {
			const line = chunk.toString().trim();
			if (line) {
				clearTimeout(timeout);
				output.off("data", onData);
				resolve(JSON.parse(line));
			}
		};
		output.on("data", onData);
	});
}

function draftRequestParams(
	params: Record<string, unknown> = {},
	clientCapabilities: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		...params,
		_meta: {
			[MCP_META_PROTOCOL_VERSION_KEY]: MCP_DRAFT_PROTOCOL_VERSION,
			[MCP_META_CLIENT_INFO_KEY]: { name: "test", version: "1.0.0" },
			[MCP_META_CLIENT_CAPABILITIES_KEY]: clientCapabilities,
		},
	};
}

function draftRequestParamsWithProgress(
	params: Record<string, unknown>,
	progressToken: string | number,
): Record<string, unknown> {
	const next = draftRequestParams(params);
	(next._meta as Record<string, unknown>).progressToken = progressToken;
	return next;
}

function draftRequestParamsWithLogLevel(
	params: Record<string, unknown>,
	logLevel: string,
): Record<string, unknown> {
	const next = draftRequestParams(params);
	(next._meta as Record<string, unknown>)[MCP_META_LOG_LEVEL_KEY] = logLevel;
	return next;
}

function mcpUiClientCapabilities(): Record<string, unknown> {
	return {
		extensions: {
			[MCP_UI_EXTENSION_ID]: {
				mimeTypes: [MCP_UI_RESOURCE_MIME_TYPE],
			},
		},
	};
}

function mcpTasksClientCapabilities(): Record<string, unknown> {
	return {
		extensions: {
			[MCP_TASKS_EXTENSION_ID]: {},
		},
	};
}

function legacyDraftTasksClientCapabilities(): Record<string, unknown> {
	return { tasks: {} };
}

function mcpTasksElicitationClientCapabilities(): Record<string, unknown> {
	return {
		elicitation: {},
		extensions: {
			[MCP_TASKS_EXTENSION_ID]: {},
		},
	};
}

function manualClock(start = Date.parse("2026-05-21T00:00:00.000Z")) {
	let now = start;
	return {
		now: () => new Date(now),
		advance: (ms: number) => {
			now += ms;
		},
		iso: () => new Date(now).toISOString(),
	};
}

function taskIdGenerator(ids: string[]): () => string {
	let index = 0;
	return () => ids[index++] ?? `task-generated-${index}`;
}

function inputRequiredResult(): McpInputRequiredResult {
	return {
		resultType: "input_required",
		inputRequests: {
			confirm: {
				method: "elicitation/create",
				params: {
					mode: "form",
					message: "Approve?",
					requestedSchema: {
						type: "object",
						properties: {
							confirmed: { type: "boolean", title: "Approve?" },
						},
					},
				},
			},
		},
		requestState: "state-token",
	};
}

function writeProjectPrompt(
	projectDir: string,
	fileName: string,
	content: string,
): void {
	const promptsDir = join(projectDir, ".kota", "prompts");
	mkdirSync(promptsDir, { recursive: true });
	writeFileSync(join(promptsDir, fileName), content, "utf-8");
}

/**
 * Creates a queued reader for a stream that captures all output into a buffer.
 * Unlike readResponse(), this never misses writes that occur while no listener
 * is attached (which happens after readResponse() removes its listener but the
 * stream stays in flowing mode).
 */
function createQueuedReader(stream: PassThrough): { read: (timeoutMs?: number) => Promise<Record<string, unknown>> } {
	const buffer: string[] = [];
	const waiters: Array<{ resolve: (v: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }> = [];

	stream.on("data", (chunk: Buffer) => {
		for (const part of chunk.toString().split("\n")) {
			const line = part.trim();
			if (!line) continue;
			if (waiters.length > 0) {
				const { resolve, timer } = waiters.shift()!;
				clearTimeout(timer);
				resolve(JSON.parse(line));
			} else {
				buffer.push(line);
			}
		}
	});

	return {
		read(timeoutMs = 2000): Promise<Record<string, unknown>> {
			if (buffer.length > 0) return Promise.resolve(JSON.parse(buffer.shift()!));
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					const idx = waiters.findIndex((w) => w.resolve === resolve);
					if (idx >= 0) waiters.splice(idx, 1);
					reject(new Error("Timeout reading response"));
				}, timeoutMs);
				waiters.push({ resolve, timer });
			});
		},
	};
}

async function expectNoQueuedMessage(
	reader: ReturnType<typeof createQueuedReader>,
	timeoutMs = 50,
): Promise<void> {
	await expect(reader.read(timeoutMs)).rejects.toThrow("Timeout reading response");
}

async function initServer(
	server: McpServer,
	input: PassThrough,
	output: PassThrough,
): Promise<Record<string, unknown>> {
	await server.start();
	sendRequest(input, 1, "initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "test", version: "1.0.0" },
	});
	const resp = await readResponse(output);
	sendNotification(input, "notifications/initialized");
	return resp;
}

async function initDraftServer(
	server: McpServer,
	input: PassThrough,
	output: PassThrough,
): Promise<Record<string, unknown>> {
	await server.start();
	sendRequest(input, 1, "initialize", {
		protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: "test", version: "1.0.0" },
	});
	const resp = await readResponse(output);
	sendNotification(input, "notifications/initialized");
	return resp;
}

// --- Tests ---

describe("McpServer", () => {
	describe("initialize", () => {
		it("responds to initialize with protocol version and capabilities", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
			});

			const resp = await initServer(server, input, output);

			expect(resp.jsonrpc).toBe("2.0");
			expect(resp.id).toBe(1);
			const result = resp.result as Record<string, unknown>;
			expect(result.protocolVersion).toBe("2024-11-05");
			expect(result.capabilities).toEqual({ tools: {}, resources: { subscribe: true }, prompts: {}, completions: {}, roots: {} });
			expect(result.serverInfo).toEqual({ name: "kota", version: "0.1.0" });

			server.stop();
		});

		it("uses custom server name", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				name: "my-kota",
				version: "2.0.0",
				log: () => {},
			});

			const resp = await initServer(server, input, output);
			const result = resp.result as Record<string, unknown>;
			const info = result.serverInfo as Record<string, unknown>;
			expect(info.name).toBe("my-kota");
			expect(info.version).toBe("2.0.0");

			server.stop();
		});

		it("records the draft protocol version when the client requests it", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });

			const resp = await initDraftServer(server, input, output);

			const result = resp.result as Record<string, unknown>;
			expect(result.protocolVersion).toBe(MCP_DRAFT_PROTOCOL_VERSION);
			expect(result.capabilities).toMatchObject({
				resources: { listChanged: true },
			});
			const capabilities = result.capabilities as Record<string, Record<string, unknown>>;
			expect(capabilities.resources.subscribe).toBeUndefined();

			server.stop();
		});

		it("warns once for legacy deprecated roots and sampling negotiation without changing initialize", async () => {
			const { input, output } = createTestStreams();
			const logs: string[] = [];
			const server = new McpServer({
				input,
				output,
				log: (message) => logs.push(message),
				samplingEnabled: true,
				modelClient: {
					messages: {
						stream: () => { throw new Error("stream not used by initialize"); },
						create: async () => { throw new Error("create not used by initialize"); },
					},
				},
			});

			await server.start();
			const params = {
				protocolVersion: "2024-11-05",
				capabilities: { roots: {} },
				clientInfo: { name: "legacy-client", version: "2.3.4" },
			};
			sendRequest(input, 1, "initialize", params);
			const first = await readResponse(output);
			sendRequest(input, 2, "initialize", params);
			const second = await readResponse(output);

			expect(first.result).toMatchObject({
				protocolVersion: "2024-11-05",
				capabilities: { roots: {}, sampling: {} },
			});
			expect(second.result).toEqual(first.result);
			const warnings = logs.filter((message) => message.includes("deprecated MCP"));
			expect(warnings).toHaveLength(2);
			expect(warnings[0]).toContain('feature "roots"');
			expect(warnings[0]).toContain('peer "legacy-client"');
			expect(warnings[0]).toContain("protocol 2024-11-05");
			expect(warnings[0]).toContain("legacy server roots capability");
			expect(warnings[0]).toContain("compatibility-only");
			expect(warnings[1]).toContain('feature "sampling"');

			server.stop();
		});

		it("warns for legacy server roots advertisement when the client omits roots", async () => {
			const { input, output } = createTestStreams();
			const logs: string[] = [];
			const server = new McpServer({ input, output, log: (message) => logs.push(message) });

			const resp = await initServer(server, input, output);
			const result = resp.result as Record<string, unknown>;
			const capabilities = result.capabilities as Record<string, unknown>;
			expect(capabilities.roots).toEqual({});

			const warnings = logs.filter((message) => message.includes("deprecated MCP"));
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('feature "roots"');
			expect(warnings[0]).toContain('peer "test"');
			expect(warnings[0]).toContain("protocol 2024-11-05");
			expect(warnings[0]).toContain("legacy server roots capability");
			expect(warnings[0]).toContain("compatibility-only");

			server.stop();
		});

		it("serves server/discover before initialize with draft capabilities and identity", async () => {
			const { input, output } = createTestStreams();
			const logs: string[] = [];
			const server = new McpServer({
				input,
				output,
				name: "discoverable-kota",
				version: "9.8.7",
				log: (message) => logs.push(message),
				samplingEnabled: true,
				modelClient: {
					messages: {
						stream: () => { throw new Error("stream not used by discovery"); },
						create: async () => { throw new Error("create not used by discovery"); },
					},
				},
			});

			await server.start();
			sendRequest(input, 1, "server/discover", draftRequestParams());
			const resp = await readResponse(output);

			expect(resp.error).toBeUndefined();
			const result = resp.result as Record<string, unknown>;
			expect(result.supportedVersions).toEqual(
				expect.arrayContaining([MCP_DRAFT_PROTOCOL_VERSION, "2024-11-05"]),
			);
			expect(result.serverInfo).toEqual({ name: "discoverable-kota", version: "9.8.7" });
			const capabilities = result.capabilities as Record<string, unknown>;
			expect(capabilities).toEqual({
				tools: {},
				resources: { listChanged: true },
				prompts: { listChanged: true },
				completions: {},
				logging: {},
				extensions: {
					[MCP_UI_EXTENSION_ID]: { mimeTypes: [MCP_UI_RESOURCE_MIME_TYPE] },
					[MCP_TASKS_EXTENSION_ID]: {},
				},
			});
			expect(capabilities.tasks).toBeUndefined();
			expect(capabilities.sampling).toBeUndefined();
			expect(capabilities.elicitation).toBeUndefined();
			const warnings = logs.filter((message) => message.includes("deprecated MCP"));
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('feature "logging"');
			expect(warnings[0]).toContain('peer "test"');
			expect(warnings[0]).toContain(`protocol ${MCP_DRAFT_PROTOCOL_VERSION}`);
			expect(warnings[0]).toContain("compatibility-only");

			server.stop();
		});

		it("keeps draft initialize capabilities to server-owned features", async () => {
			const { input, output } = createTestStreams();
			const logs: string[] = [];
			const server = new McpServer({
				input,
				output,
				log: (message) => logs.push(message),
				samplingEnabled: true,
				modelClient: {
					messages: {
						stream: () => { throw new Error("stream not used by initialize"); },
						create: async () => { throw new Error("create not used by initialize"); },
					},
				},
			});

			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: { elicitation: {}, sampling: {}, roots: {} },
				clientInfo: { name: "test", version: "1.0.0" },
			});
			const resp = await readResponse(output);

			const result = resp.result as Record<string, unknown>;
			const capabilities = result.capabilities as Record<string, unknown>;
			expect(capabilities).toEqual({
				tools: {},
				resources: { listChanged: true },
				prompts: { listChanged: true },
				completions: {},
				logging: {},
				extensions: {
					[MCP_UI_EXTENSION_ID]: { mimeTypes: [MCP_UI_RESOURCE_MIME_TYPE] },
					[MCP_TASKS_EXTENSION_ID]: {},
				},
			});
			expect(capabilities.tasks).toBeUndefined();
			expect(capabilities.sampling).toBeUndefined();
			expect(capabilities.elicitation).toBeUndefined();
			expect(capabilities.roots).toBeUndefined();
			const warnings = logs.filter((message) => message.includes("deprecated MCP"));
			expect(warnings).toHaveLength(3);
			expect(warnings.map((message) => message.match(/feature "([^"]+)"/)?.[1]).sort()).toEqual([
				"logging",
				"roots",
				"sampling",
			]);

			server.stop();
		});

		it("rejects malformed MCP Apps initialize extension metadata", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {
					extensions: {
						[MCP_UI_EXTENSION_ID]: { mimeTypes: [MCP_UI_RESOURCE_MIME_TYPE, 42] },
					},
				},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			const resp = await readResponse(output);

			expect(resp.error).toMatchObject({
				code: -32602,
				message: `Malformed MCP client extension capability: ${MCP_UI_EXTENSION_ID}.mimeTypes`,
			});

			server.stop();
		});

		it("warns once for draft request deprecated client capabilities and request logging", async () => {
			const { input, output } = createTestStreams();
			const logs: string[] = [];
			const server = new McpServer({ input, output, log: (message) => logs.push(message) });
			await server.start();
			const params = draftRequestParams({}, { roots: {}, sampling: {} });
			(params._meta as Record<string, unknown>)[MCP_META_LOG_LEVEL_KEY] = "warning";

			sendRequest(input, 1, "tools/list", params);
			const first = await readResponse(output);
			sendRequest(input, 2, "tools/list", params);
			const second = await readResponse(output);

			expect(first.error).toBeUndefined();
			expect(second.error).toBeUndefined();
			const warnings = logs.filter((message) => message.includes("deprecated MCP"));
			expect(warnings).toHaveLength(3);
			expect(warnings.map((message) => message.match(/feature "([^"]+)"/)?.[1]).sort()).toEqual([
				"logging",
				"roots",
				"sampling",
			]);
			for (const warning of warnings) {
				expect(warning).toContain('peer "test"');
				expect(warning).toContain(`protocol ${MCP_DRAFT_PROTOCOL_VERSION}`);
				expect(warning).toContain("compatibility-only");
			}

			server.stop();
		});

		it("rejects unsupported initialize protocol versions", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });

			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: "1900-01-01",
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			const resp = await readResponse(output);

			expect(resp.result).toBeUndefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toBe("Unsupported protocol version");

			server.stop();
		});
	});

	describe("tasks", () => {
		function expectInvalidParams(resp: Record<string, unknown>, message: string): void {
			expect(resp.error).toMatchObject({ code: -32602, message });
		}

		it("gets seeded task states with direct input, result, and error fields", async () => {
			const clock = manualClock();
			const store = new McpTaskStore({
				now: clock.now,
				generateTaskId: taskIdGenerator(["task-working", "task-input", "task-done", "task-fail"]),
				defaultTtlMs: 60_000,
				pollIntervalMs: 2_000,
			});
			const { resultType: _resultType, ...working } = store.create({ statusMessage: "Running" });
			store.create();
			store.transition("task-input", {
				status: "input_required",
				inputRequired: inputRequiredResult(),
				statusMessage: "Waiting for input",
			});
			store.create();
			store.complete("task-done", { content: [{ type: "text", text: "done" }], isError: false });
			store.create();
			store.fail("task-fail", {
				code: -32099,
				message: "Underlying request failed",
				data: { retryable: false },
			});

			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, taskStore: store });
			await initDraftServer(server, input, output);

			const getParams = draftRequestParams({ taskId: "task-working" }, mcpTasksClientCapabilities());
			(getParams._meta as Record<string, unknown>)[MCP_RELATED_TASK_META_KEY] = {
				taskId: "ignored-related-task",
			};
			sendRequest(input, 2, "tasks/get", getParams);
			const getResp = await readResponse(output);
			expect(getResp.error).toBeUndefined();
			expect(getResp.result).toEqual(working);

			sendRequest(input, 3, "tasks/get", draftRequestParams(
				{ taskId: "task-input" },
				mcpTasksClientCapabilities(),
			));
			const inputResp = await readResponse(output);
			expect(inputResp.result).toMatchObject({
				taskId: "task-input",
				status: "input_required",
				inputRequests: { confirm: { method: "elicitation/create" } },
				requestState: "state-token",
			});

			sendRequest(input, 4, "tasks/get", draftRequestParams(
				{ taskId: "task-done" },
				mcpTasksClientCapabilities(),
			));
			const completeResp = await readResponse(output);
			expect(completeResp.result).toMatchObject({
				taskId: "task-done",
				status: "completed",
				result: { content: [{ type: "text", text: "done" }], isError: false },
			});

			sendRequest(input, 5, "tasks/get", draftRequestParams(
				{ taskId: "task-fail" },
				mcpTasksClientCapabilities(),
			));
			const failedResp = await readResponse(output);
			expect(failedResp.result).toMatchObject({
				taskId: "task-fail",
				status: "failed",
				error: {
					code: -32099,
					message: "Underlying request failed",
					data: { retryable: false },
				},
			});

			server.stop();
		});

		it("gates legacy draft task methods behind top-level client tasks compatibility", async () => {
			const store = new McpTaskStore({
				now: manualClock().now,
				generateTaskId: taskIdGenerator(["task-a", "task-b"]),
				defaultTtlMs: 60_000,
				pageSize: 1,
			});
			store.create();
			store.create();

			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, taskStore: store });
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tasks/list", draftRequestParams());
			expectInvalidParams(
				await readResponse(output),
				"Deprecated MCP draft tasks utility compatibility was not negotiated",
			);

			sendRequest(input, 3, "tasks/list", draftRequestParams(
				{},
				legacyDraftTasksClientCapabilities(),
			));
			const firstPage = await readResponse(output);
			expect(firstPage.error).toBeUndefined();
			const firstResult = firstPage.result as { tasks: Array<{ taskId: string }>; nextCursor?: string };
			expect(firstResult.tasks.map((task) => task.taskId)).toEqual(["task-a"]);
			expect(firstResult.tasks[0]).toMatchObject({ ttlMs: 60_000 });
			expect(firstResult.nextCursor).toEqual(expect.any(String));

			sendRequest(input, 4, "tasks/result", draftRequestParams(
				{ taskId: "task-a" },
				legacyDraftTasksClientCapabilities(),
			));
			store.complete("task-a", { content: [{ type: "text", text: "legacy result" }], isError: false });
			const result = await readResponse(output);
			expect(result.result).toMatchObject({
				content: [{ type: "text", text: "legacy result" }],
				_meta: { [MCP_RELATED_TASK_META_KEY]: { taskId: "task-a" } },
			});

			server.stop();
		});

		it("maps malformed, unknown, expired, invalid-cursor, and terminal-cancel cases to invalid params", async () => {
			const clock = manualClock();
			const store = new McpTaskStore({
				now: clock.now,
				generateTaskId: taskIdGenerator(["task-expiring", "task-terminal"]),
				defaultTtlMs: 60_000,
			});
			store.create({ requestedTtlMs: 10 });
			store.create();
			store.complete("task-terminal", { content: [{ type: "text", text: "done" }], isError: false });
			clock.advance(11);

			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, taskStore: store });
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tasks/get", draftRequestParams(
				{ taskId: 42 },
				mcpTasksClientCapabilities(),
			));
			expectInvalidParams(await readResponse(output), "Missing required parameter: taskId");

			sendRequest(input, 3, "tasks/get", draftRequestParams(
				{ taskId: "task-expiring" },
				mcpTasksClientCapabilities(),
			));
			expectInvalidParams(await readResponse(output), "Failed to retrieve task: Task has expired");

			sendRequest(input, 4, "tasks/get", draftRequestParams(
				{ taskId: "task-missing" },
				mcpTasksClientCapabilities(),
			));
			expectInvalidParams(await readResponse(output), "Failed to retrieve task: Task not found");

			sendRequest(input, 5, "tasks/list", draftRequestParams(
				{ cursor: "not-a-cursor" },
				legacyDraftTasksClientCapabilities(),
			));
			expectInvalidParams(await readResponse(output), "Invalid MCP task cursor");

			sendRequest(input, 6, "tasks/cancel", draftRequestParams(
				{ taskId: "task-terminal" },
				mcpTasksClientCapabilities(),
			));
			expectInvalidParams(
				await readResponse(output),
				"Cannot cancel task: already in terminal status 'completed'",
			);

			server.stop();
		});

		it("emits subscribed task status notifications for lifecycle snapshots", async () => {
			const clock = manualClock();
			const store = new McpTaskStore({
				now: clock.now,
				generateTaskId: taskIdGenerator(["task-input", "task-fail", "task-cancel"]),
				defaultTtlMs: 60_000,
				pollIntervalMs: 2_000,
			});
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const server = new McpServer({ input, output, log: () => {}, taskStore: store });
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "subscriptions/listen", draftRequestParams({
				notifications: { taskStatus: true },
			}, mcpTasksClientCapabilities()));
			const ack = await reader.read();
			expect(ack.method).toBe("notifications/subscriptions/acknowledged");
			expect(ack.params).toEqual({
				_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
				notifications: { taskStatus: true },
			});

			store.create({ statusMessage: "Created input task" });
			const createdInput = await reader.read();
			expect(createdInput).toMatchObject({
				method: "notifications/tasks/status",
				params: {
					_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
					taskId: "task-input",
					status: "working",
					statusMessage: "Created input task",
					ttlMs: 60_000,
					pollIntervalMs: 2_000,
				},
			});

			store.transition("task-input", {
				status: "input_required",
				inputRequired: inputRequiredResult(),
				statusMessage: "Waiting for input",
			});
			const inputRequired = await reader.read();
			expect(inputRequired).toMatchObject({
				method: "notifications/tasks/status",
				params: {
					_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
					taskId: "task-input",
					status: "input_required",
					statusMessage: "Waiting for input",
					inputRequests: { confirm: { method: "elicitation/create" } },
					requestState: "state-token",
				},
			});

			store.transition("task-input", { status: "working", statusMessage: "Resumed" });
			expect(await reader.read()).toMatchObject({
				method: "notifications/tasks/status",
				params: {
					_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
					taskId: "task-input",
					status: "working",
					statusMessage: "Resumed",
				},
			});

			store.create();
			await reader.read();
			store.fail("task-fail", { code: -32603, message: "Tool failed" });
			expect(await reader.read()).toMatchObject({
				method: "notifications/tasks/status",
				params: {
					_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
					taskId: "task-fail",
					status: "failed",
					error: { code: -32603, message: "Tool failed" },
				},
			});

			store.create();
			await reader.read();
			store.cancel("task-cancel", { statusMessage: "Cancelled by client" });
			expect(await reader.read()).toMatchObject({
				method: "notifications/tasks/status",
				params: {
					_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
					taskId: "task-cancel",
					status: "cancelled",
					error: { code: -32800, message: "Cancelled by client" },
				},
			});
			expect(() => store.complete("task-cancel", { late: true })).toThrow(
				'Cannot transition MCP task "task-cancel" from terminal state "cancelled"',
			);
			await expectNoQueuedMessage(reader);

			sendNotification(input, "notifications/cancelled", { requestId: 2 });
			await new Promise<void>((resolve) => { setImmediate(resolve); });
			store.create({ statusMessage: "After subscription cancellation" });
			await expectNoQueuedMessage(reader);

			server.stop();
		});

		it("rejects task status subscriptions without the official Tasks extension capability", async () => {
			const store = new McpTaskStore({
				now: manualClock().now,
				generateTaskId: taskIdGenerator(["task-unsubscribed"]),
				defaultTtlMs: 60_000,
			});
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const server = new McpServer({ input, output, log: () => {}, taskStore: store });
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "subscriptions/listen", draftRequestParams({
				notifications: { taskStatus: true },
			}));
			const rejected = await reader.read();
			expect(rejected.error).toMatchObject({
				code: -32602,
				message: `MCP Tasks extension not negotiated: declare ${JSON.stringify(MCP_TASKS_EXTENSION_ID)} in client capabilities extensions`,
			});
			store.create();
			await expectNoQueuedMessage(reader);

			server.stop();
		});
	});

	describe("tools/list", () => {
		it("returns tools after initialization", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/list");
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as { tools: unknown[]; ttlMs?: number; cacheScope?: string };
			expect(Array.isArray(result.tools)).toBe(true);
			expect(result.tools.length).toBeGreaterThan(0);
			expect(result.ttlMs).toBe(60_000);
			expect(result.cacheScope).toBe("public");

			// Verify MCP tool format
			const firstTool = result.tools[0] as Record<string, unknown>;
			expect(firstTool).toHaveProperty("name");
			expect(firstTool).toHaveProperty("inputSchema");
			// MCP uses inputSchema, not input_schema
			expect(firstTool).not.toHaveProperty("input_schema");

			server.stop();
		});

		it("returns tools for a draft request with per-request metadata before initialization", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "tools/list", draftRequestParams());
			const resp = await readResponse(output);

			expect(resp.error).toBeUndefined();
			const result = resp.result as { tools: unknown[] };
			expect(Array.isArray(result.tools)).toBe(true);
			expect(result.tools.length).toBeGreaterThan(0);

			server.stop();
		});

		it("adds MCP Apps tool metadata only for app-capable clients and keeps text fallback", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "tools/list", draftRequestParams());
			const plainResp = await readResponse(output);
			const plainResult = plainResp.result as { tools: Array<Record<string, unknown>> };
			const plainTool = plainResult.tools.find((candidate) => candidate.name === "agent_status");
			expect(plainTool?._meta).toBeUndefined();

			sendRequest(input, 2, "tools/list", draftRequestParams({}, mcpUiClientCapabilities()));
			const appResp = await readResponse(output);
			const appResult = appResp.result as { tools: Array<Record<string, unknown>> };
			const appTool = appResult.tools.find((candidate) => candidate.name === "agent_status");
			expect(appTool?._meta).toEqual({
				ui: {
					resourceUri: KOTA_STATUS_UI_RESOURCE_URI,
				},
			});

			sendRequest(input, 3, "tools/call", draftRequestParams({
				name: "agent_status",
				arguments: { query: "tools", filter: "agent_status" },
			}, mcpUiClientCapabilities()));
			const callResp = await readResponse(output);
			const callResult = callResp.result as {
				resultType: string;
				content: Array<{ type: string; text: string }>;
				isError: boolean;
			};
			expect(callResult.resultType).toBe("complete");
			expect(callResult.isError).toBe(false);
			expect(callResult.content[0]?.text).toContain("agent_status");

			server.stop();
		});

		it("advertises optional task support only for deprecated draft task compatibility", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_task_list_support",
							description: "Task support list test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "ok" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tools/list", draftRequestParams());
			const resp = await readResponse(output);

			const result = resp.result as { tools: Array<Record<string, unknown>> };
			const tool = result.tools.find((candidate) => candidate.name === "ext_task_list_support");
			expect(tool?.execution).toBeUndefined();

			sendRequest(input, 3, "tools/list", draftRequestParams(
				{},
				legacyDraftTasksClientCapabilities(),
			));
			const legacyResp = await readResponse(output);
			const legacyResult = legacyResp.result as { tools: Array<Record<string, unknown>> };
			const legacyTool = legacyResult.tools.find((candidate) => candidate.name === "ext_task_list_support");
			expect(legacyTool?.execution).toEqual({ taskSupport: "optional" });

			server.stop();
		});

		it("rejects tools/list before initialization when draft metadata is missing", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "tools/list");
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Missing required MCP draft _meta");
			expect(err.message).toContain(MCP_DRAFT_PROTOCOL_VERSION);

			server.stop();
		});

		it("rejects tools/list after draft initialization when per-request metadata is missing", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tools/list");
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Missing required MCP draft _meta");
			expect(err.message).toContain(MCP_DRAFT_PROTOCOL_VERSION);

			server.stop();
		});

		it("rejects draft requests with unsupported protocol metadata", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "tools/list", {
				_meta: {
					[MCP_META_PROTOCOL_VERSION_KEY]: "1900-01-01",
					[MCP_META_CLIENT_INFO_KEY]: { name: "test", version: "1.0.0" },
					[MCP_META_CLIENT_CAPABILITIES_KEY]: {},
				},
			});
			const resp = await readResponse(output);

			const err = resp.error as {
				code: number;
				message: string;
				data: Record<string, unknown>;
			};
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Unsupported protocol version");
			expect(err.message).toContain(MCP_DRAFT_PROTOCOL_VERSION);
			expect(err.data.supportedVersions).toEqual([MCP_DRAFT_PROTOCOL_VERSION]);

			server.stop();
		});

		it("rejects draft requests with malformed client capabilities metadata", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "tools/list", {
				_meta: {
					[MCP_META_PROTOCOL_VERSION_KEY]: MCP_DRAFT_PROTOCOL_VERSION,
					[MCP_META_CLIENT_INFO_KEY]: { name: "test", version: "1.0.0" },
					[MCP_META_CLIENT_CAPABILITIES_KEY]: "not an object",
				},
			});
			const resp = await readResponse(output);

			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain(MCP_META_CLIENT_CAPABILITIES_KEY);

			server.stop();
		});

		it("rejects draft requests with malformed MCP Apps extension metadata", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "tools/list", draftRequestParams({}, {
				extensions: {
					[MCP_UI_EXTENSION_ID]: "not an object",
				},
			}));
			const resp = await readResponse(output);

			expect(resp.error).toMatchObject({
				code: -32602,
				message: `Malformed MCP client extension capability: ${MCP_UI_EXTENSION_ID}`,
			});

			server.stop();
		});

		it("does not silently fall back to legacy when a request carries malformed draft metadata", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/list", { _meta: "not an object" });
			const resp = await readResponse(output);

			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Missing required MCP draft _meta");

			server.stop();
		});

		it("respects tool filter", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				toolFilter: ["file_read", "grep"],
				log: () => {},
			});
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/list");
			const resp = await readResponse(output);

			const result = resp.result as { tools: Array<{ name: string }> };
			expect(result.tools).toHaveLength(2);
			const names = result.tools.map((t) => t.name);
			expect(names).toContain("file_read");
			expect(names).toContain("grep");
			expect(names).not.toContain("shell");

			server.stop();
		});

		it("includes module tools passed via moduleTools option", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_hello",
							description: "Module hello tool",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "hello from module" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/list");
			const resp = await readResponse(output);

			const result = resp.result as { tools: Array<{ name: string }> };
			const names = result.tools.map((t) => t.name);
			expect(names).toContain("ext_hello");

			server.stop();
		});

		it("exposes outputSchema for module tools that declare output_schema", async () => {
			const outputSchema = {
				type: "object" as const,
				properties: {
					ok: { type: "boolean" },
					count: { type: "number" },
				},
				required: ["ok", "count"],
				additionalProperties: false,
			};
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_structured_contract",
							description: "Structured contract tool",
							input_schema: { type: "object" as const, properties: {}, required: [] },
							output_schema: outputSchema,
						},
						runner: async () => ({ content: "structured", structuredContent: { ok: true, count: 1 } }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/list");
			const resp = await readResponse(output);

			const result = resp.result as { tools: Array<Record<string, unknown>> };
			const tool = result.tools.find((t) => t.name === "ext_structured_contract");
			expect(tool).toBeDefined();
			expect(tool?.outputSchema).toEqual(outputSchema);
			expect(tool).not.toHaveProperty("output_schema");

			server.stop();
		});

		it("applies toolFilter to module tools", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				toolFilter: ["ext_hello"],
				moduleTools: [
					{
						tool: {
							name: "ext_hello",
							description: "Allowed module tool",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "hi" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
					{
						tool: {
							name: "ext_secret",
							description: "Filtered module tool",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "secret" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/list");
			const resp = await readResponse(output);

			const result = resp.result as { tools: Array<{ name: string }> };
			const names = result.tools.map((t) => t.name);
			expect(names).toContain("ext_hello");
			expect(names).not.toContain("ext_secret");
			expect(names).not.toContain("file_read"); // built-in filtered out too

			server.stop();
		});
	});

	describe("tools/list annotations", () => {
		it("includes readOnlyHint: true for read-tier tools", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/list");
			const resp = await readResponse(output);

			const result = resp.result as { tools: Array<{ name: string; annotations?: Record<string, unknown> }> };
			const fileRead = result.tools.find((t) => t.name === "file_read");
			expect(fileRead).toBeDefined();
			expect(fileRead?.annotations).toBeDefined();
			expect(fileRead?.annotations?.readOnlyHint).toBe(true);

			server.stop();
		});

		it("includes destructiveHint: true for destructive-tier tools", async () => {
			const annotations = getToolMcpAnnotations("github_merge_pr");
			expect(annotations).toBeDefined();
			expect(annotations?.destructiveHint).toBe(true);
			expect(annotations?.readOnlyHint).toBe(false);
			expect(annotations?.openWorldHint).toBe(true);
		});

		it("includes openWorldHint: true for network tools", async () => {
			const httpAnnotations = getToolMcpAnnotations("http_request");
			expect(httpAnnotations).toBeDefined();
			expect(httpAnnotations?.openWorldHint).toBe(true);

			const githubAnnotations = getToolMcpAnnotations("github_list_prs");
			expect(githubAnnotations?.openWorldHint).toBe(true);
			expect(githubAnnotations?.readOnlyHint).toBe(true);
		});

		it("returns undefined for unknown tools", () => {
			const annotations = getToolMcpAnnotations("completely_unknown_tool_xyz");
			expect(annotations).toBeUndefined();
		});

		it("returns write-tier annotations for shell tool", () => {
			const annotations = getToolMcpAnnotations("shell");
			expect(annotations).toBeDefined();
			expect(annotations?.readOnlyHint).toBe(false);
			expect(annotations?.destructiveHint).toBe(false);
		});
	});

	describe("request-scoped logging", () => {
		it("rejects unrecognized draft initialize log levels as invalid params", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "initialize", draftRequestParamsWithLogLevel({
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			}, "verbose"));
			const resp = await readResponse(output);

			expect(resp.error).toMatchObject({
				code: -32602,
			});
			expect((resp.error as { message: string }).message).toContain(MCP_META_LOG_LEVEL_KEY);

			server.stop();
		});

		it("rejects unrecognized draft log levels as invalid params", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "tools/list", draftRequestParamsWithLogLevel({}, "verbose"));
			const resp = await readResponse(output);

			expect(resp.error).toMatchObject({
				code: -32602,
			});
			expect((resp.error as { message: string }).message).toContain(MCP_META_LOG_LEVEL_KEY);

			server.stop();
		});

		it("emits requested initialize log messages before the final stdio response", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const localLogs: string[] = [];
			const server = new McpServer({
				input,
				output,
				log: (message) => localLogs.push(message),
			});
			await server.start();

			sendRequest(input, 1, "initialize", draftRequestParamsWithLogLevel({
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			}, "info"));
			const notification = await reader.read();
			const response = await reader.read();

			expect(notification).toMatchObject({
				jsonrpc: "2.0",
				method: "notifications/message",
				params: {
					level: "info",
					data: { message: expect.stringContaining("Initialized successfully") },
				},
			});
			expect(response.id).toBe(1);
			expect(response.result).toMatchObject({
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
			});
			expect(localLogs.some((entry) => entry.includes("Initialized successfully"))).toBe(true);

			server.stop();
		});

		it("emits no protocol log notifications when draft requests omit logLevel", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const localLogs: string[] = [];
			const server = new McpServer({
				input,
				output,
				log: (message) => localLogs.push(message),
				moduleTools: [
					{
						tool: {
							name: "ext_log_default",
							description: "Default logging test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "done" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: mcpTasksElicitationClientCapabilities(),
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_log_default",
				arguments: {},
			}));
			const response = await reader.read();

			expect(response.id).toBe(2);
			expect(response.result).toBeDefined();
			expect(localLogs).toContain("Calling tool: ext_log_default");
			await expectNoQueuedMessage(reader);

			server.stop();
		});

		it("emits requested log messages before the final stdio response", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const localLogs: string[] = [];
			const server = new McpServer({
				input,
				output,
				log: (message) => localLogs.push(message),
				moduleTools: [
					{
						tool: {
							name: "ext_log_info",
							description: "Requested logging test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "logged" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: mcpTasksClientCapabilities(),
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "tools/call", draftRequestParamsWithLogLevel({
				name: "ext_log_info",
				arguments: {},
			}, "info"));
			const notification = await reader.read();
			const response = await reader.read();

			expect(notification).toMatchObject({
				jsonrpc: "2.0",
				method: "notifications/message",
				params: {
					level: "info",
					data: { message: "Calling tool: ext_log_info" },
				},
			});
			expect(response.id).toBe(2);
			expect(response.result).toBeDefined();
			expect(localLogs).toContain("Calling tool: ext_log_info");

			server.stop();
		});

		it("filters by requested severity and sanitizes log notification data", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_log_error",
							description: "Error logging test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({
							content: "Authorization: Bearer secret-token at /Users/xmanatee/Desktop/mono/apps/kota/secret.ts",
							is_error: true,
						}),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: mcpTasksClientCapabilities(),
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "tools/call", draftRequestParamsWithLogLevel({
				name: "ext_log_error",
				arguments: {},
			}, "warning"));
			const notification = await reader.read();
			const response = await reader.read();

			expect(notification).toMatchObject({
				method: "notifications/message",
				params: {
					level: "error",
					logger: "tools",
				},
			});
			const params = notification.params as { data: unknown };
			const serializedData = JSON.stringify(params.data);
			expect(serializedData).toContain("Tool execution failed");
			expect(serializedData).not.toContain("Bearer secret-token");
			expect(serializedData).not.toContain("/Users/xmanatee/Desktop/mono/apps/kota");
			expect(response.id).toBe(2);
			expect(response.result).toBeDefined();

			server.stop();
		});
	});

	describe("tools/call", () => {
		it("executes a tool and returns result", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			// Use glob tool on a nonexistent pattern — should return a result (possibly empty)
			sendRequest(input, 2, "tools/call", {
				name: "glob",
				arguments: { pattern: "__nonexistent_test_pattern_xyz__" },
			});
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as { content: Array<{ type: string; text: string }> };
			expect(Array.isArray(result.content)).toBe(true);
			expect(result.content[0].type).toBe("text");

			server.stop();
		});

		it("keeps legacy tools/call results untagged for 2024-11-05 clients", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_legacy_shape",
							description: "Legacy shape test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "legacy" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/call", {
				name: "ext_legacy_shape",
				arguments: {},
			});
			const resp = await readResponse(output);

			const result = resp.result as Record<string, unknown>;
			expect(result.resultType).toBeUndefined();
			expect((result.content as Array<{ text: string }>)[0].text).toBe("legacy");

			server.stop();
		});

		it("emits progress notifications for draft tools/call when progressToken is requested", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_progress",
							description: "Progress test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "progress result" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "tools/call", draftRequestParamsWithProgress({
				name: "ext_progress",
				arguments: {},
			}, "server-progress"));
			const started = await reader.read();
			const completed = await reader.read();
			const response = await reader.read();

			expect(started).toMatchObject({
				method: "notifications/progress",
				params: {
					progressToken: "server-progress",
					progress: 0,
					total: 1,
					message: "Calling tool: ext_progress",
				},
			});
			expect(completed).toMatchObject({
				method: "notifications/progress",
				params: {
					progressToken: "server-progress",
					progress: 1,
					total: 1,
					message: "Tool call complete",
				},
			});
			expect(response.id).toBe(2);
			expect(response.result).toBeDefined();

			server.stop();
		});

		it("does not emit tools/call progress when the request has no progressToken", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_no_progress",
							description: "No progress test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "done" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_no_progress",
				arguments: {},
			}));
			const response = await reader.read();

			expect(response.id).toBe(2);
			expect(response.result).toBeDefined();
			await expectNoQueuedMessage(reader);

			server.stop();
		});

		it("runs extension-negotiated tools/call asynchronously and returns the final result through tasks/get", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const clock = manualClock();
			const store = new McpTaskStore({
				now: clock.now,
				generateTaskId: taskIdGenerator(["task-tool-ok"]),
				defaultTtlMs: 60_000,
				pollIntervalMs: 2_000,
			});
			let markStarted!: () => void;
			const started = new Promise<void>((resolve) => { markStarted = resolve; });
			let releaseTool!: () => void;
			const toolGate = new Promise<void>((resolve) => { releaseTool = resolve; });
			const server = new McpServer({
				input,
				output,
				log: () => {},
				taskStore: store,
				moduleTools: [
					{
						tool: {
							name: "ext_task_success",
							description: "Task success test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => {
							markStarted();
							await toolGate;
							return { content: "task result" };
						},
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: mcpTasksClientCapabilities(),
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, "task-status-sub", "subscriptions/listen", draftRequestParams({
				notifications: { taskStatus: true },
			}, mcpTasksClientCapabilities()));
			expect(await reader.read()).toMatchObject({
				method: "notifications/subscriptions/acknowledged",
				params: {
					_meta: { "io.modelcontextprotocol/subscriptionId": "task-status-sub" },
					notifications: { taskStatus: true },
				},
			});

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_task_success",
				arguments: {},
			}, mcpTasksClientCapabilities()));
			const created = await reader.read();
			expect(created.id).toBe(2);
			expect(created.result).toMatchObject({
				resultType: "task",
				taskId: "task-tool-ok",
				status: "working",
				statusMessage: "The operation is now in progress.",
				createdAt: clock.iso(),
				lastUpdatedAt: clock.iso(),
				ttlMs: 60_000,
				pollIntervalMs: 2_000,
				_meta: { [MCP_RELATED_TASK_META_KEY]: { taskId: "task-tool-ok" } },
			});
			const createdNotification = await reader.read();
			expect(createdNotification).toMatchObject({
				method: "notifications/tasks/status",
				params: {
					_meta: { "io.modelcontextprotocol/subscriptionId": "task-status-sub" },
					taskId: "task-tool-ok",
					status: "working",
					statusMessage: "The operation is now in progress.",
				},
			});
			const createdNotificationTask = { ...(createdNotification.params as Record<string, unknown>) };
			delete createdNotificationTask._meta;
			await started;

			sendRequest(input, 3, "tasks/get", draftRequestParams(
				{ taskId: "task-tool-ok" },
				mcpTasksClientCapabilities(),
			));
			const working = await reader.read();
			expect(working.result).toMatchObject({ taskId: "task-tool-ok", status: "working" });
			expect(working.result).toEqual(createdNotificationTask);

			releaseTool();
			await new Promise<void>((resolve) => { setImmediate(resolve); });
			const completedNotification = await reader.read();
			expect(completedNotification).toMatchObject({
				method: "notifications/tasks/status",
				params: {
					_meta: { "io.modelcontextprotocol/subscriptionId": "task-status-sub" },
					taskId: "task-tool-ok",
					status: "completed",
					result: {
						resultType: "complete",
						content: [{ type: "text", text: "task result" }],
						isError: false,
					},
				},
			});
			sendRequest(input, 4, "tasks/get", draftRequestParams(
				{ taskId: "task-tool-ok" },
				mcpTasksClientCapabilities(),
			));
			const result = await reader.read();

			expect(result.id).toBe(4);
			expect(result.result).toMatchObject({
				taskId: "task-tool-ok",
				status: "completed",
				result: {
					resultType: "complete",
					content: [{ type: "text", text: "task result" }],
					isError: false,
				},
			});
			const completedNotificationTask = { ...(completedNotification.params as Record<string, unknown>) };
			delete completedNotificationTask._meta;
			expect(result.result).toEqual(completedNotificationTask);

			server.stop();
		});

		it("keeps non-Tasks-extension tools/call synchronous", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_no_task_extension",
							description: "No task extension test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "sync result" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_no_task_extension",
				arguments: {},
			}));
			const response = await readResponse(output);
			const result = response.result as Record<string, unknown>;

			expect(result.resultType).toBe("complete");
			expect(result.taskId).toBeUndefined();
			expect((result.content as Array<{ text: string }>)[0].text).toBe("sync result");

			server.stop();
		});

		it("rejects requestor-supplied draft task augmentation without the legacy compatibility capability", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_task_param_rejected",
							description: "Task param rejection test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "unused" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_task_param_rejected",
				arguments: {},
				task: {},
			}));
			const response = await readResponse(output);

			expect(response.error).toMatchObject({
				code: -32602,
				message: "params.task is a deprecated MCP draft tasks utility and requires the top-level client tasks compatibility capability",
			});

			server.stop();
		});

		async function startConfirmTaskServer(store: McpTaskStore) {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const server = new McpServer({
				input,
				output,
				log: () => {},
				taskStore: store,
				toolFilter: ["confirm"],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");
			return { input, reader, server };
		}

		async function createConfirmTaskInputRequest(args: {
			input: PassThrough;
			reader: ReturnType<typeof createQueuedReader>;
			taskId: string;
			action?: string;
		}) {
			const action = args.action ?? "Rotate signing key";
			sendRequest(args.input, `create-${args.taskId}`, "tools/call", draftRequestParams({
				name: "confirm",
				arguments: { action, risk: "high" },
			}, mcpTasksElicitationClientCapabilities()));
			const created = await args.reader.read();
			expect(created.result).toMatchObject({
				resultType: "task",
				taskId: args.taskId,
				status: "working",
				_meta: { [MCP_RELATED_TASK_META_KEY]: { taskId: args.taskId } },
			});
			await new Promise<void>((resolve) => { setImmediate(resolve); });

			sendRequest(
				args.input,
				`input-${args.taskId}`,
				"tasks/get",
				draftRequestParams({ taskId: args.taskId }, mcpTasksElicitationClientCapabilities()),
			);
			const inputRequiredResponse = await args.reader.read();
			expect(inputRequiredResponse.result).toMatchObject({
				taskId: args.taskId,
				status: "input_required",
				inputRequests: { confirm: { method: "elicitation/create" } },
			});
			const inputRequired = inputRequiredResponse.result as {
				requestState: string;
				inputRequests: Record<string, unknown>;
			};
			expect(inputRequired.requestState).toEqual(expect.any(String));
			return inputRequired;
		}

		it("resumes task-owned input_required tool calls through tasks/update", async () => {
			const store = new McpTaskStore({
				now: manualClock().now,
				generateTaskId: taskIdGenerator(["task-tool-input"]),
				defaultTtlMs: 60_000,
			});
			const { input, reader, server } = await startConfirmTaskServer(store);
			const inputRequired = await createConfirmTaskInputRequest({
				input,
				reader,
				taskId: "task-tool-input",
			});

			sendRequest(input, "respond-task-tool-input", "tasks/update", draftRequestParams({
				taskId: "task-tool-input",
				inputResponses: {
					confirm: { action: "accept", content: { confirmed: true } },
				},
				requestState: inputRequired.requestState,
			}, mcpTasksElicitationClientCapabilities()));
			const accepted = await reader.read();
			expect(accepted.result).toEqual({});

			await new Promise<void>((resolve) => { setImmediate(resolve); });
			sendRequest(input, "final-task-tool-input", "tasks/get", draftRequestParams({
				taskId: "task-tool-input",
			}, mcpTasksElicitationClientCapabilities()));
			const final = await reader.read();
			expect(final.result).toMatchObject({
				taskId: "task-tool-input",
				status: "completed",
				result: {
					resultType: "complete",
					isError: false,
					content: [{ type: "text", text: expect.stringContaining("APPROVED: Rotate signing key") }],
				},
			});
			sendRequest(input, "get-task-tool-input", "tasks/get", draftRequestParams({
				taskId: "task-tool-input",
			}, mcpTasksClientCapabilities()));
			const status = await reader.read();
			expect(status.result).toMatchObject({ taskId: "task-tool-input", status: "completed" });

			server.stop();
		});

		it("acknowledges unknown and already-satisfied task update inputs", async () => {
			const store = new McpTaskStore({
				now: manualClock().now,
				generateTaskId: taskIdGenerator(["task-tool-unknown-update", "task-tool-satisfied"]),
				defaultTtlMs: 60_000,
			});
			const { input, reader, server } = await startConfirmTaskServer(store);
			await createConfirmTaskInputRequest({
				input,
				reader,
				taskId: "task-tool-unknown-update",
			});

			sendRequest(input, "unknown-update", "tasks/update", draftRequestParams({
				taskId: "task-tool-unknown-update",
				inputResponses: { other: { action: "accept" } },
			}, mcpTasksElicitationClientCapabilities()));
			expect(await reader.read()).toMatchObject({ result: {} });
			sendRequest(input, "still-input", "tasks/get", draftRequestParams(
				{ taskId: "task-tool-unknown-update" },
				mcpTasksClientCapabilities(),
			));
			expect(await reader.read()).toMatchObject({
				result: { taskId: "task-tool-unknown-update", status: "input_required" },
			});

			const satisfied = await createConfirmTaskInputRequest({
				input,
				reader,
				taskId: "task-tool-satisfied",
			});
			sendRequest(input, "satisfy-update", "tasks/update", draftRequestParams({
				taskId: "task-tool-satisfied",
				inputResponses: { confirm: { action: "accept", content: { confirmed: true } } },
				requestState: satisfied.requestState,
			}, mcpTasksElicitationClientCapabilities()));
			expect(await reader.read()).toMatchObject({ result: {} });
			await new Promise<void>((resolve) => { setImmediate(resolve); });
			sendRequest(input, "already-satisfied-update", "tasks/update", draftRequestParams({
				taskId: "task-tool-satisfied",
				inputResponses: { confirm: { action: "accept", content: { confirmed: true } } },
				requestState: satisfied.requestState,
			}, mcpTasksElicitationClientCapabilities()));
			expect(await reader.read()).toMatchObject({ result: {} });

			server.stop();
		});

		it("resumes task-owned decline and cancel input responses", async () => {
			for (const [action, expectedText] of [
				["decline", "REJECTED: Publish incident update"],
				["cancel", "REJECTED: Publish incident update\nReason: Timed out or cancelled"],
			] as const) {
				const taskId = `task-tool-${action}`;
				const store = new McpTaskStore({
					now: manualClock().now,
					generateTaskId: taskIdGenerator([taskId]),
					defaultTtlMs: 60_000,
				});
				const { input, reader, server } = await startConfirmTaskServer(store);
				const inputRequired = await createConfirmTaskInputRequest({
					input,
					reader,
					taskId,
					action: "Publish incident update",
				});

				sendRequest(input, `respond-${taskId}`, "tasks/update", draftRequestParams({
					taskId,
					inputResponses: { confirm: { action } },
					...(action === "decline" ? { requestState: inputRequired.requestState } : {}),
				}, mcpTasksElicitationClientCapabilities()));
				expect(await reader.read()).toMatchObject({ result: {} });

				await new Promise<void>((resolve) => { setImmediate(resolve); });
				sendRequest(input, `final-${taskId}`, "tasks/get", draftRequestParams(
					{ taskId },
					mcpTasksClientCapabilities(),
				));
				const final = await reader.read();
				expect(final.result).toMatchObject({
					status: "completed",
					result: {
						resultType: "complete",
						content: [{ type: "text", text: expect.stringContaining(expectedText) }],
					},
				});

				server.stop();
			}
		});

		it("rejects malformed, stale, wrong-task, and expired task updates", async () => {
			{
				const store = new McpTaskStore({
					now: manualClock().now,
					generateTaskId: taskIdGenerator(["task-tool-malformed"]),
					defaultTtlMs: 60_000,
				});
				const { input, reader, server } = await startConfirmTaskServer(store);
				await createConfirmTaskInputRequest({ input, reader, taskId: "task-tool-malformed" });

				sendRequest(input, "malformed-input", "tasks/update", draftRequestParams({
					taskId: "task-tool-malformed",
					inputResponses: "not-an-object",
				}, mcpTasksElicitationClientCapabilities()));
				const malformed = await reader.read();
				expect(malformed.error).toMatchObject({
					code: -32602,
					message: "inputResponses must be an object",
				});
				server.stop();
			}

			{
				const store = new McpTaskStore({
					now: manualClock().now,
					generateTaskId: taskIdGenerator(["task-tool-first", "task-tool-second"]),
					defaultTtlMs: 60_000,
				});
				const { input, reader, server } = await startConfirmTaskServer(store);
				const first = await createConfirmTaskInputRequest({
					input,
					reader,
					taskId: "task-tool-first",
					action: "First action",
				});
				const second = await createConfirmTaskInputRequest({
					input,
					reader,
					taskId: "task-tool-second",
					action: "Second action",
				});

				sendRequest(input, "stale-input", "tasks/update", draftRequestParams({
					taskId: "task-tool-first",
					inputResponses: { confirm: { action: "accept", content: { confirmed: true } } },
					requestState: "stale-state",
				}, mcpTasksElicitationClientCapabilities()));
				const stale = await reader.read();
				expect(stale.error).toMatchObject({
					code: -32602,
					message: "Stale requestState for task input",
				});

				sendRequest(input, "wrong-task-input", "tasks/update", draftRequestParams({
					taskId: "task-tool-second",
					inputResponses: { confirm: { action: "accept", content: { confirmed: true } } },
					requestState: first.requestState,
				}, mcpTasksElicitationClientCapabilities()));
				const wrongTask = await reader.read();
				expect(wrongTask.error).toMatchObject({
					code: -32602,
					message: "Stale requestState for task input",
				});
				expect(second.requestState).not.toBe(first.requestState);
				server.stop();
			}

			{
				const clock = manualClock();
				const store = new McpTaskStore({
					now: clock.now,
					generateTaskId: taskIdGenerator(["task-tool-expiring"]),
					defaultTtlMs: 10,
				});
				const { input, reader, server } = await startConfirmTaskServer(store);
				const inputRequired = await createConfirmTaskInputRequest({
					input,
					reader,
					taskId: "task-tool-expiring",
				});
				clock.advance(11);

				sendRequest(input, "expired-input", "tasks/update", draftRequestParams({
					taskId: "task-tool-expiring",
					inputResponses: { confirm: { action: "accept", content: { confirmed: true } } },
					requestState: inputRequired.requestState,
				}, mcpTasksElicitationClientCapabilities()));
				const expired = await reader.read();
				expect(expired.error).toMatchObject({
					code: -32602,
					message: "Failed to update task: Task has expired",
				});
				server.stop();
			}
		});

		it("keeps cancelled input-required task-owned tool calls terminal", async () => {
			const store = new McpTaskStore({
				now: manualClock().now,
				generateTaskId: taskIdGenerator(["task-tool-input-cancel"]),
				defaultTtlMs: 60_000,
			});
			const { input, reader, server } = await startConfirmTaskServer(store);
			const inputRequired = await createConfirmTaskInputRequest({
				input,
				reader,
				taskId: "task-tool-input-cancel",
			});

			sendRequest(input, "cancel-input-task", "tasks/cancel", draftRequestParams({
				taskId: "task-tool-input-cancel",
			}, mcpTasksClientCapabilities()));
			const cancelled = await reader.read();
			expect(cancelled.result).toEqual({});

			sendRequest(input, "late-input-response", "tasks/update", draftRequestParams({
				taskId: "task-tool-input-cancel",
				inputResponses: { confirm: { action: "accept", content: { confirmed: true } } },
				requestState: inputRequired.requestState,
			}, mcpTasksElicitationClientCapabilities()));
			const lateInput = await reader.read();
			expect(lateInput.result).toEqual({});

			sendRequest(input, "final-input-cancel", "tasks/get", draftRequestParams({
				taskId: "task-tool-input-cancel",
			}, mcpTasksClientCapabilities()));
			const final = await reader.read();
			expect(final.result).toMatchObject({
				taskId: "task-tool-input-cancel",
				status: "cancelled",
				error: { code: -32800, message: "The task was cancelled by request." },
			});

			server.stop();
		});

		it("keeps cancelled task-owned tool calls terminal when the runner finishes late", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const store = new McpTaskStore({
				now: manualClock().now,
				generateTaskId: taskIdGenerator(["task-tool-cancel"]),
				defaultTtlMs: 60_000,
			});
			let markStarted!: () => void;
			const started = new Promise<void>((resolve) => { markStarted = resolve; });
			let releaseTool!: () => void;
			const toolGate = new Promise<void>((resolve) => { releaseTool = resolve; });
			const server = new McpServer({
				input,
				output,
				log: () => {},
				taskStore: store,
				moduleTools: [
					{
						tool: {
							name: "ext_task_cancel",
							description: "Task cancel test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => {
							markStarted();
							await toolGate;
							return { content: "late result" };
						},
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_task_cancel",
				arguments: {},
			}, mcpTasksClientCapabilities()));
			await reader.read();
			await started;

			sendRequest(input, 4, "tasks/cancel", draftRequestParams(
				{ taskId: "task-tool-cancel" },
				mcpTasksClientCapabilities(),
			));
			const cancelResponse = await reader.read();
			expect(cancelResponse).toMatchObject({
				id: 4,
				result: {},
			});

			releaseTool();
			await new Promise<void>((resolve) => { setImmediate(resolve); });
			sendRequest(input, 5, "tasks/get", draftRequestParams(
				{ taskId: "task-tool-cancel" },
				mcpTasksClientCapabilities(),
			));
			const afterLateCompletion = await reader.read();
			expect(afterLateCompletion.result).toMatchObject({
				taskId: "task-tool-cancel",
				status: "cancelled",
				error: { code: -32800 },
			});

			server.stop();
		});

		it("stores task failures for tool exceptions, isError results, output-schema errors, and handler errors", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			const store = new McpTaskStore({
				now: manualClock().now,
				generateTaskId: taskIdGenerator([
					"task-tool-throw",
					"task-tool-is-error",
					"task-tool-schema",
					"task-tool-unknown",
				]),
				defaultTtlMs: 60_000,
			});
			const server = new McpServer({
				input,
				output,
				log: () => {},
				taskStore: store,
				moduleTools: [
					{
						tool: {
							name: "ext_task_throw",
							description: "Task throw test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => { throw new Error("throw task boom"); },
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
					{
						tool: {
							name: "ext_task_is_error",
							description: "Task isError test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "tool reported failure", is_error: true }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
					{
						tool: {
							name: "ext_task_bad_schema",
							description: "Task schema test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
							output_schema: {
								type: "object" as const,
								properties: { ok: { type: "boolean" } },
								required: ["ok"],
							},
						},
						runner: async () => ({
							content: "bad schema",
							structuredContent: { ok: "no" },
						}),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			async function createTaskAndReadResult(name: string, taskId: string) {
				sendRequest(input, `create-${taskId}`, "tools/call", draftRequestParams({
					name,
					arguments: {},
				}, mcpTasksClientCapabilities()));
				const created = await reader.read();
				expect(created.result).toMatchObject({ resultType: "task", taskId, status: "working" });
				await new Promise<void>((resolve) => { setImmediate(resolve); });
				sendRequest(input, `result-${taskId}`, "tasks/get", draftRequestParams(
					{ taskId },
					mcpTasksClientCapabilities(),
				));
				return reader.read();
			}

			async function expectFailedStatus(taskId: string): Promise<void> {
				sendRequest(input, `get-${taskId}`, "tasks/get", draftRequestParams(
					{ taskId },
					mcpTasksClientCapabilities(),
				));
				const status = await reader.read();
				expect(status.result).toMatchObject({ taskId, status: "failed" });
			}

			const thrown = await createTaskAndReadResult("ext_task_throw", "task-tool-throw");
			expect(thrown.result).toMatchObject({
				status: "failed",
				result: {
					resultType: "complete",
					isError: true,
					content: [{ type: "text", text: expect.stringContaining("throw task boom") }],
				},
			});
			await expectFailedStatus("task-tool-throw");

			const isError = await createTaskAndReadResult("ext_task_is_error", "task-tool-is-error");
			expect(isError.result).toMatchObject({
				status: "failed",
				result: {
					resultType: "complete",
					isError: true,
					content: [{ type: "text", text: "tool reported failure" }],
				},
			});
			await expectFailedStatus("task-tool-is-error");

			const schema = await createTaskAndReadResult("ext_task_bad_schema", "task-tool-schema");
			expect(schema.result).toMatchObject({
				status: "failed",
				error: {
					code: -32603,
					message: expect.stringContaining("structuredContent does not match output_schema"),
				},
			});
			await expectFailedStatus("task-tool-schema");

			const unknown = await createTaskAndReadResult("ext_task_missing", "task-tool-unknown");
			expect(unknown.result).toMatchObject({
				status: "failed",
				error: {
					code: -32602,
					message: "Unknown tool: ext_task_missing",
				},
			});
			await expectFailedStatus("task-tool-unknown");

			server.stop();
		});

		it("clears server progress state on cancellation before a delayed tools/call finishes", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			let releaseTool!: () => void;
			const toolGate = new Promise<void>((resolve) => { releaseTool = resolve; });
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_cancel_progress",
							description: "Cancel progress test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => {
							await toolGate;
							return { content: "cancelled progress result" };
						},
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "tools/call", draftRequestParamsWithProgress({
				name: "ext_cancel_progress",
				arguments: {},
			}, "cancel-progress"));
			const started = await reader.read();
			expect(started.method).toBe("notifications/progress");

			sendNotification(input, "notifications/cancelled", { requestId: 2 });
			releaseTool();
			const response = await reader.read();

			expect(response.id).toBe(2);
			expect(response.result).toBeDefined();
			await expectNoQueuedMessage(reader);

			server.stop();
		});

		it("rejects malformed draft progressToken metadata", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_malformed_progress",
							description: "Malformed progress test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "should not run" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initDraftServer(server, input, output);
			const params = draftRequestParams({
				name: "ext_malformed_progress",
				arguments: {},
			});
			(params._meta as Record<string, unknown>).progressToken = 1.5;

			sendRequest(input, 2, "tools/call", params);
			const response = await readResponse(output);

			expect(response.error).toMatchObject({
				code: -32602,
				message: "Malformed MCP draft _meta field: progressToken",
			});

			server.stop();
		});

		it("keeps request protocol context isolated across overlapping draft and legacy calls", async () => {
			const { input, output } = createTestStreams();
			const reader = createQueuedReader(output);
			let markSlowStarted!: () => void;
			const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });
			let releaseSlow!: () => void;
			const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_slow_context",
							description: "Slow context test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => {
							markSlowStarted();
							await slowGate;
							return { content: "slow draft" };
						},
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
					{
						tool: {
							name: "ext_fast_context",
							description: "Fast context test",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "fast legacy" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});

			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			await reader.read();
			sendNotification(input, "notifications/initialized");

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_slow_context",
				arguments: {},
			}));
			await slowStarted;
			sendRequest(input, 3, "tools/call", {
				name: "ext_fast_context",
				arguments: {},
			});

			const legacyResp = await reader.read();
			expect(legacyResp.id).toBe(3);
			const legacyResult = legacyResp.result as Record<string, unknown>;
			expect(legacyResult.resultType).toBeUndefined();
			expect((legacyResult.content as Array<{ text: string }>)[0].text).toBe("fast legacy");

			releaseSlow();
			const draftResp = await reader.read();
			expect(draftResp.id).toBe(2);
			const draftResult = draftResp.result as {
				resultType: string;
				content: Array<{ text: string }>;
			};
			expect(draftResult.resultType).toBe("complete");
			expect(draftResult.content[0].text).toBe("slow draft");

			server.stop();
		});

		it("returns draft complete results without dropping structured metadata or rich content", async () => {
			const outputSchema = {
				type: "object" as const,
				properties: {
					ok: { type: "boolean" },
					count: { type: "number" },
				},
				required: ["ok", "count"],
				additionalProperties: false,
			};
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_rich_result",
							description: "Rich draft result",
							input_schema: { type: "object" as const, properties: {}, required: [] },
							output_schema: outputSchema,
						},
						runner: async () => ({
							content: "fallback",
							blocks: [
								{
									type: "text",
									text: "annotated text",
									annotations: { audience: ["assistant"], priority: 0.7 },
									_meta: { blockMeta: true },
								},
								{
									type: "mcp_content",
									content: {
										type: "resource_link",
										uri: "kota://tasks/ready",
										name: "ready tasks",
										description: "Ready queue",
										annotations: { audience: ["assistant"], priority: 0.4 },
										_meta: { linkMeta: "kept" },
									},
								},
							],
							structuredContent: { ok: true, count: 2 },
							_meta: { source: "test" },
						}),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_rich_result",
				arguments: {},
			}));
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as {
				resultType: string;
				content: Array<Record<string, unknown>>;
				structuredContent: Record<string, unknown>;
				_meta: Record<string, unknown>;
				isError: boolean;
			};
			expect(result.resultType).toBe("complete");
			expect(result.content[0]).toMatchObject({
				type: "text",
				text: "annotated text",
				annotations: { audience: ["assistant"], priority: 0.7 },
				_meta: { blockMeta: true },
			});
			expect(result.content[1]).toMatchObject({
				type: "resource_link",
				uri: "kota://tasks/ready",
				name: "ready tasks",
				description: "Ready queue",
				annotations: { audience: ["assistant"], priority: 0.4 },
				_meta: { linkMeta: "kept" },
			});
			expect(result.structuredContent).toEqual({ ok: true, count: 2 });
			expect(result._meta).toEqual({ source: "test" });
			expect(result.isError).toBe(false);

			server.stop();
		});

		it("fails loudly when structuredContent violates the declared output_schema", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_bad_structured_result",
							description: "Bad structured result",
							input_schema: { type: "object" as const, properties: {}, required: [] },
							output_schema: {
								type: "object" as const,
								properties: {
									ok: { type: "boolean" },
									count: { type: "number" },
								},
								required: ["ok", "count"],
								additionalProperties: false,
							},
						},
						runner: async () => ({
							content: "bad",
							structuredContent: { ok: true, count: "two" },
						}),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_bad_structured_result",
				arguments: {},
			}));
			const resp = await readResponse(output);

			expect(resp.result).toBeUndefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32603);
			expect(err.message).toContain("structuredContent does not match output_schema");
			expect(err.message).toContain("structuredContent.count: expected number, got string");

			server.stop();
		});

		it("fails loudly when a module tool declares output_schema but omits structuredContent", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_missing_structured_result",
							description: "Missing structured result",
							input_schema: { type: "object" as const, properties: {}, required: [] },
							output_schema: {
								type: "object" as const,
								properties: { ok: { type: "boolean" } },
								required: ["ok"],
							},
						},
						runner: async () => ({ content: "text only" }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_missing_structured_result",
				arguments: {},
			}));
			const resp = await readResponse(output);

			expect(resp.result).toBeUndefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32603);
			expect(err.message).toContain("declared output_schema but returned no structuredContent");

			server.stop();
		});

		it("returns error for unknown tool", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/call", {
				name: "nonexistent_tool_xyz",
				arguments: {},
			});
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Unknown tool");

			server.stop();
		});

		it("returns error when tool name is missing", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/call", { arguments: {} });
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);

			server.stop();
		});

		it("respects tool filter on call", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				toolFilter: ["file_read"],
				log: () => {},
			});
			await initServer(server, input, output);

			// Calling a tool not in the filter should fail
			sendRequest(input, 2, "tools/call", {
				name: "shell",
				arguments: { command: "echo hi" },
			});
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { message: string };
			expect(err.message).toContain("Unknown tool");

			server.stop();
		});

		it("invokes module tool runner and returns result", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_greet",
							description: "Module greeting tool",
							input_schema: {
								type: "object" as const,
								properties: { name: { type: "string" } },
								required: ["name"],
							},
						},
						runner: async (args: Record<string, unknown>) => ({ content: `Hello, ${args.name}!` }),
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/call", {
				name: "ext_greet",
				arguments: { name: "World" },
			});
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as { content: Array<{ type: string; text: string }> };
			expect(result.content[0].text).toBe("Hello, World!");

			server.stop();
		});

		it("returns error result when module tool runner throws", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_boom",
							description: "Always throws",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => { throw new Error("boom"); },
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/call", {
				name: "ext_boom",
				arguments: {},
			});
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as { content: Array<{ text: string }>; isError: boolean };
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("boom");

			server.stop();
		});

		it("returns draft complete error results when module tool runner throws", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({
				input,
				output,
				log: () => {},
				moduleTools: [
					{
						tool: {
							name: "ext_draft_boom",
							description: "Always throws",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => { throw new Error("draft boom"); },
						effect: legacyEffect({ risk: "safe", kind: "discovery" }),
					},
				],
			});
			await initDraftServer(server, input, output);

			sendRequest(input, 2, "tools/call", draftRequestParams({
				name: "ext_draft_boom",
				arguments: {},
			}));
			const resp = await readResponse(output);

			expect(resp.error).toBeUndefined();
			const result = resp.result as {
				resultType: string;
				content: Array<{ text: string }>;
				isError: boolean;
			};
			expect(result.resultType).toBe("complete");
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("draft boom");

			server.stop();
		});
	});

	describe("error handling", () => {
		it("returns method-not-found for unknown methods", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "unknown/method");
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number };
			expect(err.code).toBe(-32601);

			server.stop();
		});

		it("responds to ping", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "ping");
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			expect(resp.result).toEqual({});

			server.stop();
		});

		it("ignores non-JSON lines", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			// Send garbage, then a valid request
			input.write("this is not json\n");
			sendRequest(input, 1, "initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			const resp = await readResponse(output);

			// Should still get a valid response
			expect(resp.id).toBe(1);
			expect(resp.result).toBeDefined();

			server.stop();
		});

		it("handles string IDs", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, "abc-123" as unknown as number, "initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			});
			const resp = await readResponse(output);

			expect(resp.id).toBe("abc-123");

			server.stop();
		});
	});

	describe("lifecycle", () => {
		it("start and stop", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });

			expect(server.isRunning()).toBe(false);
			await server.start();
			expect(server.isRunning()).toBe(true);
			server.stop();
			expect(server.isRunning()).toBe(false);
		});

		it("handles shutdown request", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "shutdown");
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			expect(resp.result).toEqual({});

			server.stop();
		});
	});
});

describe("resources", () => {
	function makeProjectDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "kota-mcp-test-"));
		mkdirSync(join(dir, "data", "tasks", "ready"), { recursive: true });
		mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
		writeFileSync(
			join(dir, "data", "tasks", "ready", "task-one.md"),
			[
				"---",
				"id: task-one",
				"title: First Task",
				"priority: p1",
				"summary: A test task",
				"status: ready",
				"---",
				"Body",
			].join("\n"),
		);
		return dir;
	}

	it("resources/list returns KOTA resources", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/list");
		const resp = await readResponse(output);

		expect(resp.id).toBe(2);
		const result = resp.result as { resources: Array<{ uri: string }>; nextCursor?: string; ttlMs?: number; cacheScope?: string };
		expect(Array.isArray(result.resources)).toBe(true);
		expect(result.ttlMs).toBe(60_000);
		expect(result.cacheScope).toBe("public");
		const resources = [...result.resources];
		if (result.nextCursor) {
			sendRequest(input, 3, "resources/list", { cursor: result.nextCursor });
			const nextResp = await readResponse(output);
			const nextResult = nextResp.result as { resources: Array<{ uri: string }> };
			resources.push(...nextResult.resources);
		}
		const uris = resources.map((r) => r.uri);
		expect(uris).toContain("mcp://server-card.json");
		expect(uris).toContain("kota://tasks/ready");
		expect(uris).toContain("kota://workflow/status");
		expect(uris).toContain("kota://workflow/runs/recent");

		server.stop();
	});

	it("resources/list returns deterministic cursor pages and rejects malformed or out-of-range cursors", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/list");
		const first = await readResponse(output);
		const firstResult = first.result as {
			resources: Array<{ uri: string }>;
			nextCursor?: string;
			ttlMs?: number;
			cacheScope?: string;
		};
		expect(firstResult.ttlMs).toBe(60_000);
		expect(firstResult.cacheScope).toBe("public");
		expect(firstResult.resources.map((resource) => resource.uri)).toEqual([
			"mcp://server-card.json",
			"kota://tasks/ready",
			"kota://workflow/status",
		]);
		expect(firstResult.nextCursor).toEqual(expect.any(String));

		sendRequest(input, 3, "resources/list", { cursor: firstResult.nextCursor });
		const second = await readResponse(output);
		const secondResult = second.result as {
			resources: Array<{ uri: string }>;
			nextCursor?: string;
		};
		expect(secondResult.resources.map((resource) => resource.uri)).toEqual([
			"kota://workflow/runs/recent",
			"kota://memory",
			"kota://knowledge",
		]);
		expect(secondResult.nextCursor).toBeUndefined();

		sendRequest(input, 4, "resources/list", { cursor: "not-a-cursor" });
		const malformed = await readResponse(output);
		expect(malformed.error).toMatchObject({
			code: -32602,
			message: "Invalid resources cursor",
		});

		vi.mocked(getMemoryProvider).mockImplementation(() => {
			throw new Error("memory unavailable");
		});
		vi.mocked(getKnowledgeProvider).mockImplementation(() => {
			throw new Error("knowledge unavailable");
		});
		const staleEndCursor = Buffer.from("resources-list:6", "utf-8").toString("base64url");
		sendRequest(input, 5, "resources/list", { cursor: staleEndCursor });
		const outOfRange = await readResponse(output);
		expect(outOfRange.error).toMatchObject({
			code: -32602,
			message: "Resources cursor is out of range",
		});

		server.stop();
	});

	it("resources/list accepts draft per-request metadata before initialization", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await server.start();

		sendRequest(input, 1, "resources/list", draftRequestParams());
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as { resources: Array<{ uri: string }> };
		const uris = result.resources.map((r) => r.uri);
		expect(uris).toContain("kota://tasks/ready");

		server.stop();
	});

	it("exposes the MCP Apps ui resource only to app-capable clients", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await server.start();

		sendRequest(input, 1, "resources/list", draftRequestParams());
		const plainListResp = await readResponse(output);
		const plainList = plainListResp.result as { resources: Array<{ uri: string }> };
		expect(plainList.resources.map((resource) => resource.uri)).not.toContain(
			KOTA_STATUS_UI_RESOURCE_URI,
		);

		sendRequest(input, 2, "resources/read", draftRequestParams({
			uri: KOTA_STATUS_UI_RESOURCE_URI,
		}));
		const plainReadResp = await readResponse(output);
		expect(plainReadResp.error).toMatchObject({
			code: -32002,
			message: `Unknown resource: ${KOTA_STATUS_UI_RESOURCE_URI}`,
		});

		sendRequest(input, 3, "resources/list", draftRequestParams(
			{},
			mcpUiClientCapabilities(),
		));
		const appListResp = await readResponse(output);
		const appList = appListResp.result as {
			resources: Array<{ uri: string; mimeType: string; _meta?: Record<string, unknown> }>;
		};
		const appResource = appList.resources.find((resource) =>
			resource.uri === KOTA_STATUS_UI_RESOURCE_URI
		);
		expect(appResource).toMatchObject({
			uri: KOTA_STATUS_UI_RESOURCE_URI,
			mimeType: MCP_UI_RESOURCE_MIME_TYPE,
			_meta: {
				ui: {
					csp: {
						baseUriDomains: [],
						connectDomains: [],
						frameDomains: [],
						resourceDomains: [],
					},
					permissions: {},
					prefersBorder: true,
				},
			},
		});
		const appResourceMeta = appResource?._meta;
		expect(appResourceMeta).toBeDefined();

		sendRequest(input, 4, "resources/read", draftRequestParams({
			uri: KOTA_STATUS_UI_RESOURCE_URI,
		}, mcpUiClientCapabilities()));
		const appReadResp = await readResponse(output);
		const appRead = appReadResp.result as {
			contents: Array<{
				uri: string;
				mimeType: string;
				text: string;
				_meta?: Record<string, unknown>;
			}>;
		};
		expect(appRead.contents).toHaveLength(1);
		expect(appRead.contents[0]).toMatchObject({
			uri: KOTA_STATUS_UI_RESOURCE_URI,
			mimeType: MCP_UI_RESOURCE_MIME_TYPE,
			_meta: appResourceMeta,
		});
		expect(appRead.contents[0]?.text).toContain("<!doctype html>");
		expect(appRead.contents[0]?.text.length).toBeLessThan(12_000);
		expect(appRead.contents[0]?.text).not.toMatch(/<script|https?:\/\//i);

		server.stop();
	});

	it("resources/read returns the current MCP Server Card resource", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "mcp://server-card.json" });
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as {
			contents: Array<{ uri: string; mimeType: string; text: string }>;
		};
		expect(result.contents).toHaveLength(1);
		expect(result.contents[0].uri).toBe("mcp://server-card.json");
		expect(result.contents[0].mimeType).toBe("application/json");
		const card = JSON.parse(result.contents[0].text) as Record<string, unknown>;
		expect(card).toEqual({
			$schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
			name: "io.github.xmanatee/kota",
			title: "KOTA",
			description: "Keep Only The Awesome. An AI coding agent MCP server exposing KOTA tools.",
			repository: {
				source: "github",
				url: "https://github.com/xmanatee/kota",
			},
			version: "0.1.0",
		});
		expect(card.serverInfo).toBeUndefined();
		expect(card.protocolVersion).toBeUndefined();
		expect(card.transport).toBeUndefined();
		expect(card.capabilities).toBeUndefined();
		expect(card.packages).toBeUndefined();
		expect(card.remotes).toBeUndefined();
		const serialized = JSON.stringify(card);
		expect(serialized).not.toMatch(/127\.0\.0\.1|localhost|\/Users\/|\/private\/|authorization|token|secret/i);

		server.stop();
	});

	it("keeps server/discover as the runtime capability source", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await server.start();

		sendRequest(input, 1, "server/discover", draftRequestParams());
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as Record<string, unknown>;
		expect(result.capabilities).toMatchObject({
			tools: {},
			resources: { listChanged: true },
			prompts: { listChanged: true },
			completions: {},
			logging: {},
		});
		expect(result.supportedVersions).toEqual(expect.arrayContaining([MCP_DRAFT_PROTOCOL_VERSION]));

		server.stop();
	});

	it("resources/read returns ready task content", async () => {
		const projectDir = makeProjectDir();
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, projectDir });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "kota://tasks/ready" });
		const resp = await readResponse(output);

		expect(resp.id).toBe(2);
		const result = resp.result as {
			contents: Array<{ uri: string; mimeType: string; text: string }>;
			ttlMs?: number;
			cacheScope?: string;
		};
		expect(result.ttlMs).toBe(0);
		expect(result.cacheScope).toBe("private");
		expect(result.contents).toHaveLength(1);
		expect(result.contents[0].uri).toBe("kota://tasks/ready");
		expect(result.contents[0].mimeType).toBe("application/json");
		const tasks = JSON.parse(result.contents[0].text) as Array<{
			id: string;
			title: string;
		}>;
		expect(tasks).toHaveLength(1);
		expect(tasks[0].id).toBe("task-one");
		expect(tasks[0].title).toBe("First Task");

		server.stop();
	});

	it("resources/read requests draft roots through MRTR and retries with root-scoped content", async () => {
		const fallbackProjectDir = makeProjectDir();
		const rootProjectDir = makeProjectDir();
		writeFileSync(
			join(rootProjectDir, "data", "tasks", "ready", "task-root.md"),
			[
				"---",
				"id: task-root",
				"title: Root Task",
				"priority: p1",
				"summary: Root-scoped task",
				"status: ready",
				"---",
				"Body",
			].join("\n"),
		);
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, projectDir: fallbackProjectDir });
		await initDraftServer(server, input, output);

		sendRequest(input, 20, "resources/read", draftRequestParams({
			uri: "kota://tasks/ready",
		}, { roots: {} }));
		const firstResp = await readResponse(output);

		expect(firstResp.id).toBe(20);
		const inputRequired = firstResp.result as {
			resultType: string;
			inputRequests: { roots: { method: string } };
			requestState: string;
		};
		expect(inputRequired.resultType).toBe("input_required");
		expect(inputRequired.inputRequests.roots.method).toBe("roots/list");

		sendRequest(input, 21, "resources/read", draftRequestParams({
			uri: "kota://tasks/ready",
			inputResponses: {
				roots: { roots: [{ uri: pathToFileURL(rootProjectDir).href }] },
			},
			requestState: inputRequired.requestState,
		}, { roots: {} }));
		const retryResp = await readResponse(output);

		expect(retryResp.error).toBeUndefined();
		const result = retryResp.result as {
			contents: Array<{ text: string }>;
		};
		const tasks = JSON.parse(result.contents[0].text) as Array<{ id: string }>;
		expect(tasks.map((task) => task.id).sort()).toEqual(["task-one", "task-root"]);

		server.stop();
	});

	it("rejects draft roots requestState reused on a different originating method", async () => {
		const projectDir = makeProjectDir();
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, projectDir });
		await initDraftServer(server, input, output);

		sendRequest(input, 30, "resources/read", draftRequestParams({
			uri: "kota://tasks/ready",
		}, { roots: {} }));
		const firstResp = await readResponse(output);
		const inputRequired = firstResp.result as { requestState: string };

		sendRequest(input, 31, "prompts/get", draftRequestParams({
			name: "kota-create-task",
			arguments: { title: "Task", priority: "p1" },
			inputResponses: {
				roots: { roots: [{ uri: pathToFileURL(projectDir).href }] },
			},
			requestState: inputRequired.requestState,
		}, { roots: {} }));
		const resp = await readResponse(output);

		expect(resp.result).toBeUndefined();
		const err = resp.error as { code: number; message: string };
		expect(err.code).toBe(-32602);
		expect(err.message).toContain("requestState does not match requested method");

		server.stop();
	});

	it("rejects draft roots retries missing the requested input response", async () => {
		const projectDir = makeProjectDir();
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, projectDir });
		await initDraftServer(server, input, output);

		sendRequest(input, 32, "resources/read", draftRequestParams({
			uri: "kota://tasks/ready",
		}, { roots: {} }));
		const firstResp = await readResponse(output);
		const inputRequired = firstResp.result as { requestState: string };

		sendRequest(input, 33, "resources/read", draftRequestParams({
			uri: "kota://tasks/ready",
			inputResponses: {},
			requestState: inputRequired.requestState,
		}, { roots: {} }));
		const resp = await readResponse(output);

		expect(resp.result).toBeUndefined();
		const err = resp.error as { code: number; message: string };
		expect(err.code).toBe(-32602);
		expect(err.message).toContain("Missing input response for request \"roots\"");

		server.stop();
	});

	it("resources/read returns workflow/status content", async () => {
		const projectDir = makeProjectDir();
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, projectDir });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", {
			uri: "kota://workflow/status",
		});
		const resp = await readResponse(output);

		expect(resp.id).toBe(2);
		const result = resp.result as {
			contents: Array<{ text: string }>;
		};
		const status = JSON.parse(result.contents[0].text) as {
			activeRunCount: number;
			paused: boolean;
		};
		expect(typeof status.activeRunCount).toBe("number");
		expect(typeof status.paused).toBe("boolean");

		server.stop();
	});

	it("resources/read returns error for unknown URI", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", {
			uri: "kota://nonexistent/resource",
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeDefined();
		const err = resp.error as { code: number };
		expect(err.code).toBe(-32002);

		server.stop();
	});

	it("resources/list rejects before initialization when draft metadata is missing", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await server.start();

		sendRequest(input, 1, "resources/list");
		const resp = await readResponse(output);

		expect(resp.error).toBeDefined();
		const err = resp.error as { code: number; message: string };
		expect(err.code).toBe(-32602);
		expect(err.message).toContain("Missing required MCP draft _meta");

		server.stop();
	});

	it("resources/templates/list returns paged memory and knowledge resource templates", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/templates/list");
		const first = await readResponse(output);
		const firstResult = first.result as {
			resourceTemplates: Array<{ uriTemplate: string; name: string }>;
			nextCursor?: string;
			ttlMs?: number;
			cacheScope?: string;
		};
		expect(firstResult.ttlMs).toBe(60_000);
		expect(firstResult.cacheScope).toBe("public");
		expect(firstResult.resourceTemplates.map((template) => template.uriTemplate)).toEqual([
			"kota://memory{?cursor,limit}",
			"kota://memory/search{?q,cursor,limit}",
			"kota://memory/entry/{encodedId}",
		]);
		expect(firstResult.nextCursor).toEqual(expect.any(String));

		sendRequest(input, 3, "resources/templates/list", { cursor: firstResult.nextCursor });
		const second = await readResponse(output);
		const secondResult = second.result as {
			resourceTemplates: Array<{ uriTemplate: string; name: string; description: string; mimeType: string }>;
			nextCursor?: string;
		};
		expect(secondResult.resourceTemplates.map((template) => template.uriTemplate)).toEqual([
			"kota://knowledge{?cursor,limit}",
			"kota://knowledge/search{?q,cursor,limit}",
			"kota://knowledge/entry/{encodedId}",
		]);
		expect(secondResult.nextCursor).toBeUndefined();
		expect([...firstResult.resourceTemplates, ...secondResult.resourceTemplates]).toHaveLength(6);
		for (const template of secondResult.resourceTemplates) {
			expect(typeof template.name).toBe("string");
			expect(typeof template.description).toBe("string");
			expect(template.mimeType).toBe("application/json");
		}

		server.stop();
	});

	it("resources/templates/list rejects malformed and out-of-range cursors", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/templates/list");
		const first = await readResponse(output);
		const firstResult = first.result as { nextCursor?: string };
		expect(firstResult.nextCursor).toEqual(expect.any(String));

		sendRequest(input, 3, "resources/templates/list", { cursor: "not-a-cursor" });
		const malformed = await readResponse(output);
		expect(malformed.error).toMatchObject({
			code: -32602,
			message: "Invalid resource templates cursor",
		});

		vi.mocked(getMemoryProvider).mockImplementation(() => {
			throw new Error("memory unavailable");
		});
		vi.mocked(getKnowledgeProvider).mockImplementation(() => {
			throw new Error("knowledge unavailable");
		});
		sendRequest(input, 4, "resources/templates/list", { cursor: firstResult.nextCursor });
		const outOfRange = await readResponse(output);
		expect(outOfRange.error).toMatchObject({
			code: -32602,
			message: "Resource templates cursor is out of range",
		});

		server.stop();
	});
});

describe("kotaToolToMcp", () => {
	it("converts KotaTool to MCP format", () => {
		const tool = {
			name: "test_tool",
			description: "A test tool",
			input_schema: {
				type: "object" as const,
				properties: { arg1: { type: "string" } },
				required: ["arg1"],
			},
		};

		const mcp = kotaToolToMcp(tool);

		expect(mcp.name).toBe("test_tool");
		expect(mcp.description).toBe("A test tool");
		expect(mcp.inputSchema).toEqual({
			type: "object",
			properties: { arg1: { type: "string" } },
			required: ["arg1"],
		});
		// MCP uses inputSchema (camelCase), not input_schema (snake_case)
		expect(mcp).not.toHaveProperty("input_schema");
		expect(mcp).not.toHaveProperty("outputSchema");
	});

	it("maps neutral output_schema to MCP outputSchema", () => {
		const outputSchema = {
			type: "object" as const,
			properties: { ok: { type: "boolean" } },
			required: ["ok"],
		};
		const mcp = kotaToolToMcp({
			name: "test_tool",
			description: "A test tool",
			input_schema: { type: "object", properties: {} },
			output_schema: outputSchema,
		});

		expect(mcp.outputSchema).toEqual(outputSchema);
		expect(mcp).not.toHaveProperty("output_schema");
	});
});

describe("toolResultToMcp", () => {
	it("converts text result", () => {
		const content = toolResultToMcp({ content: "hello world" });
		expect(content).toEqual([{ type: "text", text: "hello world" }]);
	});

	it("converts result with blocks", () => {
		const content = toolResultToMcp({
			content: "summary",
			blocks: [
				{ type: "text", text: "line 1", _meta: { blockCache: "b1" } },
				{
					type: "image",
					source: { type: "base64", media_type: "image/png", data: "abc123" },
					annotations: { audience: ["assistant"] },
				},
				{
					type: "mcp_content",
					content: { type: "audio", data: "def456", mimeType: "audio/wav" },
				},
			],
		});

		expect(content).toHaveLength(3);
		expect(content[0]).toEqual({ type: "text", text: "line 1", _meta: { blockCache: "b1" } });
		expect(content[1]).toEqual({
			type: "image",
			data: "abc123",
			mimeType: "image/png",
			annotations: { audience: ["assistant"] },
		});
		expect(content[2]).toEqual({ type: "audio", data: "def456", mimeType: "audio/wav" });
	});

	it("falls back to content string when blocks is empty", () => {
		const content = toolResultToMcp({ content: "fallback", blocks: [] });
		expect(content).toEqual([{ type: "text", text: "fallback" }]);
	});
});

describe("prompts", () => {
	describe("prompts/list", () => {
		it("returns the three KOTA prompt templates", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/list");
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as {
				prompts: Array<{ name: string; description: string }>;
				ttlMs?: number;
				cacheScope?: string;
			};
			expect(Array.isArray(result.prompts)).toBe(true);
			expect(result.ttlMs).toBe(60_000);
			expect(result.cacheScope).toBe("public");
			const names = result.prompts.map((p) => p.name);
			expect(names).toContain("kota-create-task");
			expect(names).toContain("kota-trigger-workflow");
			expect(names).toContain("kota-summarize-run");

			server.stop();
		});

		it("advertises built-in prompt required argument metadata", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/list");
			const resp = await readResponse(output);

			const result = resp.result as {
				prompts: Array<{ name: string; arguments?: Array<{ name: string; required?: boolean }> }>;
			};
			const createTask = result.prompts.find((prompt) => prompt.name === "kota-create-task");
			const triggerWorkflow = result.prompts.find((prompt) => prompt.name === "kota-trigger-workflow");
			const summarizeRun = result.prompts.find((prompt) => prompt.name === "kota-summarize-run");
			expect(createTask?.arguments).toEqual([
				{ name: "title", description: "Short task title", required: true },
				{ name: "area", description: "Task area (e.g. runtime, operator-ux)", required: false },
				{ name: "priority", description: "Priority: p1, p2, or p3", required: false },
			]);
			expect(triggerWorkflow?.arguments).toEqual([
				{ name: "workflow", description: "Name of the workflow to trigger", required: true },
				{ name: "payload", description: "Optional JSON payload for the trigger", required: false },
			]);
			expect(summarizeRun?.arguments).toEqual([
				{
					name: "run_id",
					description: "The run ID to summarize (e.g. 2026-03-31T11-58-51-088Z-builder-pohafg)",
					required: true,
				},
			]);

			server.stop();
		});

		it("accepts draft per-request metadata before initialization", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "prompts/list", draftRequestParams());
			const resp = await readResponse(output);

			expect(resp.error).toBeUndefined();
			const result = resp.result as { prompts: Array<{ name: string }> };
			expect(result.prompts.map((p) => p.name)).toContain("kota-create-task");

			server.stop();
		});

		it("each prompt has name, description, and arguments", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/list");
			const resp = await readResponse(output);

			const result = resp.result as {
				prompts: Array<{ name: string; description: string; arguments?: unknown[] }>;
			};
			for (const prompt of result.prompts) {
				expect(typeof prompt.name).toBe("string");
				expect(typeof prompt.description).toBe("string");
				expect(Array.isArray(prompt.arguments)).toBe(true);
			}

			server.stop();
		});

		it("returns project prompt templates with discovered arguments", async () => {
			const projectDir = mkdtempSync(join(tmpdir(), "kota-mcp-project-prompts-"));
			writeProjectPrompt(
				projectDir,
				"review.md",
				"---\nname: review-topic\ndescription: Review a topic\nvariables: [topic, focus]\n---\nReview {{topic}} with focus on {{focus}}.",
			);
			writeProjectPrompt(
				projectDir,
				"brief.md",
				"---\nname: brief-topic\ndescription: Brief a topic\n---\nBrief {{topic}}.",
			);
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, projectDir });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/list");
			const resp = await readResponse(output);

			const result = resp.result as {
				prompts: Array<{ name: string; description: string; arguments?: Array<{ name: string; required?: boolean }> }>;
			};
			const review = result.prompts.find((prompt) => prompt.name === "review-topic");
			const brief = result.prompts.find((prompt) => prompt.name === "brief-topic");
			expect(review).toMatchObject({
				description: "Review a topic",
				arguments: [
					{ name: "topic", required: true },
					{ name: "focus", required: true },
				],
			});
			expect(brief?.arguments).toEqual([{ name: "topic", description: "Template variable: topic", required: true }]);

			server.stop();
		});

		it("rejects project prompt templates with malformed names", async () => {
			const projectDir = mkdtempSync(join(tmpdir(), "kota-mcp-malformed-project-prompt-list-"));
			writeProjectPrompt(
				projectDir,
				"bad.md",
				"---\nname: [bad]\ndescription: Bad prompt\n---\nBody.",
			);
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, projectDir });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/list");
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Invalid prompt template file");
			expect(err.message).toContain('front matter "name" must be a string');

			server.stop();
		});

		it("returns deterministic cursor pages for larger prompt catalogs", async () => {
			const projectDir = mkdtempSync(join(tmpdir(), "kota-mcp-paged-prompts-"));
			for (let i = 0; i < 48; i++) {
				const suffix = String(i).padStart(2, "0");
				writeProjectPrompt(
					projectDir,
					`template-${suffix}.md`,
					`---\nname: page-template-${suffix}\ndescription: Page ${suffix}\n---\nTemplate ${suffix}.`,
				);
			}
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, projectDir });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/list");
			const first = await readResponse(output);
			const firstResult = first.result as {
				prompts: Array<{ name: string }>;
				nextCursor?: string;
			};
			expect(firstResult.prompts).toHaveLength(50);
			expect(firstResult.nextCursor).toBe("50");
			expect(firstResult.prompts.map((prompt) => prompt.name).slice(0, 3)).toEqual([
				"kota-create-task",
				"kota-trigger-workflow",
				"kota-summarize-run",
			]);
			expect(firstResult.prompts.at(-1)?.name).toBe("page-template-46");

			sendRequest(input, 3, "prompts/list", { cursor: firstResult.nextCursor });
			const second = await readResponse(output);
			const secondResult = second.result as {
				prompts: Array<{ name: string }>;
				nextCursor?: string;
			};
			expect(secondResult.prompts.map((prompt) => prompt.name)).toEqual(["page-template-47"]);
			expect(secondResult.nextCursor).toBeUndefined();

			server.stop();
		});

		it("rejects malformed prompt list cursors", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/list", { cursor: "not-a-cursor" });
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Invalid cursor");

			server.stop();
		});

		it("rejects prompts/list before initialization when draft metadata is missing", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "prompts/list");
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Missing required MCP draft _meta");

			server.stop();
		});
	});

	describe("prompts/get", () => {
		it("returns rendered messages for kota-create-task", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", {
				name: "kota-create-task",
				arguments: { title: "My Test Task", priority: "p1" },
			});
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as {
				description: string;
				messages: Array<{ role: string; content: { type: string; text: string } }>;
			};
			expect(typeof result.description).toBe("string");
			expect(Array.isArray(result.messages)).toBe(true);
			expect(result.messages.length).toBeGreaterThan(0);
			expect(result.messages[0].role).toBe("user");
			expect(result.messages[0].content.type).toBe("text");
			expect(result.messages[0].content.text).toContain("My Test Task");
			expect(result.messages[0].content.text).toContain("p1");

			server.stop();
		});

		it("rejects missing required built-in prompt arguments", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", {
				name: "kota-create-task",
				arguments: { priority: "p1" },
			});
			const resp = await readResponse(output);

			expect(resp.result).toBeUndefined();
			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toBe("Missing required prompt argument: title");

			server.stop();
		});

		it("returns rendered messages for kota-trigger-workflow", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", {
				name: "kota-trigger-workflow",
				arguments: { workflow: "builder" },
			});
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as {
				messages: Array<{ content: { text: string } }>;
			};
			expect(result.messages[0].content.text).toContain("builder");

			server.stop();
		});

		it("returns rendered messages for kota-summarize-run", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", {
				name: "kota-summarize-run",
				arguments: { run_id: "2026-03-31T11-58-51-088Z-builder-pohafg" },
			});
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as {
				messages: Array<{ content: { text: string } }>;
			};
			expect(result.messages[0].content.text).toContain("2026-03-31T11-58-51-088Z-builder-pohafg");

			server.stop();
		});

		it("renders project prompt templates when required variables are provided", async () => {
			const projectDir = mkdtempSync(join(tmpdir(), "kota-mcp-render-prompt-"));
			writeProjectPrompt(
				projectDir,
				"review.md",
				"---\nname: review-topic\ndescription: Review a topic\nvariables: [topic, focus]\n---\nReview {{topic}} with focus on {{focus}}.",
			);
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, projectDir });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", {
				name: "review-topic",
				arguments: { topic: "KOTA", focus: "runtime" },
			});
			const resp = await readResponse(output);

			expect(resp.error).toBeUndefined();
			const result = resp.result as {
				description: string;
				messages: Array<{ role: string; content: { type: string; text: string } }>;
			};
			expect(result.description).toBe("Review a topic");
			expect(result.messages).toHaveLength(1);
			expect(result.messages[0]).toMatchObject({
				role: "user",
				content: { type: "text" },
			});
			expect(result.messages[0].content.text).toBe("Review KOTA with focus on runtime.");
			expect(result.messages[0].content.text).not.toContain("{{focus}}");
			expect(result.messages[0].content.text).not.toContain("Unresolved template variables");

			server.stop();
		});

		it("prompts/get requests draft roots through MRTR and retries with root-scoped prompts", async () => {
			const fallbackProjectDir = mkdtempSync(join(tmpdir(), "kota-mcp-fallback-prompt-"));
			const rootProjectDir = mkdtempSync(join(tmpdir(), "kota-mcp-root-prompt-"));
			writeProjectPrompt(
				rootProjectDir,
				"review.md",
				"---\nname: review-topic\ndescription: Review a topic\nvariables: [topic]\n---\nReview {{topic}} from the root project.",
			);
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, projectDir: fallbackProjectDir });
			await initDraftServer(server, input, output);

			sendRequest(input, 40, "prompts/get", draftRequestParams({
				name: "review-topic",
				arguments: { topic: "KOTA" },
			}, { roots: {} }));
			const firstResp = await readResponse(output);

			const inputRequired = firstResp.result as {
				resultType: string;
				inputRequests: { roots: { method: string } };
				requestState: string;
			};
			expect(inputRequired.resultType).toBe("input_required");
			expect(inputRequired.inputRequests.roots.method).toBe("roots/list");

			sendRequest(input, 41, "prompts/get", draftRequestParams({
				name: "review-topic",
				arguments: { topic: "KOTA" },
				inputResponses: {
					roots: { roots: [{ uri: pathToFileURL(rootProjectDir).href }] },
				},
				requestState: inputRequired.requestState,
			}, { roots: {} }));
			const retryResp = await readResponse(output);

			expect(retryResp.error).toBeUndefined();
			const result = retryResp.result as {
				messages: Array<{ content: { text: string } }>;
			};
			expect(result.messages[0].content.text).toBe("Review KOTA from the root project.");

			server.stop();
		});

		it("rejects missing required project prompt template variables", async () => {
			const projectDir = mkdtempSync(join(tmpdir(), "kota-mcp-missing-project-prompt-args-"));
			writeProjectPrompt(
				projectDir,
				"review.md",
				"---\nname: review-topic\ndescription: Review a topic\nvariables: [topic, focus]\n---\nReview {{topic}} with focus on {{focus}}.",
			);
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, projectDir });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", {
				name: "review-topic",
				arguments: {},
			});
			const resp = await readResponse(output);

			expect(resp.result).toBeUndefined();
			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toBe("Missing required prompt arguments: topic, focus");

			server.stop();
		});

		it("rejects project prompt rendering when a template file has a malformed name", async () => {
			const projectDir = mkdtempSync(join(tmpdir(), "kota-mcp-malformed-project-prompt-get-"));
			writeProjectPrompt(
				projectDir,
				"bad.md",
				"---\nname: [bad]\ndescription: Bad prompt\n---\nBody.",
			);
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, projectDir });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", { name: "bad" });
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Invalid prompt template file");
			expect(err.message).toContain('front matter "name" must be a string');

			server.stop();
		});

		it("returns error for unknown prompt name", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", { name: "nonexistent-prompt" });
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Unknown prompt");

			server.stop();
		});

		it("rejects malformed prompt arguments", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", {
				name: "kota-create-task",
				arguments: { title: 42 },
			});
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toBe("arguments.title must be a string");

			server.stop();
		});

		it("returns error when name is missing", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "prompts/get", { arguments: {} });
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number };
			expect(err.code).toBe(-32602);

			server.stop();
		});

		it("rejects prompts/get before initialization when draft metadata is missing", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "prompts/get", { name: "kota-create-task" });
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Missing required MCP draft _meta");

			server.stop();
		});
	});
});

describe("resource subscriptions", () => {
	async function initDraftServerWithQueuedReader(
		server: McpServer,
		input: PassThrough,
		reader: ReturnType<typeof createQueuedReader>,
	): Promise<Record<string, unknown>> {
		await server.start();
		sendRequest(input, 1, "initialize", {
			protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "test", version: "1.0.0" },
		});
		const resp = await reader.read();
		sendNotification(input, "notifications/initialized");
		return resp;
	}

	function emitWorkflowCompleted(bus: EventBus): void {
		bus.emit("workflow.completed", {
			projectId: "test-project",
			workflow: "builder",
			runId: "test-run-id",
			status: "success",
			triggerEvent: "runtime.idle",
			durationMs: 1000,
			definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
			runDir: ".kota/runs/test-run-id",
			tags: [],
		});
	}

	async function readNotification(output: PassThrough): Promise<Record<string, unknown>> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Timeout waiting for notification")), 2000);
			const chunks: string[] = [];
			const onData = (chunk: Buffer) => {
				chunks.push(chunk.toString());
				const all = chunks.join("");
				const lines = all.split("\n").filter((l) => l.trim());
				for (const line of lines) {
					try {
						const msg = JSON.parse(line) as Record<string, unknown>;
						if (!("id" in msg)) {
							clearTimeout(timeout);
							output.off("data", onData);
							resolve(msg);
							return;
						}
					} catch {
						// not valid JSON yet
					}
				}
			};
			output.on("data", onData);
		});
	}

	it("resources/subscribe registers URI and returns empty result", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, eventBus: null });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/subscribe", { uri: "kota://tasks/ready" });
		const resp = await readResponse(output);

		expect(resp.id).toBe(2);
		expect(resp.result).toEqual({});

		server.stop();
	});

	it("resources/unsubscribe returns empty result", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, eventBus: null });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/subscribe", { uri: "kota://tasks/ready" });
		await readResponse(output);

		sendRequest(input, 3, "resources/unsubscribe", { uri: "kota://tasks/ready" });
		const resp = await readResponse(output);

		expect(resp.id).toBe(3);
		expect(resp.result).toEqual({});

		server.stop();
	});

	it("resources/subscribe returns error for unknown URI", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, eventBus: null });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/subscribe", { uri: "kota://nonexistent" });
		const resp = await readResponse(output);

		expect(resp.error).toBeDefined();
		const err = resp.error as { code: number };
		expect(err.code).toBe(-32002);

		server.stop();
	});

	it("subscriptions/listen opens draft resource subscriptions and receives workflow and task updates", async () => {
		const bus = new EventBus();
		const { input, output } = createTestStreams();
		const reader = createQueuedReader(output);
		const server = new McpServer({ input, output, log: () => {}, eventBus: bus });
		await initDraftServerWithQueuedReader(server, input, reader);

		sendRequest(input, 2, "subscriptions/listen", draftRequestParams({
			notifications: {
				resourceSubscriptions: ["kota://workflow/status", "kota://tasks/ready"],
			},
		}));
		const ack = await reader.read();
		expect(ack.method).toBe("notifications/subscriptions/acknowledged");
		expect(ack.params).toEqual({
			_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
			notifications: {
				resourceSubscriptions: ["kota://workflow/status", "kota://tasks/ready"],
			},
		});

		emitWorkflowCompleted(bus);
		const workflowNotif = await reader.read();
		expect(workflowNotif.method).toBe("notifications/resources/updated");
		expect(workflowNotif.params).toEqual({
			_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
			uri: "kota://workflow/status",
		});

		bus.emit("task.changed", { counts: { pending: 1, in_progress: 0, done: 0 } });
		const taskNotif = await reader.read();
		expect(taskNotif.method).toBe("notifications/resources/updated");
		expect(taskNotif.params).toEqual({
			_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
			uri: "kota://tasks/ready",
		});

		server.stop();
	});

	it("sends resources/list_changed only when the listed resource catalog changes", async () => {
		const defaultMemoryProvider: ReturnType<typeof getMemoryProvider> = {
			list: () => [],
			save: vi.fn(() => "memory-id"),
			search: vi.fn(() => []),
			update: vi.fn(() => false),
			delete: vi.fn(() => false),
			supportsSemanticSearch: vi.fn(() => false),
			semanticSearch: vi.fn(async () => []),
			reindex: vi.fn(async () => ({ indexed: 0, failed: 0, skipped: true })),
		};
		vi.mocked(getMemoryProvider).mockReturnValue(defaultMemoryProvider);

		const bus = new EventBus();
		const { input, output } = createTestStreams();
		const reader = createQueuedReader(output);
		const server = new McpServer({ input, output, log: () => {}, eventBus: bus });

		try {
			await initDraftServerWithQueuedReader(server, input, reader);
			sendRequest(input, 2, "subscriptions/listen", draftRequestParams({
				notifications: { resourcesListChanged: true },
			}));
			const ack = await reader.read();
			expect(ack.params).toEqual({
				_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
				notifications: { resourcesListChanged: true },
			});

			bus.emit("task.changed", { counts: { pending: 1, in_progress: 0, done: 0 } });
			await expect(reader.read(100)).rejects.toThrow("Timeout reading response");

			vi.mocked(getMemoryProvider).mockImplementation(() => {
				throw new Error("No memory provider registered");
			});
			bus.emit("daemon.config.reload", {
				timestamp: "2026-05-20T00:00:00.000Z",
				scope: "daemon",
				outcome: "success",
				reloadKind: "module-scoped",
				fullReload: false,
				changedModules: ["memory"],
				workflowCount: 0,
			});

			const listChanged = await reader.read();
			expect(listChanged.method).toBe("notifications/resources/list_changed");
			expect(listChanged.params).toEqual({
				_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
			});
		} finally {
			vi.mocked(getMemoryProvider).mockReturnValue(defaultMemoryProvider);
			server.stop();
		}
	});

	it("acknowledges promptsListChanged and emits prompt list notifications for visible template changes", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-mcp-prompt-subscribe-"));
		mkdirSync(join(projectDir, ".kota", "prompts"), { recursive: true });
		const { input, output } = createTestStreams();
		const reader = createQueuedReader(output);
		const server = new McpServer({ input, output, log: () => {}, eventBus: null, projectDir });
		await initDraftServerWithQueuedReader(server, input, reader);

		sendRequest(input, 2, "subscriptions/listen", draftRequestParams({
			notifications: { promptsListChanged: true },
		}));
		const ack = await reader.read();
		expect(ack.method).toBe("notifications/subscriptions/acknowledged");
		expect(ack.params).toEqual({
			_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
			notifications: { promptsListChanged: true },
		});

		writeProjectPrompt(
			projectDir,
			"new-prompt.md",
			"---\nname: subscribed-prompt\ndescription: Subscribed\n---\nHello.",
		);

		const listChanged = await reader.read();
		expect(listChanged.method).toBe("notifications/prompts/list_changed");
		expect(listChanged.params).toEqual({
			_meta: { "io.modelcontextprotocol/subscriptionId": "2" },
		});

		server.stop();
	});

	it("cancels promptsListChanged delivery through notifications/cancelled", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-mcp-prompt-cancel-"));
		mkdirSync(join(projectDir, ".kota", "prompts"), { recursive: true });
		const { input, output } = createTestStreams();
		const reader = createQueuedReader(output);
		const server = new McpServer({ input, output, log: () => {}, eventBus: null, projectDir });
		await initDraftServerWithQueuedReader(server, input, reader);

		sendRequest(input, 2, "subscriptions/listen", draftRequestParams({
			notifications: { promptsListChanged: true },
		}));
		await reader.read();
		sendNotification(input, "notifications/cancelled", { requestId: 2 });

		writeProjectPrompt(
			projectDir,
			"new-prompt.md",
			"---\nname: cancelled-prompt\ndescription: Cancelled\n---\nHello.",
		);

		await expect(reader.read(150)).rejects.toThrow("Timeout reading response");

		server.stop();
	});

	it("rejects malformed promptsListChanged subscription flags", async () => {
		const { input, output } = createTestStreams();
		const reader = createQueuedReader(output);
		const server = new McpServer({ input, output, log: () => {}, eventBus: null });
		await initDraftServerWithQueuedReader(server, input, reader);

		sendRequest(input, 2, "subscriptions/listen", draftRequestParams({
			notifications: { promptsListChanged: "yes" },
		}));
		const resp = await reader.read();

		expect(resp.error).toBeDefined();
		const err = resp.error as { code: number; message: string };
		expect(err.code).toBe(-32602);
		expect(err.message).toBe("notifications.promptsListChanged must be a boolean");

		server.stop();
	});

	it("sends notifications/resources/updated when workflow.completed fires for subscribed URI", async () => {
		const bus = new EventBus();
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, eventBus: bus });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/subscribe", { uri: "kota://workflow/status" });
		await readResponse(output);

		const notifPromise = readNotification(output);
		emitWorkflowCompleted(bus);

		const notif = await notifPromise;
		expect(notif.method).toBe("notifications/resources/updated");
		const params = notif.params as Record<string, unknown>;
		expect(params.uri).toBe("kota://workflow/status");

		server.stop();
	});

	it("sends notifications/resources/updated when task.changed fires for subscribed URI", async () => {
		const bus = new EventBus();
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, eventBus: bus });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/subscribe", { uri: "kota://tasks/ready" });
		await readResponse(output);

		const notifPromise = readNotification(output);
		bus.emit("task.changed", { counts: { pending: 1, in_progress: 0, done: 0 } });

		const notif = await notifPromise;
		expect(notif.method).toBe("notifications/resources/updated");
		const params = notif.params as Record<string, unknown>;
		expect(params.uri).toBe("kota://tasks/ready");

		server.stop();
	});

	it("does not send notification for unsubscribed URI", async () => {
		const bus = new EventBus();
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, eventBus: bus });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/subscribe", { uri: "kota://tasks/ready" });
		await readResponse(output);

		emitWorkflowCompleted(bus);

		const noNotif = await Promise.race([
			readNotification(output).then(() => "got-notif"),
			new Promise<string>((r) => setTimeout(() => r("no-notif"), 100)),
		]);
		expect(noNotif).toBe("no-notif");

		server.stop();
	});

	it("stops sending notifications after stop()", async () => {
		const bus = new EventBus();
		expect(bus.listenerCount("workflow.completed")).toBe(0);

		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, eventBus: bus });
		await server.start();
		expect(bus.listenerCount("workflow.completed")).toBe(1);

		server.stop();
		expect(bus.listenerCount("workflow.completed")).toBe(0);
	});
});

// --- Helper: initialize with elicitation capability ---

async function initServerWithElicitation(
	server: McpServer,
	input: PassThrough,
	output: PassThrough,
): Promise<Record<string, unknown>> {
	await server.start();
	sendRequest(input, 1, "initialize", {
		protocolVersion: "2024-11-05",
		capabilities: { elicitation: {} },
		clientInfo: { name: "test", version: "1.0.0" },
	});
	const resp = await readResponse(output);
	sendNotification(input, "notifications/initialized");
	return resp;
}

describe("McpServer elicitation", () => {
	describe("capability negotiation", () => {
		it("does not advertise elicitation when client omits it", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			const resp = await initServer(server, input, output);
			const caps = (resp.result as Record<string, unknown>).capabilities as Record<string, unknown>;
			expect(caps.elicitation).toBeUndefined();
			server.stop();
		});

		it("advertises elicitation when client supports it", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			const resp = await initServerWithElicitation(server, input, output);
			const caps = (resp.result as Record<string, unknown>).capabilities as Record<string, unknown>;
			expect(caps.elicitation).toEqual({});
			server.stop();
		});
	});

	describe("requestElicitation", () => {
		it("returns null when client does not support elicitation", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);
			const result = await server.requestElicitation("Test?", { type: "object", properties: { ok: { type: "boolean" } } });
			expect(result).toBeNull();
			server.stop();
		});

		it("sends sampling/elicit to client and resolves on accept", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServerWithElicitation(server, input, output);

			const elicitPromise = server.requestElicitation("Approve?", {
				type: "object",
				properties: { confirmed: { type: "boolean", title: "Confirmed" } },
			});

			// Server should have sent a sampling/elicit request
			const sentMsg = await readResponse(output);
			expect(sentMsg.method).toBe("sampling/elicit");
			const sentParams = sentMsg.params as Record<string, unknown>;
			expect(sentParams.message).toBe("Approve?");
			expect((sentParams.requestedSchema as Record<string, unknown>).type).toBe("object");

			// Simulate client accepting
			const elicitId = sentMsg.id;
			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: elicitId, result: { action: "accept", content: { confirmed: true } } })}\n`);

			const result = await elicitPromise;
			expect(result?.action).toBe("accept");
			expect((result as { action: "accept"; content: Record<string, unknown> }).content.confirmed).toBe(true);
			server.stop();
		});

		it("resolves with decline when client declines", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServerWithElicitation(server, input, output);

			const elicitPromise = server.requestElicitation("Approve?", { type: "object", properties: { confirmed: { type: "boolean" } } });
			const sentMsg = await readResponse(output);
			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: sentMsg.id, result: { action: "decline" } })}\n`);

			const result = await elicitPromise;
			expect(result?.action).toBe("decline");
			server.stop();
		});

		it("normalizes legacy sampling/elicit reject responses to decline", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServerWithElicitation(server, input, output);

			const elicitPromise = server.requestElicitation("Approve?", { type: "object", properties: { confirmed: { type: "boolean" } } });
			const sentMsg = await readResponse(output);
			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: sentMsg.id, result: { action: "reject" } })}\n`);

			const result = await elicitPromise;
			expect(result?.action).toBe("decline");
			server.stop();
		});

		it("resolves with cancel for unknown action", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServerWithElicitation(server, input, output);

			const elicitPromise = server.requestElicitation("Approve?", { type: "object", properties: { confirmed: { type: "boolean" } } });
			const sentMsg = await readResponse(output);
			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: sentMsg.id, result: { action: "cancel" } })}\n`);

			const result = await elicitPromise;
			expect(result?.action).toBe("cancel");
			server.stop();
		});
	});

	describe("confirm tool via elicitation", () => {
		it("routes confirm tool through elicitation when client supports it", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
			await initServerWithElicitation(server, input, output);

			sendRequest(input, 10, "tools/call", { name: "confirm", arguments: { action: "Delete all logs" } });

			// Server sends elicitation request before responding to tools/call
			const elicitMsg = await readResponse(output);
			expect(elicitMsg.method).toBe("sampling/elicit");
			const params = elicitMsg.params as Record<string, unknown>;
			expect(params.message as string).toContain("Delete all logs");

			// Simulate client approving
			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: elicitMsg.id, result: { action: "accept", content: { confirmed: true } } })}\n`);

			const toolResp = await readResponse(output);
			expect(toolResp.id).toBe(10);
			const toolResult = toolResp.result as { content: Array<{ type: string; text: string }> };
			expect(toolResult.content[0].text).toContain("APPROVED");
			server.stop();
		});

		it("returns REJECTED when elicitation client declines confirm", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
			await initServerWithElicitation(server, input, output);

			sendRequest(input, 11, "tools/call", { name: "confirm", arguments: { action: "Send email to all users" } });
			const elicitMsg = await readResponse(output);
			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: elicitMsg.id, result: { action: "decline" } })}\n`);

			const toolResp = await readResponse(output);
			expect(toolResp.id).toBe(11);
			const toolResult = toolResp.result as { content: Array<{ type: string; text: string }> };
			expect(toolResult.content[0].text).toContain("REJECTED");
			server.stop();
		});

		it("falls back to normal confirm tool when client does not support elicitation", async () => {
			// Without elicitation capability, confirm uses the normal path.
			// setConfirmOverride to avoid TTY dependency in test.
			const { setConfirmOverride } = await import("#core/tools/confirm.js");
			setConfirmOverride(async () => ({ approved: false, reason: "test-fallback" }));

			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
			await initServer(server, input, output); // no elicitation capability

			sendRequest(input, 12, "tools/call", { name: "confirm", arguments: { action: "Some action" } });
			const toolResp = await readResponse(output);
			expect(toolResp.id).toBe(12);
			const toolResult = toolResp.result as { content: Array<{ type: string; text: string }> };
			expect(toolResult.content[0].text).toContain("REJECTED");
			expect(toolResult.content[0].text).toContain("test-fallback");

			setConfirmOverride(null);
			server.stop();
		});

		it("uses draft input_required and resumes confirm through tools/call retry", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
			await initDraftServer(server, input, output);
			const queue = createQueuedReader(output);

			sendRequest(input, 20, "tools/call", draftRequestParams({
				name: "confirm",
				arguments: { action: "Rotate signing key", risk: "high" },
			}, { elicitation: {} }));
			const firstResp = await queue.read();

			expect(firstResp.id).toBe(20);
			const inputRequired = firstResp.result as {
				resultType: string;
				inputRequests: {
					confirm: {
						method: string;
						params: {
							mode: string;
							message: string;
							requestedSchema: Record<string, unknown>;
						};
					};
				};
				requestState: string;
			};
			expect(inputRequired.resultType).toBe("input_required");
			expect(inputRequired.inputRequests.confirm.method).toBe("elicitation/create");
			expect(inputRequired.inputRequests.confirm.params.mode).toBe("form");
			expect(inputRequired.inputRequests.confirm.params.message).toContain("Rotate signing key");
			expect(inputRequired.inputRequests.confirm.params.message).toContain("HIGH");
			expect(inputRequired.inputRequests.confirm.params.requestedSchema).toMatchObject({
				type: "object",
				properties: { confirmed: { type: "boolean", title: "Approve?" } },
			});
			expect(inputRequired.requestState.length).toBeGreaterThan(20);
			await expectNoQueuedMessage(queue);

			sendRequest(input, 21, "tools/call", draftRequestParams({
				name: "confirm",
				arguments: { action: "Rotate signing key", risk: "high" },
				inputResponses: {
					confirm: { action: "accept", content: { confirmed: true } },
				},
				requestState: inputRequired.requestState,
			}, { elicitation: {} }));
			const retryResp = await queue.read();

			expect(retryResp.id).toBe(21);
			const result = retryResp.result as {
				resultType: string;
				content: Array<{ type: string; text: string }>;
				isError: boolean;
			};
			expect(result.resultType).toBe("complete");
			expect(result.isError).toBe(false);
			expect(result.content[0].text).toContain("APPROVED: Rotate signing key");

			server.stop();
		});

		it("does not send form input_required to URL-only clients", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
			await initDraftServer(server, input, output);

			sendRequest(input, 26, "tools/call", draftRequestParams({
				name: "confirm",
				arguments: { action: "Rotate signing key", risk: "high" },
			}, { elicitation: { url: {} } }));
			const resp = await readResponse(output);

			expect(resp.result).toBeUndefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Client does not support form elicitation");

			server.stop();
		});

		it("resumes draft confirm decline and cancel responses through tools/call retry", async () => {
			for (const [action, expectedText] of [
				["decline", "REJECTED: Publish incident update"],
				["cancel", "REJECTED: Publish incident update\nReason: Timed out or cancelled"],
			] as const) {
				const { input, output } = createTestStreams();
				const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
				await initDraftServer(server, input, output);

				sendRequest(input, 30, "tools/call", draftRequestParams({
					name: "confirm",
					arguments: { action: "Publish incident update" },
				}, { elicitation: {} }));
				const firstResp = await readResponse(output);
				const inputRequired = firstResp.result as { requestState: string };

				sendRequest(input, 31, "tools/call", draftRequestParams({
					name: "confirm",
					arguments: { action: "Publish incident update" },
					inputResponses: { confirm: { action } },
					requestState: inputRequired.requestState,
				}, { elicitation: {} }));
				const retryResp = await readResponse(output);

				const result = retryResp.result as {
					resultType: string;
					content: Array<{ type: string; text: string }>;
				};
				expect(result.resultType).toBe("complete");
				expect(result.content[0].text).toContain(expectedText);

				server.stop();
			}
		});

		it("rejects malformed draft retry payloads as JSON-RPC protocol errors", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
			await initDraftServer(server, input, output);

			sendRequest(input, 22, "tools/call", draftRequestParams({
				name: "confirm",
				arguments: { action: "Deploy" },
				inputResponses: "not-an-object",
				requestState: "confirm:missing",
			}, { elicitation: {} }));
			const resp = await readResponse(output);

			expect(resp.result).toBeUndefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("inputResponses must be an object");

			server.stop();
		});

		it("rejects invalid draft requestState values as JSON-RPC protocol errors", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
			await initDraftServer(server, input, output);

			sendRequest(input, 23, "tools/call", draftRequestParams({
				name: "confirm",
				arguments: { action: "Deploy" },
				inputResponses: {
					confirm: { action: "decline" },
				},
				requestState: "confirm:missing",
			}, { elicitation: {} }));
			const resp = await readResponse(output);

			expect(resp.result).toBeUndefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("Invalid requestState");

			server.stop();
		});

		it("rejects draft requestState retries whose originating parameters changed", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
			await initDraftServer(server, input, output);

			sendRequest(input, 24, "tools/call", draftRequestParams({
				name: "confirm",
				arguments: { action: "Deploy" },
			}, { elicitation: {} }));
			const firstResp = await readResponse(output);
			const inputRequired = firstResp.result as { requestState: string };

			sendRequest(input, 25, "tools/call", draftRequestParams({
				name: "confirm",
				arguments: { action: "Delete production" },
				inputResponses: {
					confirm: { action: "accept", content: { confirmed: true } },
				},
				requestState: inputRequired.requestState,
			}, { elicitation: {} }));
			const resp = await readResponse(output);

			expect(resp.result).toBeUndefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32602);
			expect(err.message).toContain("requestState does not match requested parameters");

			server.stop();
		});
	});
});

describe("sampling", () => {
	type MockCall = { model: string; messages: unknown[]; system?: unknown };

	function makeMockModelClient(responseText: string, model = "claude-haiku-4-5-20251001") {
		const calls: MockCall[] = [];
		const client: McpServerOptions["modelClient"] = {
			messages: {
				stream: () => { throw new Error("stream not used by sampling"); },
				create: async (params) => {
					calls.push({ model: params.model, messages: params.messages, system: params.system });
					return {
						id: "msg_test_1",
						type: "message",
						role: "assistant",
						model,
						content: [{ type: "text", text: responseText, citations: null }],
						stop_reason: "end_turn",
						stop_sequence: null,
						usage: { input_tokens: 50, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null },
	} as never;
				},
			},
		};
		return { client, calls };
	}

	it("advertises sampling capability when enabled", async () => {
		const { input, output } = createTestStreams();
		const { client } = makeMockModelClient("hello");
		const server = new McpServer({ input, output, log: () => {}, samplingEnabled: true, modelClient: client });

		const resp = await initServer(server, input, output);
		const result = resp.result as Record<string, unknown>;
		const caps = result.capabilities as Record<string, unknown>;
		expect(caps.sampling).toBeDefined();

		server.stop();
	});

	it("does not advertise sampling capability when disabled", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });

		const resp = await initServer(server, input, output);
		const result = resp.result as Record<string, unknown>;
		const caps = result.capabilities as Record<string, unknown>;
		expect(caps.sampling).toBeUndefined();

		server.stop();
	});

	it("sampling/createMessage returns completion from model client", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-sampling-test-"));
		const { client, calls } = makeMockModelClient("World!");
		const { input, output } = createTestStreams();
		const server = new McpServer({
			input,
			output,
			log: () => {},
			samplingEnabled: true,
			samplingModel: "claude-haiku-4-5-20251001",
			projectDir,
			modelClient: client,
		});
		await initServer(server, input, output);

		sendRequest(input, 10, "sampling/createMessage", {
			messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
			maxTokens: 256,
		});
		const resp = await readResponse(output);

		expect(resp.id).toBe(10);
		expect(resp.error).toBeUndefined();
		const result = resp.result as { role: string; content: { type: string; text: string }; model: string; stopReason: string };
		expect(result.role).toBe("assistant");
		expect(result.content.type).toBe("text");
		expect(result.content.text).toBe("World!");
		expect(result.model).toBe("claude-haiku-4-5-20251001");
		expect(result.stopReason).toBe("endTurn");

		expect(calls).toHaveLength(1);
		expect(calls[0].model).toBe("claude-haiku-4-5-20251001");

		server.stop();
	});

	it("keeps sampling/createMessage as legacy-only compatibility", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-sampling-draft-"));
		const { client } = makeMockModelClient("draft should not call");
		const { input, output } = createTestStreams();
		const server = new McpServer({
			input,
			output,
			log: () => {},
			samplingEnabled: true,
			projectDir,
			modelClient: client,
		});
		await initDraftServer(server, input, output);

		sendRequest(input, 14, "sampling/createMessage", draftRequestParams({
			messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
			maxTokens: 64,
		}, { sampling: {} }));
		const resp = await readResponse(output);

		expect(resp.result).toBeUndefined();
		const err = resp.error as { code: number; message: string };
		expect(err.code).toBe(-32601);
		expect(err.message).toBe("Method not found: sampling/createMessage");

		server.stop();
	});

	it("sampling/createMessage passes systemPrompt to model", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-sampling-sys-"));
		const { client, calls } = makeMockModelClient("I am helpful.");
		const { input, output } = createTestStreams();
		const server = new McpServer({
			input,
			output,
			log: () => {},
			samplingEnabled: true,
			samplingModel: "claude-haiku-4-5-20251001",
			projectDir,
			modelClient: client,
		});
		await initServer(server, input, output);

		sendRequest(input, 11, "sampling/createMessage", {
			messages: [{ role: "user", content: { type: "text", text: "Who are you?" } }],
			systemPrompt: "You are a helpful assistant.",
			maxTokens: 128,
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		expect(calls[0].system).toBe("You are a helpful assistant.");

		server.stop();
	});

	it("sampling/createMessage returns error when sampling not enabled", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 12, "sampling/createMessage", {
			messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
			maxTokens: 64,
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeDefined();
		const err = resp.error as { code: number; message: string };
		expect(err.code).toBe(-32601);

		server.stop();
	});

	it("sampling/createMessage returns error for empty messages", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-sampling-empty-"));
		const { client } = makeMockModelClient("ok");
		const { input, output } = createTestStreams();
		const server = new McpServer({
			input,
			output,
			log: () => {},
			samplingEnabled: true,
			projectDir,
			modelClient: client,
		});
		await initServer(server, input, output);

		sendRequest(input, 13, "sampling/createMessage", { messages: [], maxTokens: 64 });
		const resp = await readResponse(output);

		expect(resp.error).toBeDefined();
		const err = resp.error as { code: number; message: string };
		expect(err.code).toBe(-32602);

		server.stop();
	});
});

describe("completion/complete", () => {
	type CompletionResponse = {
		completion: { values: string[]; total: number; hasMore: boolean };
	};

	function expectInvalidParams(resp: Record<string, unknown>, message: string): void {
		expect(resp.error).toMatchObject({ code: -32602, message });
	}

	it("returns workflow names for kota-trigger-workflow workflow argument", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 20, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-trigger-workflow" },
			argument: { name: "workflow", value: "" },
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as CompletionResponse;
		expect(Array.isArray(result.completion.values)).toBe(true);
		expect(result.completion.values.length).toBeGreaterThan(0);
		expect(result.completion.total).toBe(result.completion.values.length);
		expect(result.completion.hasMore).toBe(false);
		expect(result.completion.values).toContain("builder");
		expect(result.completion.values).toContain("explorer");

		server.stop();
	});

	it("filters workflow names by partial value", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 21, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-trigger-workflow" },
			argument: { name: "workflow", value: "bui" },
		});
		const resp = await readResponse(output);

		const result = resp.result as CompletionResponse;
		expect(result.completion.values).toContain("builder");
		expect(result.completion.values.every((v) => v.startsWith("bui"))).toBe(true);

		server.stop();
	});

	it("returns recent run IDs for kota-summarize-run run_id argument", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-compl-runs-"));
		mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, projectDir });
		await initServer(server, input, output);

		sendRequest(input, 22, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-summarize-run" },
			argument: { name: "run_id", value: "" },
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as CompletionResponse;
		expect(Array.isArray(result.completion.values)).toBe(true);
		expect(result.completion.total).toBe(result.completion.values.length);
		expect(result.completion.hasMore).toBe(false);

		server.stop();
	});

	it("returns finite contextual prompt completions after validating context arguments", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 23, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-create-task" },
			argument: { name: "priority", value: "p" },
			context: { arguments: { title: "Fix MCP completion", area: "modules" } },
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as CompletionResponse;
		expect(result.completion).toEqual({
			values: ["p1", "p2", "p3"],
			total: 3,
			hasMore: false,
		});

		server.stop();
	});

	it("returns empty list for non-completable prompt arguments", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 24, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-create-task" },
			argument: { name: "title", value: "fix" },
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as CompletionResponse;
		expect(result.completion).toEqual({ values: [], total: 0, hasMore: false });

		server.stop();
	});

	it("returns empty list for known non-completable resource references", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 25, "completion/complete", {
			ref: { type: "ref/resource", uri: "kota://workflow/status" },
			argument: { name: "anything", value: "" },
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as CompletionResponse;
		expect(result.completion).toEqual({ values: [], total: 0, hasMore: false });

		server.stop();
	});

	it("rejects malformed completion params with invalid params errors", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 26, "completion/complete", {});
		expectInvalidParams(await readResponse(output), "Missing required parameter: ref");

		sendRequest(input, 27, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-create-task" },
		});
		expectInvalidParams(await readResponse(output), "Missing required parameter: argument");

		sendRequest(input, 28, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-create-task" },
			argument: { name: "priority" },
		});
		expectInvalidParams(await readResponse(output), "argument.value must be a string");

		sendRequest(input, 29, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-create-task" },
			argument: { name: "priority", value: "" },
			context: { arguments: { title: 42 } },
		});
		expectInvalidParams(await readResponse(output), "context.arguments.title must be a string");

		server.stop();
	});

	it("rejects unknown prompt and resource references", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 30, "completion/complete", {
			ref: { type: "ref/prompt", name: "not-a-prompt" },
			argument: { name: "workflow", value: "" },
		});
		expectInvalidParams(await readResponse(output), "Unknown prompt reference: not-a-prompt");

		sendRequest(input, 31, "completion/complete", {
			ref: { type: "ref/resource", uri: "kota://not-a-resource" },
			argument: { name: "state", value: "" },
		});
		expectInvalidParams(await readResponse(output), "Unknown resource reference: kota://not-a-resource");

		server.stop();
	});

	it("bounds completion results and reports total matches", async () => {
		const workflowDefs: ReturnType<ModuleLoader["getContributedWorkflows"]> = Array.from({ length: 105 }, (_value, index) => ({
			name: `workflow-${String(index).padStart(3, "0")}`,
			triggers: [],
			steps: [],
			enabled: true,
			moduleRoot: "",
			recoveryCapable: false,
			tags: [],
			definitionPath: "",
		}));
		const loader = new ModuleLoader({});
		vi.spyOn(loader, "getContributedWorkflows").mockReturnValue(workflowDefs);
		vi.mocked(loadModuleMetadata).mockResolvedValueOnce(loader);
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 32, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-trigger-workflow" },
			argument: { name: "workflow", value: "workflow-" },
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as CompletionResponse;
		expect(result.completion.values).toHaveLength(100);
		expect(result.completion.total).toBe(105);
		expect(result.completion.hasMore).toBe(true);
		expect(result.completion.values[0]).toBe("workflow-000");
		expect(result.completion.values.at(-1)).toBe("workflow-099");

		server.stop();
	});

	describe("roots", () => {
		async function initServerWithRoots(
			server: McpServer,
			input: PassThrough,
			output: PassThrough,
		): Promise<{ initResp: Record<string, unknown>; queue: ReturnType<typeof createQueuedReader> }> {
			// Set up the queued reader BEFORE starting the server so no writes are missed.
			const queue = createQueuedReader(output);
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: "2024-11-05",
				capabilities: { roots: {} },
				clientInfo: { name: "test", version: "1.0.0" },
			});
			const initResp = await queue.read();
			sendNotification(input, "notifications/initialized");
			// Server defers fetchClientRoots via setImmediate — wait for it before returning.
			await new Promise((r) => setImmediate(r));
			return { initResp, queue };
		}

		async function initDraftServerWithRoots(
			server: McpServer,
			input: PassThrough,
			output: PassThrough,
		): Promise<{ initResp: Record<string, unknown>; queue: ReturnType<typeof createQueuedReader> }> {
			const queue = createQueuedReader(output);
			await server.start();
			sendRequest(input, 1, "initialize", {
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: { roots: {} },
				clientInfo: { name: "test", version: "1.0.0" },
			});
			const initResp = await queue.read();
			sendNotification(input, "notifications/initialized");
			await new Promise((r) => setImmediate(r));
			return { initResp, queue };
		}

		it("advertises roots capability in initialize response", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });

			const resp = await initServer(server, input, output);
			const result = resp.result as Record<string, unknown>;
			const caps = result.capabilities as Record<string, unknown>;
			expect(caps.roots).toEqual({});

			server.stop();
		});

		it("requests roots/list from client when client declares roots capability", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });

			const { queue } = await initServerWithRoots(server, input, output);

			// Server should have sent a roots/list request after initialization
			const rootsReq = await queue.read();
			expect(rootsReq.method).toBe("roots/list");
			expect(rootsReq.id).toBeDefined();

			server.stop();
		});

		it("does not send standalone roots/list after draft initialize or root-change notifications", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });

			const { queue } = await initDraftServerWithRoots(server, input, output);

			await expectNoQueuedMessage(queue);
			sendNotification(input, "notifications/roots/list_changed");
			await new Promise((r) => setImmediate(r));
			await expectNoQueuedMessage(queue);

			server.stop();
		});

		it("stores roots returned by client and exposes via getClientRoots()", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });

			const { queue } = await initServerWithRoots(server, input, output);

			// Read the roots/list request the server sent
			const rootsReq = await queue.read();
			expect(rootsReq.method).toBe("roots/list");

			// Respond with roots
			const roots = [
				{ uri: "file:///workspace/project-a", name: "Project A" },
				{ uri: "file:///workspace/project-b" },
			];
			input.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: rootsReq.id, result: { roots } })}\n`,
			);

			// Small wait for async processing
			await new Promise((r) => setTimeout(r, 50));

			const stored = server.getClientRoots();
			expect(stored).toHaveLength(2);
			expect(stored[0].uri).toBe("file:///workspace/project-a");
			expect(stored[0].name).toBe("Project A");
			expect(stored[1].uri).toBe("file:///workspace/project-b");

			server.stop();
		});

		it("returns empty roots when client does not declare roots capability", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });

			await initServer(server, input, output);

			expect(server.getClientRoots()).toEqual([]);

			server.stop();
		});

		it("updates roots when notifications/roots/list_changed is received", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });

			const { queue } = await initServerWithRoots(server, input, output);

			// Handle initial roots/list request
			const firstReq = await queue.read();
			input.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: firstReq.id, result: { roots: [{ uri: "file:///workspace/old" }] } })}\n`,
			);
			await new Promise((r) => setTimeout(r, 50));
			expect(server.getClientRoots()[0].uri).toBe("file:///workspace/old");

			// Client notifies roots changed — server defers the re-fetch via setImmediate.
			sendNotification(input, "notifications/roots/list_changed");
			await new Promise((r) => setImmediate(r));

			// Server sends another roots/list request (captured by the queue)
			const secondReq = await queue.read();
			expect(secondReq.method).toBe("roots/list");

			// Respond with updated roots
			input.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: secondReq.id, result: { roots: [{ uri: "file:///workspace/new" }] } })}\n`,
			);
			await new Promise((r) => setTimeout(r, 50));

			expect(server.getClientRoots()[0].uri).toBe("file:///workspace/new");

			server.stop();
		});

		it("getEffectiveProjectDir returns first root path when roots are set", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, projectDir: "/default/dir" });

			const { queue } = await initServerWithRoots(server, input, output);

			const rootsReq = await queue.read();
			input.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: rootsReq.id, result: { roots: [{ uri: "file:///workspace/project" }] } })}\n`,
			);
			await new Promise((r) => setTimeout(r, 50));

			expect(server.getEffectiveProjectDir()).toBe("/workspace/project");

			server.stop();
		});

		it("getEffectiveProjectDir falls back to configured projectDir when no roots", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, projectDir: "/default/dir" });

			await initServer(server, input, output);

			expect(server.getEffectiveProjectDir()).toBe("/default/dir");

			server.stop();
		});
	});
});

describe("memory and knowledge resources", () => {
	function makeMemoryEntries(count: number) {
		return Array.from({ length: count }, (_, index) => ({
			id: `memory-${index}`,
			content: `MEMORY_FULL_CONTENT_${index} remember the bounded resource needle ${"x".repeat(40)}`,
			tags: index % 2 === 0 ? ["even"] : ["odd"],
			created: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
		}));
	}

	function makeKnowledgeEntries(count: number) {
		return Array.from({ length: count }, (_, index) => ({
			id: `knowledge-${index}`,
			title: `Knowledge ${index}`,
			content: `KNOWLEDGE_FULL_CONTENT_${index} explains the bounded resource needle ${"y".repeat(40)}`,
			tags: index % 2 === 0 ? ["api"] : ["ops"],
			type: "note",
			status: "active",
			created: `2026-02-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
			updated: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
			meta: { source: `https://example.com/${index}` },
		}));
	}

	function mockMemoryProvider(entries: ReturnType<typeof makeMemoryEntries>, searchEntries = entries) {
		vi.mocked(getMemoryProvider).mockReturnValue({
			list: () => entries,
			save: vi.fn(),
			search: vi.fn(() => searchEntries),
			update: vi.fn(),
			delete: vi.fn(),
			supportsSemanticSearch: vi.fn(() => false),
			semanticSearch: vi.fn(async () => []),
			reindex: vi.fn(async () => ({ indexed: 0, failed: 0, skipped: true })),
		});
	}

	function mockKnowledgeProvider(
		entries: ReturnType<typeof makeKnowledgeEntries>,
		searchEntries = entries,
	) {
		vi.mocked(getKnowledgeProvider).mockReturnValue({
			list: () => entries,
			read: (id: string) => entries.find((entry) => entry.id === id) ?? null,
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			search: vi.fn(() => searchEntries),
			count: vi.fn(),
			supportsSemanticSearch: vi.fn(() => false),
			semanticSearch: vi.fn(async () => []),
			reindex: vi.fn(async () => ({ indexed: 0, failed: 0, skipped: true })),
		});
	}

	function resourceJson(resp: Record<string, unknown>) {
		const result = resp.result as { contents: Array<{ text: string }> };
		return JSON.parse(result.contents[0].text) as Record<string, unknown>;
	}

	it("resources/list includes kota://memory and kota://knowledge", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/list");
		const resp = await readResponse(output);

		const result = resp.result as { resources: Array<{ uri: string }>; nextCursor?: string };
		const uris = result.resources.map((r) => r.uri);
		if (result.nextCursor) {
			sendRequest(input, 3, "resources/list", { cursor: result.nextCursor });
			const nextResp = await readResponse(output);
			const nextResult = nextResp.result as { resources: Array<{ uri: string }> };
			uris.push(...nextResult.resources.map((r) => r.uri));
		}
		expect(uris).toContain("kota://memory");
		expect(uris).toContain("kota://knowledge");

		server.stop();
	});

	it("resources/read kota://memory returns a bounded shallow index with explicit pagination", async () => {
		mockMemoryProvider(makeMemoryEntries(55));

		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "kota://memory" });
		const resp = await readResponse(output);

		expect(resp.id).toBe(2);
		const result = resp.result as { contents: Array<{ uri: string; mimeType: string; text: string }> };
		expect(result.contents).toHaveLength(1);
		expect(result.contents[0].uri).toBe("kota://memory");
		expect(result.contents[0].mimeType).toBe("application/json");
		expect(result.contents[0].text).not.toContain("MEMORY_FULL_CONTENT");
		const body = JSON.parse(result.contents[0].text) as {
			kind: string;
			entries: Array<Record<string, unknown>>;
			nextCursor: string | null;
			limit: number;
			totalEntries: number;
			searchUriTemplate: string;
		};
		expect(body.kind).toBe("memory.index");
		expect(body.entries).toHaveLength(50);
		expect(body.entries[0].id).toBe("memory-0");
		expect(body.entries[0].content).toBeUndefined();
		expect(typeof body.entries[0].readUri).toBe("string");
		expect(body.nextCursor).toEqual(expect.any(String));
		expect(body.limit).toBe(50);
		expect(body.totalEntries).toBe(55);
		expect(body.searchUriTemplate).toBe("kota://memory/search?q={query}");

		sendRequest(input, 3, "resources/read", { uri: `kota://memory?cursor=${body.nextCursor}` });
		const pageResp = await readResponse(output);
		const pageBody = resourceJson(pageResp) as {
			entries: Array<Record<string, unknown>>;
			nextCursor: string | null;
			cursor: string | null;
		};
		expect(pageBody.entries).toHaveLength(5);
		expect(pageBody.entries[0].id).toBe("memory-50");
		expect(pageBody.cursor).toBe(body.nextCursor);
		expect(pageBody.nextCursor).toBeNull();

		server.stop();
	});

	it("resources/read memory entry URIs returns bounded content only through the explicit read path", async () => {
		const entries = makeMemoryEntries(2);
		entries[1] = {
			...entries[1],
			content: `${"a".repeat(12_000)}tail`,
		};
		mockMemoryProvider(entries);

		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "kota://memory" });
		const resp = await readResponse(output);
		const index = resourceJson(resp) as { entries: Array<{ readUri: string }> };

		sendRequest(input, 3, "resources/read", { uri: index.entries[0].readUri });
		const entryResp = await readResponse(output);
		const entry = resourceJson(entryResp);
		expect(entry.kind).toBe("memory.entry");
		expect(entry.id).toBe("memory-0");
		expect(entry.content).toContain("MEMORY_FULL_CONTENT_0");
		expect(entry.contentTruncated).toBe(false);

		sendRequest(input, 4, "resources/read", { uri: index.entries[1].readUri });
		const largeResp = await readResponse(output);
		const largeEntry = resourceJson(largeResp);
		expect(String(largeEntry.content)).toHaveLength(12_000);
		expect(largeEntry.contentTruncated).toBe(true);
		expect(largeEntry.contentCharLimit).toBe(12_000);
		expect(largeEntry.availableChars).toBe(12_004);

		server.stop();
	});

	it("resources/read memory search returns bounded snippet hits with follow-up read URIs", async () => {
		const entries = makeMemoryEntries(3);
		const searchEntries = makeMemoryEntries(12);
		mockMemoryProvider(entries, searchEntries);

		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "kota://memory/search?q=needle" });
		const resp = await readResponse(output);

		expect(resp.id).toBe(2);
		const body = resourceJson(resp) as {
			kind: string;
			query: string;
			hits: Array<Record<string, unknown>>;
			nextCursor: string | null;
			limit: number;
			totalHits: number;
		};
		expect(body.kind).toBe("memory.search");
		expect(body.query).toBe("needle");
		expect(body.hits).toHaveLength(10);
		expect(body.hits[0].snippet).toContain("needle");
		expect(body.hits[0].content).toBeUndefined();
		expect(typeof body.hits[0].readUri).toBe("string");
		expect(body.nextCursor).toEqual(expect.any(String));
		expect(body.limit).toBe(10);
		expect(body.totalHits).toBe(12);

		server.stop();
	});

	it("resources/read knowledge supports bounded index, explicit reads, and bounded search snippets", async () => {
		const entries = makeKnowledgeEntries(54);
		mockKnowledgeProvider(entries, makeKnowledgeEntries(11));

		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "kota://knowledge" });
		const resp = await readResponse(output);
		const indexResult = resp.result as { contents: Array<{ text: string }> };
		expect(indexResult.contents[0].text).not.toContain("KNOWLEDGE_FULL_CONTENT");
		const index = JSON.parse(indexResult.contents[0].text) as {
			kind: string;
			entries: Array<Record<string, unknown>>;
			nextCursor: string | null;
			totalEntries: number;
		};
		expect(index.kind).toBe("knowledge.index");
		expect(index.entries).toHaveLength(50);
		expect(index.entries[0].title).toBe("Knowledge 0");
		expect(index.entries[0].content).toBeUndefined();
		expect(typeof index.entries[0].readUri).toBe("string");
		expect(index.nextCursor).toEqual(expect.any(String));
		expect(index.totalEntries).toBe(54);

		sendRequest(input, 3, "resources/read", { uri: index.entries[0].readUri });
		const entryResp = await readResponse(output);
		const entry = resourceJson(entryResp);
		expect(entry.kind).toBe("knowledge.entry");
		expect(entry.id).toBe("knowledge-0");
		expect(entry.content).toContain("KNOWLEDGE_FULL_CONTENT_0");
		expect(entry.contentTruncated).toBe(false);

		sendRequest(input, 4, "resources/read", { uri: "kota://knowledge/search?q=needle" });
		const searchResp = await readResponse(output);
		const search = resourceJson(searchResp) as {
			kind: string;
			hits: Array<Record<string, unknown>>;
			nextCursor: string | null;
			totalHits: number;
		};
		expect(search.kind).toBe("knowledge.search");
		expect(search.hits).toHaveLength(10);
		expect(search.hits[0].title).toBe("Knowledge 0");
		expect(search.hits[0].snippet).toContain("needle");
		expect(search.hits[0].content).toBeUndefined();
		expect(typeof search.hits[0].readUri).toBe("string");
		expect(search.nextCursor).toEqual(expect.any(String));
		expect(search.totalHits).toBe(11);

		server.stop();
	});

	it("resources/read rejects malformed and out-of-range memory and knowledge resource inputs", async () => {
		mockMemoryProvider(makeMemoryEntries(55));
		mockKnowledgeProvider(makeKnowledgeEntries(1));

		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "kota://memory/search" });
		const missingQueryResp = await readResponse(output);
		expect(missingQueryResp.error).toMatchObject({
			code: -32602,
			message: "Missing required memory search query: q",
		});

		sendRequest(input, 3, "resources/read", { uri: "kota://knowledge?cursor=not-a-cursor" });
		const badCursorResp = await readResponse(output);
		expect(badCursorResp.error).toMatchObject({
			code: -32602,
			message: "Invalid knowledge cursor",
		});

		sendRequest(input, 4, "resources/read", { uri: "kota://memory" });
		const indexResp = await readResponse(output);
		const index = resourceJson(indexResp) as { nextCursor: string };
		mockMemoryProvider(makeMemoryEntries(3));
		sendRequest(input, 5, "resources/read", { uri: `kota://memory?cursor=${index.nextCursor}` });
		const outOfRangeResp = await readResponse(output);
		expect(outOfRangeResp.error).toMatchObject({
			code: -32602,
			message: "Memory index cursor is out of range",
		});

		sendRequest(input, 6, "resources/read", { uri: "kota://knowledge/entry/not@base64" });
		const badEntryResp = await readResponse(output);
		expect(badEntryResp.error).toMatchObject({
			code: -32602,
			message: "Invalid knowledge entry id",
		});

		server.stop();
	});
});
