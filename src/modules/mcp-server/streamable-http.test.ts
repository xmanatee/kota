import { describe, expect, it } from "vitest";
import type { ToolDef } from "#core/modules/module-types.js";
import { networkWriteEffect } from "#core/tools/effect.js";
import {
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_META_CLIENT_CAPABILITIES_KEY,
	MCP_META_CLIENT_INFO_KEY,
	MCP_META_PROTOCOL_VERSION_KEY,
} from "./mcp-protocol-types.js";
import { McpServer } from "./server.js";
import { handleStreamableHttpRequest } from "./streamable-http.js";

function draftParams(params: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		...params,
		_meta: {
			[MCP_META_PROTOCOL_VERSION_KEY]: MCP_DRAFT_PROTOCOL_VERSION,
			[MCP_META_CLIENT_INFO_KEY]: { name: "http-test", version: "1.0.0" },
			[MCP_META_CLIENT_CAPABILITIES_KEY]: {},
		},
	};
}

function request(
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
) {
	return {
		method: "POST",
		url: "/mcp",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			"mcp-protocol-version": MCP_DRAFT_PROTOCOL_VERSION,
			"mcp-method": String(body.method),
			...headers,
		},
		body: JSON.stringify(body),
	};
}

function parseBody(response: { body?: string }): Record<string, unknown> {
	return JSON.parse(response.body ?? "{}") as Record<string, unknown>;
}

function expectNoListChangedCapabilities(capabilities: Record<string, unknown>): void {
	for (const key of ["tools", "resources", "prompts"]) {
		const capability = capabilities[key];
		expect(capability).toBeDefined();
		expect(capability).not.toMatchObject({ listChanged: true });
	}
}

describe("Streamable HTTP MCP transport", () => {
	it("serves discover, tools/list, and tools/call through the existing MCP handlers", async () => {
		let calls = 0;
		const incrementTool: ToolDef = {
			tool: {
				name: "increment_counter",
				description: "increments a test counter",
				input_schema: {
					type: "object",
					properties: {
						amount: { type: "number", "x-mcp-header": "Amount" },
					},
					required: ["amount"],
				},
			},
			runner: async (input) => {
				calls += Number(input.amount);
				return {
					content: `counter=${calls}`,
					structuredContent: { calls },
				};
			},
			effect: networkWriteEffect(),
		};
		const server = new McpServer({ log: () => {}, moduleTools: [incrementTool] });

		const discover = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 1,
			method: "server/discover",
			params: draftParams(),
		}));
		expect(discover.status).toBe(200);
		expect(discover.headers["content-type"]).toBe("application/json");
		const discoverResult = parseBody(discover).result as {
			supportedVersions: string[];
			capabilities: Record<string, unknown>;
		};
		expect(discoverResult.supportedVersions).toEqual([MCP_DRAFT_PROTOCOL_VERSION]);
		expectNoListChangedCapabilities(discoverResult.capabilities);

		const list = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
			params: draftParams(),
		}));
		expect(list.status).toBe(200);
		const tools = (parseBody(list).result as { tools: Array<{ name: string }> }).tools;
		expect(tools.some((tool) => tool.name === "increment_counter")).toBe(true);

		const call = await handleStreamableHttpRequest(server, request(
			{
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: draftParams({
					name: "increment_counter",
					arguments: { amount: 2 },
				}),
			},
			{
				"mcp-name": "increment_counter",
				"mcp-param-amount": "2",
			},
		));
		expect(call.status).toBe(200);
		expect(calls).toBe(2);
		expect(parseBody(call).result).toMatchObject({
			content: [{ type: "text", text: "counter=2" }],
			structuredContent: { calls: 2 },
		});
	});

	it("does not advertise listen-backed list-change capabilities over HTTP initialize", async () => {
		const server = new McpServer({ log: () => {} });
		const initialize = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 5,
			method: "initialize",
			params: draftParams({
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
			}),
		}));
		expect(initialize.status).toBe(200);
		const result = parseBody(initialize).result as {
			capabilities: Record<string, unknown>;
		};
		expectNoListChangedCapabilities(result.capabilities);
	});

	it("rejects mismatched or missing standard headers before dispatch", async () => {
		let calls = 0;
		const server = new McpServer({
			log: () => {},
			moduleTools: [
				{
					tool: {
						name: "counter",
						description: "test",
						input_schema: { type: "object", properties: {} },
					},
					runner: async () => {
						calls += 1;
						return { content: "called" };
					},
					effect: networkWriteEffect(),
				},
			],
		});
		const body = {
			jsonrpc: "2.0",
			id: 10,
			method: "tools/call",
			params: draftParams({ name: "counter", arguments: {} }),
		};

		const missingVersion = await handleStreamableHttpRequest(server, request(
			body,
			{ "mcp-protocol-version": "" },
		));
		expect(missingVersion.status).toBe(400);
		expect((parseBody(missingVersion).error as { code: number }).code).toBe(-32001);

		const wrongMethod = await handleStreamableHttpRequest(server, request(
			body,
			{ "mcp-name": "counter", "mcp-method": "tools/list" },
		));
		expect(wrongMethod.status).toBe(400);
		expect((parseBody(wrongMethod).error as { code: number }).code).toBe(-32001);

		const wrongName = await handleStreamableHttpRequest(server, request(
			body,
			{ "mcp-name": "other" },
		));
		expect(wrongName.status).toBe(400);
		expect((parseBody(wrongName).error as { code: number; message: string }).code).toBe(-32001);
		expect((parseBody(wrongName).error as { message: string }).message).toContain("Mcp-Name");
		expect(calls).toBe(0);
	});

	it("reports unsupported versions and unknown methods with the HTTP status required by the draft", async () => {
		const server = new McpServer({ log: () => {} });
		const unsupported = await handleStreamableHttpRequest(server, request(
			{
				jsonrpc: "2.0",
				id: 20,
				method: "server/discover",
				params: {
					...draftParams(),
					_meta: {
						...(draftParams()._meta as Record<string, unknown>),
						[MCP_META_PROTOCOL_VERSION_KEY]: "1900-01-01",
					},
				},
			},
			{ "mcp-protocol-version": "1900-01-01" },
		));
		expect(unsupported.status).toBe(400);
		expect(parseBody(unsupported).error).toMatchObject({
			code: -32004,
			message: "Unsupported protocol version",
			data: {
				supported: [MCP_DRAFT_PROTOCOL_VERSION],
				requested: "1900-01-01",
			},
		});

		const unknown = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 21,
			method: "unknown/method",
			params: draftParams(),
		}));
		expect(unknown.status).toBe(404);
		expect(parseBody(unknown).error).toMatchObject({
			code: -32601,
			message: "Method not found: unknown/method",
		});
	});

	it("rejects invalid origins while accepting local browser origins", async () => {
		const server = new McpServer({ log: () => {} });
		const body = {
			jsonrpc: "2.0",
			id: 30,
			method: "server/discover",
			params: draftParams(),
		};

		const local = await handleStreamableHttpRequest(server, request(
			body,
			{ origin: "http://localhost:5173" },
		));
		expect(local.status).toBe(200);

		const remote = await handleStreamableHttpRequest(server, request(
			body,
			{ origin: "https://example.com" },
		));
		expect(remote.status).toBe(403);
		expect(parseBody(remote).error).toMatchObject({
			code: -32001,
		});
	});

	it("does not accept SSE-dependent behavior in the first HTTP slice", async () => {
		const server = new McpServer({ log: () => {} });
		const get = await handleStreamableHttpRequest(server, {
			method: "GET",
			url: "/mcp",
			headers: { accept: "text/event-stream" },
		});
		expect(get.status).toBe(405);

		const listen = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 40,
			method: "subscriptions/listen",
			params: draftParams({ subscriptions: [] }),
		}));
		expect(listen.status).toBe(404);
		expect(parseBody(listen).error).toMatchObject({
			code: -32601,
		});

		const subscribe = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 41,
			method: "resources/subscribe",
			params: draftParams({ uri: "kota://tasks/ready" }),
		}));
		expect(subscribe.status).toBe(404);
		expect(parseBody(subscribe).error).toMatchObject({
			code: -32601,
		});

		const unsubscribe = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 42,
			method: "resources/unsubscribe",
			params: draftParams({ uri: "kota://tasks/ready" }),
		}));
		expect(unsubscribe.status).toBe(404);
		expect(parseBody(unsubscribe).error).toMatchObject({
			code: -32601,
		});

		const progress = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 43,
			method: "tools/list",
			params: {
				...draftParams(),
				_meta: {
					...(draftParams()._meta as Record<string, unknown>),
					progressToken: "p1",
				},
			},
		}));
		expect(progress.status).toBe(400);
		expect(parseBody(progress).error).toMatchObject({
			code: -32602,
		});
	});
});
