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
			expect(result.capabilities).toEqual({ tools: {} });
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

			sendRequest(input, 2, "resources/list");
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
