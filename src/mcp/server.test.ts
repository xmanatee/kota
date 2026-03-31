import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { anthropicToMcp, McpServer, toolResultToMcp } from "./server.js";

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
			expect(result.capabilities).toEqual({ tools: {}, resources: {}, prompts: {} });
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
		mkdirSync(join(dir, "tasks", "ready"), { recursive: true });
		mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
		writeFileSync(
			join(dir, "tasks", "ready", "task-one.md"),
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

	it("resources/read returns tasks/ready content", async () => {
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
