import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { ToolDef } from "#core/modules/module-types.js";
import { networkWriteEffect } from "#core/tools/effect.js";
import {
	MCP_DRAFT_PROTOCOL_VERSION,
	MCP_META_CLIENT_CAPABILITIES_KEY,
	MCP_META_CLIENT_INFO_KEY,
	MCP_META_LOG_LEVEL_KEY,
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

function draftParamsWithLogLevel(
	params: Record<string, unknown>,
	logLevel: string,
): Record<string, unknown> {
	const next = draftParams(params);
	(next._meta as Record<string, unknown>)[MCP_META_LOG_LEVEL_KEY] = logLevel;
	return next;
}

function draftParamsWithProgress(
	params: Record<string, unknown>,
	progressToken: string,
): Record<string, unknown> {
	const next = draftParams(params);
	(next._meta as Record<string, unknown>).progressToken = progressToken;
	return next;
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

function parseSseBody(response: { body?: string }): Record<string, unknown>[] {
	const body = response.body ?? "";
	return body
		.trim()
		.split("\n\n")
		.filter(Boolean)
		.map((event) => {
			const data = event.split("\n").find((line) => line.startsWith("data: "));
			expect(data).toBeDefined();
			return JSON.parse(data!.slice("data: ".length)) as Record<string, unknown>;
		});
}

function expectHttpListChangedCapabilities(capabilities: Record<string, unknown>): void {
	expect(capabilities.tools).toEqual({});
	expect(capabilities.resources).toMatchObject({ listChanged: true });
	expect(capabilities.prompts).toMatchObject({ listChanged: true });
}

async function waitForAssertion(assertion: () => void, timeoutMs = 2_000): Promise<void> {
	const started = Date.now();
	let lastError: Error | null = null;
	while (Date.now() - started < timeoutMs) {
		try {
			assertion();
			return;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	}
	throw lastError ?? new Error("Timed out waiting for assertion");
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
		expectHttpListChangedCapabilities(discoverResult.capabilities);

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

	it("advertises listen-backed list-change capabilities over HTTP initialize", async () => {
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
		expectHttpListChangedCapabilities(result.capabilities);
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

	it("serves protected-resource metadata and challenges missing tokens before dispatch", async () => {
		let toolCalls = 0;
		let verifierCalls = 0;
		const server = new McpServer({
			log: () => {},
			moduleTools: [
				{
					tool: {
						name: "protected_tool",
						description: "requires authorization",
						input_schema: { type: "object", properties: {} },
					},
					runner: async () => {
						toolCalls += 1;
						return { content: "authorized" };
					},
					effect: networkWriteEffect(),
				},
			],
		});
		const options = {
			authorization: {
				resource: "https://mcp.example.test/mcp",
				authorizationServers: ["https://auth.example.test"],
				scopesSupported: ["mcp:tools"],
				requiredScopes: ["mcp:tools"],
				tokenVerifier: async () => {
					verifierCalls += 1;
					return {
						ok: true as const,
						audience: "https://mcp.example.test/mcp",
						scopes: ["mcp:tools"],
					};
				},
			},
		};

		const metadata = await handleStreamableHttpRequest(server, {
			method: "GET",
			url: "/.well-known/oauth-protected-resource/mcp",
			headers: {},
		}, options);
		expect(metadata.status).toBe(200);
		expect(parseBody(metadata)).toEqual({
			resource: "https://mcp.example.test/mcp",
			authorization_servers: ["https://auth.example.test"],
			bearer_methods_supported: ["header"],
			scopes_supported: ["mcp:tools"],
		});

		const unauthorized = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 50,
			method: "tools/call",
			params: draftParams({ name: "protected_tool", arguments: {} }),
		}, { "mcp-name": "protected_tool" }), options);

		expect(unauthorized.status).toBe(401);
		expect(unauthorized.headers["www-authenticate"]).toContain("Bearer");
		expect(unauthorized.headers["www-authenticate"]).toContain(
			'resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
		);
		expect(unauthorized.headers["www-authenticate"]).toContain('scope="mcp:tools"');
		expect(verifierCalls).toBe(0);
		expect(toolCalls).toBe(0);
	});

	it("rejects malformed, invalid, wrong-audience, and insufficient-scope tokens before successful scoped dispatch", async () => {
		let calls = 0;
		const server = new McpServer({
			log: () => {},
			moduleTools: [
				{
					tool: {
						name: "protected_counter",
						description: "requires authorization",
						input_schema: { type: "object", properties: {} },
					},
					runner: async () => {
						calls += 1;
						return { content: `calls=${calls}` };
					},
					effect: networkWriteEffect(),
				},
			],
		});
		const options = {
			authorization: {
				resource: "https://mcp.example.test/mcp",
				authorizationServers: ["https://auth.example.test"],
				scopesSupported: ["mcp:tools"],
				requiredScopes: ["mcp:tools"],
				tokenVerifier: async (token: string) => {
					if (token === "valid-token") {
						return {
							ok: true as const,
							audience: "https://mcp.example.test/mcp",
							scopes: ["mcp:tools"],
						};
					}
					if (token === "wrong-audience-token") {
						return {
							ok: true as const,
							audience: "https://other.example.test/mcp",
							scopes: ["mcp:tools"],
						};
					}
					if (token === "narrow-token") {
						return {
							ok: true as const,
							audience: "https://mcp.example.test/mcp",
							scopes: [],
						};
					}
					if (token === "expired-token") {
						return { ok: false as const, reason: "expired" as const };
					}
					return { ok: false as const, reason: "invalid" as const };
				},
			},
		};
		const body = {
			jsonrpc: "2.0",
			id: 51,
			method: "tools/call",
			params: draftParams({ name: "protected_counter", arguments: {} }),
		};

		const malformed = await handleStreamableHttpRequest(server, request(body, {
			authorization: "Basic secret-token",
			"mcp-name": "protected_counter",
		}), options);
		expect(malformed.status).toBe(401);
		expect(malformed.headers["www-authenticate"]).toContain('error="invalid_request"');
		expect(JSON.stringify(malformed)).not.toContain("secret-token");

		const invalid = await handleStreamableHttpRequest(server, request(body, {
			authorization: "Bearer secret-token",
			"mcp-name": "protected_counter",
		}), options);
		expect(invalid.status).toBe(401);
		expect(invalid.headers["www-authenticate"]).toContain('error="invalid_token"');
		expect(JSON.stringify(invalid)).not.toContain("secret-token");

		const expired = await handleStreamableHttpRequest(server, request(body, {
			authorization: "Bearer expired-token",
			"mcp-name": "protected_counter",
		}), options);
		expect(expired.status).toBe(401);
		expect(expired.headers["www-authenticate"]).toContain('error="invalid_token"');

		const wrongAudience = await handleStreamableHttpRequest(server, request(body, {
			authorization: "Bearer wrong-audience-token",
			"mcp-name": "protected_counter",
		}), options);
		expect(wrongAudience.status).toBe(401);
		expect(wrongAudience.headers["www-authenticate"]).toContain('error="invalid_token"');

		const insufficientScope = await handleStreamableHttpRequest(server, request(body, {
			authorization: "Bearer narrow-token",
			"mcp-name": "protected_counter",
		}), options);
		expect(insufficientScope.status).toBe(403);
		expect(insufficientScope.headers["www-authenticate"]).toContain('error="insufficient_scope"');
		expect(insufficientScope.headers["www-authenticate"]).toContain('scope="mcp:tools"');
		expect(calls).toBe(0);

		const authorized = await handleStreamableHttpRequest(server, request(body, {
			authorization: "Bearer valid-token",
			"mcp-name": "protected_counter",
		}), options);
		expect(authorized.status).toBe(200);
		expect(parseBody(authorized).result).toMatchObject({
			content: [{ type: "text", text: "calls=1" }],
		});
		expect(calls).toBe(1);
	});

	it("streams request-scoped log notifications before the final HTTP response when SSE is accepted", async () => {
		const server = new McpServer({
			log: () => {},
			moduleTools: [
				{
					tool: {
						name: "http_logged_tool",
						description: "HTTP logging test",
						input_schema: { type: "object", properties: {} },
					},
					runner: async () => ({ content: "http logged" }),
					effect: networkWriteEffect(),
				},
			],
		});

		const response = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 60,
			method: "tools/call",
			params: draftParamsWithLogLevel({
				name: "http_logged_tool",
				arguments: {},
			}, "info"),
		}, { "mcp-name": "http_logged_tool" }));

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/event-stream");
		const messages: Record<string, unknown>[] = [];
		const unsubscribe = response.stream!.subscribe((message) => {
			messages.push(message as Record<string, unknown>);
		});
		try {
			await waitForAssertion(() => {
				expect(messages[0]).toMatchObject({
					jsonrpc: "2.0",
					method: "notifications/message",
					params: {
						level: "info",
						data: { message: "Calling tool: http_logged_tool" },
					},
				});
				expect(messages[1]).toMatchObject({
					jsonrpc: "2.0",
					id: 60,
					result: expect.objectContaining({
						content: [{ type: "text", text: "http logged" }],
					}),
				});
			});
		} finally {
			unsubscribe();
		}
	});

	it("serves request-scoped progress notifications as a live SSE stream before the final response", async () => {
		let releaseTool!: () => void;
		const toolGate = new Promise<void>((resolve) => {
			releaseTool = resolve;
		});
		const server = new McpServer({
			log: () => {},
			moduleTools: [
				{
					tool: {
						name: "http_progress_tool",
						description: "HTTP progress test",
						input_schema: { type: "object", properties: {} },
					},
					runner: async () => {
						await toolGate;
						return { content: "progress complete" };
					},
					effect: networkWriteEffect(),
				},
			],
		});

		const responsePromise = handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 64,
			method: "tools/call",
			params: draftParamsWithProgress({
				name: "http_progress_tool",
				arguments: {},
			}, "http-progress"),
		}, { "mcp-name": "http_progress_tool" }));

		const response = await Promise.race([
			responsePromise,
			new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20)),
		]);
		expect(response).not.toBe("pending");
		if (response === "pending") throw new Error("HTTP response did not open before tool completion");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/event-stream");
		expect(response.stream).toBeDefined();

		const streamed: Record<string, unknown>[] = [];
		const unsubscribe = response.stream!.subscribe((message) => {
			streamed.push(message as Record<string, unknown>);
		});
		try {
			await waitForAssertion(() => {
				expect(streamed).toContainEqual(expect.objectContaining({
					jsonrpc: "2.0",
					method: "notifications/progress",
					params: {
						progressToken: "http-progress",
						progress: 0,
						total: 1,
						message: "Calling tool: http_progress_tool",
					},
				}));
			});
			releaseTool();
			await waitForAssertion(() => {
				expect(streamed).toContainEqual(expect.objectContaining({
					jsonrpc: "2.0",
					id: 64,
					result: expect.objectContaining({
						content: [{ type: "text", text: "progress complete" }],
					}),
				}));
			});
		} finally {
			unsubscribe();
			releaseTool();
		}
	});

	it("streams request-scoped initialize log notifications before the final HTTP response", async () => {
		const server = new McpServer({ log: () => {} });

		const response = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 63,
			method: "initialize",
			params: draftParamsWithLogLevel({
				protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "http-test", version: "1.0.0" },
			}, "info"),
		}));

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/event-stream");
		const messages: Record<string, unknown>[] = [];
		const unsubscribe = response.stream!.subscribe((message) => {
			messages.push(message as Record<string, unknown>);
		});
		try {
			await waitForAssertion(() => {
				expect(messages[0]).toMatchObject({
					jsonrpc: "2.0",
					method: "notifications/message",
					params: {
						level: "info",
						data: { message: expect.stringContaining("Initialized successfully") },
					},
				});
				expect(messages[1]).toMatchObject({
					jsonrpc: "2.0",
					id: 63,
					result: expect.objectContaining({
						protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
					}),
				});
			});
		} finally {
			unsubscribe();
		}
	});

	it("keeps JSON-only HTTP requests working unless requested logging requires a stream", async () => {
		let calls = 0;
		const server = new McpServer({
			log: () => {},
			moduleTools: [
				{
					tool: {
						name: "http_json_tool",
						description: "HTTP JSON-only logging test",
						input_schema: { type: "object", properties: {} },
					},
					runner: async () => {
						calls += 1;
						return { content: "json result" };
					},
					effect: networkWriteEffect(),
				},
			],
		});
		const body = {
			jsonrpc: "2.0",
			id: 61,
			method: "tools/call",
			params: draftParams({
				name: "http_json_tool",
				arguments: {},
			}),
		};

		const jsonOnly = await handleStreamableHttpRequest(server, request(body, {
			accept: "application/json",
			"mcp-name": "http_json_tool",
		}));
		expect(jsonOnly.status).toBe(200);
		expect(jsonOnly.headers["content-type"]).toBe("application/json");
		expect(parseBody(jsonOnly).result).toMatchObject({
			content: [{ type: "text", text: "json result" }],
		});
		expect(calls).toBe(1);

		const withLogging = await handleStreamableHttpRequest(server, request({
			...body,
			id: 62,
			params: draftParamsWithLogLevel({
				name: "http_json_tool",
				arguments: {},
			}, "info"),
		}, {
			accept: "application/json",
			"mcp-name": "http_json_tool",
		}));
		expect(withLogging.status).toBe(406);
		expect(parseBody(withLogging).error).toMatchObject({
			code: -32602,
			message: "Response stream requires Accept: text/event-stream",
		});
		expect((parseBody(withLogging).error as { message: string }).message).not.toContain("not implemented");
		expect(calls).toBe(1);
	});

	it("serves subscriptions/listen as a live SSE stream for draft resource notifications", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const bus = new EventBus();
		const server = new McpServer({ input, output, log: () => {}, eventBus: bus });
		await server.start();
		const response = await handleStreamableHttpRequest(server, request({
			jsonrpc: "2.0",
			id: 70,
			method: "subscriptions/listen",
			params: draftParams({
				notifications: {
					resourceSubscriptions: ["kota://tasks/ready"],
					resourcesListChanged: true,
					promptsListChanged: true,
				},
			}),
		}));
		try {
			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toBe("text/event-stream");
			const ack = parseSseBody(response);
			expect(ack[0]).toMatchObject({
				jsonrpc: "2.0",
				method: "notifications/subscriptions/acknowledged",
				params: {
					_meta: { "io.modelcontextprotocol/subscriptionId": "70" },
					notifications: {
						resourceSubscriptions: ["kota://tasks/ready"],
						resourcesListChanged: true,
						promptsListChanged: true,
					},
				},
			});
			const streamed: Record<string, unknown>[] = [];
			const unsubscribe = response.stream!.subscribe((message) => {
				streamed.push(message as Record<string, unknown>);
			});
			try {
				bus.emit("task.changed", { counts: { pending: 1, in_progress: 0, done: 0 } });

				await waitForAssertion(() => {
					expect(streamed).toContainEqual(expect.objectContaining({
						jsonrpc: "2.0",
						method: "notifications/resources/updated",
						params: {
							_meta: { "io.modelcontextprotocol/subscriptionId": "70" },
							uri: "kota://tasks/ready",
						},
					}));
				});
				const countAfterFirstEmit = streamed.length;
				unsubscribe();
				bus.emit("task.changed", { counts: { pending: 2, in_progress: 0, done: 0 } });
				await new Promise((resolve) => setTimeout(resolve, 20));
				expect(streamed).toHaveLength(countAfterFirstEmit);
			} finally {
				unsubscribe();
			}
		} finally {
			server.stop();
		}
	});

	it("keeps unsupported HTTP streaming cases explicit", async () => {
		const server = new McpServer({ log: () => {} });
		const get = await handleStreamableHttpRequest(server, {
			method: "GET",
			url: "/mcp",
			headers: { accept: "text/event-stream" },
		});
		expect(get.status).toBe(405);

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
		}, { accept: "application/json" }));
		expect(progress.status).toBe(406);
		expect(parseBody(progress).error).toMatchObject({
			code: -32602,
			message: "Response stream requires Accept: text/event-stream",
		});
	});
});
