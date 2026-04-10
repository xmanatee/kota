import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import { getToolMcpAnnotations } from "../guardrails-classify.js";
import { ModuleLoader } from "../module-loader.js";
import filesystemModule from "../modules/filesystem/index.js";
import { clearCustomTools, registerTool } from "../tools/index.js";
import { anthropicToMcp, McpServer, type McpServerOptions, toolResultToMcp } from "./server.js";

vi.mock("../modules/providers/index.js", () => ({
	getMemoryProvider: vi.fn(() => ({ list: () => [] })),
	getKnowledgeProvider: vi.fn(() => ({ list: () => [] })),
}));

vi.mock("../module-metadata.js", () => ({
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

import { getKnowledgeProvider, getMemoryProvider } from "../modules/providers/index.js";

beforeAll(async () => {
	const loader = new ModuleLoader({});
	await loader.loadAll([filesystemModule]);

	// Register stub for github read tool so MCP annotation tests can verify
	// that module-declared safe network tools get readOnlyHint: true.
	// This mirrors what the github module does when loaded with a real token.
	registerTool(
		{ name: "github_list_prs", description: "stub", input_schema: { type: "object", properties: {} } },
		async () => ({ content: "" }),
		"github",
		{ risk: "safe", kind: "discovery" },
	);
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

/**
 * Creates a queued reader for a stream that captures all output into a buffer.
 * Unlike readResponse(), this never misses writes that occur while no listener
 * is attached (which happens after readResponse() removes its listener but the
 * stream stays in flowing mode).
 */
function createQueuedReader(stream: PassThrough): { read: () => Promise<Record<string, unknown>> } {
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
		read(): Promise<Record<string, unknown>> {
			if (buffer.length > 0) return Promise.resolve(JSON.parse(buffer.shift()!));
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					const idx = waiters.findIndex((w) => w.resolve === resolve);
					if (idx >= 0) waiters.splice(idx, 1);
					reject(new Error("Timeout reading response"));
				}, 2000);
				waiters.push({ resolve, timer });
			});
		},
	};
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
	});

	describe("tools/list", () => {
		it("returns tools after initialization", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServer(server, input, output);

			sendRequest(input, 2, "tools/list");
			const resp = await readResponse(output);

			expect(resp.id).toBe(2);
			const result = resp.result as { tools: unknown[] };
			expect(Array.isArray(result.tools)).toBe(true);
			expect(result.tools.length).toBeGreaterThan(0);

			// Verify MCP tool format
			const firstTool = result.tools[0] as Record<string, unknown>;
			expect(firstTool).toHaveProperty("name");
			expect(firstTool).toHaveProperty("inputSchema");
			// MCP uses inputSchema, not input_schema
			expect(firstTool).not.toHaveProperty("input_schema");

			server.stop();
		});

		it("rejects tools/list before initialization", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "tools/list");
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number; message: string };
			expect(err.code).toBe(-32002);
			expect(err.message).toContain("not initialized");

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
					},
					{
						tool: {
							name: "ext_secret",
							description: "Filtered module tool",
							input_schema: { type: "object" as const, properties: {}, required: [] },
						},
						runner: async () => ({ content: "secret" }),
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
						runner: async (args) => ({ content: `Hello, ${args.name}!` }),
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

	it("resources/list returns three KOTA resources", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/list");
		const resp = await readResponse(output);

		expect(resp.id).toBe(2);
		const result = resp.result as { resources: Array<{ uri: string }> };
		expect(Array.isArray(result.resources)).toBe(true);
		const uris = result.resources.map((r) => r.uri);
		expect(uris).toContain("kota://tasks/ready");
		expect(uris).toContain("kota://workflow/status");
		expect(uris).toContain("kota://workflow/runs/recent");

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
		};
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

	it("resources/list rejects before initialization", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await server.start();

		sendRequest(input, 1, "resources/list");
		const resp = await readResponse(output);

		expect(resp.error).toBeDefined();
		const err = resp.error as { code: number };
		expect(err.code).toBe(-32002);

		server.stop();
	});
});

describe("anthropicToMcp", () => {
	it("converts Anthropic tool to MCP format", () => {
		const tool = {
			name: "test_tool",
			description: "A test tool",
			input_schema: {
				type: "object" as const,
				properties: { arg1: { type: "string" } },
				required: ["arg1"],
			},
		};

		const mcp = anthropicToMcp(tool);

		expect(mcp.name).toBe("test_tool");
		expect(mcp.description).toBe("A test tool");
		expect(mcp.inputSchema).toEqual({
			type: "object",
			properties: { arg1: { type: "string" } },
			required: ["arg1"],
		});
		// MCP uses inputSchema (camelCase), not input_schema (snake_case)
		expect(mcp).not.toHaveProperty("input_schema");
	});

	it("handles missing description", () => {
		const tool = {
			name: "no_desc",
			input_schema: { type: "object" as const, properties: {} },
		};

		const mcp = anthropicToMcp(tool);
		expect(mcp.description).toBe("");
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
				{ type: "text", text: "line 1" },
				{
					type: "image",
					source: { type: "base64", media_type: "image/png", data: "abc123" },
				},
			],
		});

		expect(content).toHaveLength(2);
		expect(content[0]).toEqual({ type: "text", text: "line 1" });
		expect(content[1]).toEqual({ type: "image", data: "abc123", mimeType: "image/png" });
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
			const result = resp.result as { prompts: Array<{ name: string; description: string }> };
			expect(Array.isArray(result.prompts)).toBe(true);
			const names = result.prompts.map((p) => p.name);
			expect(names).toContain("kota-create-task");
			expect(names).toContain("kota-trigger-workflow");
			expect(names).toContain("kota-summarize-run");

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

		it("rejects prompts/list before initialization", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "prompts/list");
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number };
			expect(err.code).toBe(-32002);

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

		it("rejects prompts/get before initialization", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await server.start();

			sendRequest(input, 1, "prompts/get", { name: "kota-create-task" });
			const resp = await readResponse(output);

			expect(resp.error).toBeDefined();
			const err = resp.error as { code: number };
			expect(err.code).toBe(-32002);

			server.stop();
		});
	});
});

describe("resource subscriptions", () => {
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

	it("sends notifications/resources/updated when workflow.completed fires for subscribed URI", async () => {
		const bus = new EventBus();
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {}, eventBus: bus });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/subscribe", { uri: "kota://workflow/status" });
		await readResponse(output);

		const notifPromise = readNotification(output);
		bus.emit("workflow.completed", {
			workflow: "builder",
			runId: "test-run-id",
			status: "success",
			triggerEvent: "runtime.idle",
			durationMs: 1000,
			definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
			runDir: ".kota/runs/test-run-id",
		});

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

		bus.emit("workflow.completed", {
			workflow: "builder",
			runId: "test-run-id",
			status: "success",
			triggerEvent: "runtime.idle",
			durationMs: 1000,
			definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
			runDir: ".kota/runs/test-run-id",
		});

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

		it("resolves with reject when client rejects", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {} });
			await initServerWithElicitation(server, input, output);

			const elicitPromise = server.requestElicitation("Approve?", { type: "object", properties: { confirmed: { type: "boolean" } } });
			const sentMsg = await readResponse(output);
			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: sentMsg.id, result: { action: "reject" } })}\n`);

			const result = await elicitPromise;
			expect(result?.action).toBe("reject");
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

		it("returns REJECTED when elicitation client rejects confirm", async () => {
			const { input, output } = createTestStreams();
			const server = new McpServer({ input, output, log: () => {}, toolFilter: ["confirm"] });
			await initServerWithElicitation(server, input, output);

			sendRequest(input, 11, "tools/call", { name: "confirm", arguments: { action: "Send email to all users" } });
			const elicitMsg = await readResponse(output);
			input.write(`${JSON.stringify({ jsonrpc: "2.0", id: elicitMsg.id, result: { action: "reject" } })}\n`);

			const toolResp = await readResponse(output);
			expect(toolResp.id).toBe(11);
			const toolResult = toolResp.result as { content: Array<{ type: string; text: string }> };
			expect(toolResult.content[0].text).toContain("REJECTED");
			server.stop();
		});

		it("falls back to normal confirm tool when client does not support elicitation", async () => {
			// Without elicitation capability, confirm uses the normal path.
			// setConfirmOverride to avoid TTY dependency in test.
			const { setConfirmOverride } = await import("../tools/confirm.js");
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
		const result = resp.result as { completion: { values: string[]; hasMore: boolean } };
		expect(Array.isArray(result.completion.values)).toBe(true);
		expect(result.completion.values.length).toBeGreaterThan(0);
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

		const result = resp.result as { completion: { values: string[] } };
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
		const result = resp.result as { completion: { values: string[]; hasMore: boolean } };
		expect(Array.isArray(result.completion.values)).toBe(true);
		expect(result.completion.hasMore).toBe(false);

		server.stop();
	});

	it("returns empty list for non-completable prompt arguments", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 23, "completion/complete", {
			ref: { type: "ref/prompt", name: "kota-create-task" },
			argument: { name: "title", value: "fix" },
		});
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as { completion: { values: string[] } };
		expect(result.completion.values).toEqual([]);

		server.stop();
	});

	it("returns empty list when ref or argument is missing", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 24, "completion/complete", {});
		const resp = await readResponse(output);

		expect(resp.error).toBeUndefined();
		const result = resp.result as { completion: { values: string[] } };
		expect(result.completion.values).toEqual([]);

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
	it("resources/list includes kota://memory and kota://knowledge", async () => {
		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/list");
		const resp = await readResponse(output);

		const result = resp.result as { resources: Array<{ uri: string }> };
		const uris = result.resources.map((r) => r.uri);
		expect(uris).toContain("kota://memory");
		expect(uris).toContain("kota://knowledge");

		server.stop();
	});

	it("resources/read kota://memory returns JSON array of memory entries", async () => {
		vi.mocked(getMemoryProvider).mockReturnValue({
			list: () => [{ id: "m1", content: "Remember this", tags: ["important"], created: "2026-01-01T00:00:00Z" }],
			save: vi.fn(),
			search: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		});

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
		const entries = JSON.parse(result.contents[0].text) as Array<Record<string, unknown>>;
		expect(entries).toHaveLength(1);
		expect(entries[0].id).toBe("m1");
		expect(entries[0].content).toBe("Remember this");
		expect(entries[0].tags).toEqual(["important"]);
		expect(entries[0].createdAt).toBe("2026-01-01T00:00:00Z");

		server.stop();
	});

	it("resources/read kota://memory returns empty array when no entries", async () => {
		vi.mocked(getMemoryProvider).mockReturnValue({
			list: () => [],
			save: vi.fn(),
			search: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		});

		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "kota://memory" });
		const resp = await readResponse(output);

		const result = resp.result as { contents: Array<{ text: string }> };
		const entries = JSON.parse(result.contents[0].text);
		expect(entries).toEqual([]);

		server.stop();
	});

	it("resources/read kota://knowledge returns JSON array of knowledge entries", async () => {
		vi.mocked(getKnowledgeProvider).mockReturnValue({
			list: () => [
				{
					id: "k1",
					title: "API Docs",
					content: "The API does X.",
					tags: ["api"],
					type: "note",
					status: "active",
					created: "2026-02-01T00:00:00Z",
					updated: "2026-02-01T00:00:00Z",
					meta: { source: "https://example.com" },
				},
			],
			read: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			search: vi.fn(),
			count: vi.fn(),
		});

		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "kota://knowledge" });
		const resp = await readResponse(output);

		expect(resp.id).toBe(2);
		const result = resp.result as { contents: Array<{ uri: string; mimeType: string; text: string }> };
		expect(result.contents).toHaveLength(1);
		expect(result.contents[0].uri).toBe("kota://knowledge");
		expect(result.contents[0].mimeType).toBe("application/json");
		const entries = JSON.parse(result.contents[0].text) as Array<Record<string, unknown>>;
		expect(entries).toHaveLength(1);
		expect(entries[0].id).toBe("k1");
		expect(entries[0].title).toBe("API Docs");
		expect(entries[0].content).toBe("The API does X.");
		expect(entries[0].tags).toEqual(["api"]);
		expect(entries[0].source).toBe("https://example.com");
		expect(entries[0].createdAt).toBe("2026-02-01T00:00:00Z");

		server.stop();
	});

	it("resources/read kota://knowledge returns empty array when no entries", async () => {
		vi.mocked(getKnowledgeProvider).mockReturnValue({
			list: () => [],
			read: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			search: vi.fn(),
			count: vi.fn(),
		});

		const { input, output } = createTestStreams();
		const server = new McpServer({ input, output, log: () => {} });
		await initServer(server, input, output);

		sendRequest(input, 2, "resources/read", { uri: "kota://knowledge" });
		const resp = await readResponse(output);

		const result = resp.result as { contents: Array<{ text: string }> };
		const entries = JSON.parse(result.contents[0].text);
		expect(entries).toEqual([]);

		server.stop();
	});
});
