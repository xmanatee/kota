import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClient } from "#core/mcp/client.js";
import { MCP_HTTP_RESPONSE_BODY_MAX_BYTES } from "#core/mcp/client-response-body-limit.js";
import { networkReadEffect } from "#core/tools/effect.js";
import { MCP_LEGACY_PROTOCOL_VERSION, MCP_META_CLIENT_CAPABILITIES_KEY, MCP_META_PROTOCOL_VERSION_KEY, MCP_STATELESS_PROTOCOL_VERSION } from "./mcp-protocol-types.js";
import { McpServer } from "./server.js";
import {
  handleStreamableHttpRequest,
	type StartedStreamableHttpServer,
	startMcpStreamableHttpServer,
} from "./streamable-http.js";

const STDIO_FIXTURE = fileURLToPath(new URL("./stdio-interoperability-test-fixture.ts", import.meta.url));

async function supportsLoopbackListeners(): Promise<boolean> {
	const probe = createServer();
	return new Promise((resolve) => {
		probe.once("error", () => resolve(false));
		probe.listen(0, "127.0.0.1", () => probe.close(() => resolve(true)));
	});
}

const httpTest = await supportsLoopbackListeners() ? it : it.skip;

function echoTool(name = "interop_echo") {
	return {
		tool: {
			name,
			description: "Echo over the production MCP server",
			input_schema: {
				type: "object" as const,
				properties: { value: { type: "string" } },
				required: ["value"],
			},
		},
		runner: async (input: Record<string, unknown>) => {
			const value = typeof input.value === "string" ? input.value : "";
			return { content: value, structuredContent: { value } };
		},
		effect: networkReadEffect(),
	};
}

function completed(result: Awaited<ReturnType<McpClient["callTool"]>>) {
	if (result.resultType !== "complete") throw new Error(`Expected complete result, got ${result.resultType}`);
	return result;
}

describe("MCP production client/server interoperability", () => {
	const clients: McpClient[] = [];
	const listeners: StartedStreamableHttpServer[] = [];

	afterEach(async () => {
		await Promise.all(clients.splice(0).map((client) => client.close()));
		await Promise.all(listeners.splice(0).map((listener) => listener.close()));
    vi.restoreAllMocks();
	});

	it("lists and calls a production server tool across a real stdio child-process pipe", async () => {
		const stdio = new McpClient({
			type: "stdio",
			command: process.execPath,
			args: ["--conditions=source", "--import", "tsx", STDIO_FIXTURE],
		}, "production-stdio");
		clients.push(stdio);

		await stdio.connect();
    expect(stdio.getProtocolVersion()).toBe(MCP_STATELESS_PROTOCOL_VERSION);
		const tools = await stdio.listTools();
		expect(tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "interop_echo" })]));
		const result = completed(await stdio.callTool("interop_echo", { value: stdio.getName() }));
		expect(result.structuredContent).toEqual({ value: stdio.getName() });
	}, 20_000);

  it("exchanges released messages through the production HTTP handler, preserving a scalar result and nested routing headers", async () => {
    const base = echoTool("echo_λ");
    const server = new McpServer({ log: () => {}, toolFilter: ["echo_λ"], moduleTools: [{
      ...base,
      tool: { ...base.tool, input_schema: { type: "object", properties: {
        route: { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" } } },
      } }, output_schema: { type: "boolean" } },
      runner: async () => ({content: "false", structuredContent: false}),
    }] });
    const exchanges: {request: Record<string, any>; headers: Headers; response: Record<string, any>}[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      const request = JSON.parse(String(init?.body));
      const response = await handleStreamableHttpRequest(server, {
        method: "POST", url: "/mcp", headers: Object.fromEntries(headers), body: JSON.stringify(request),
      });
      if (response.headers["content-type"] === "application/json") exchanges.push({request, headers, response: JSON.parse(response.body ?? "{}")});
      return new Response(response.body, {status: response.status, headers: response.headers});
    });
    const client = new McpClient({type: "http", url: "https://mcp.example.test/mcp"}, "http-handler");
    clients.push(client);
    await client.connect();
    expect(client.getProtocolVersion()).toBe(MCP_STATELESS_PROTOCOL_VERSION);
    expect((await client.listTools()).map(tool => tool.name)).toEqual(["echo_λ"]);
    expect(completed(await client.callTool("echo_λ", {route: {region: " 東京 "}})).structuredContent).toBe(false);
    const call = exchanges.find(exchange => exchange.request.method === "tools/call")!;
    expect(call.headers.get("Mcp-Name")).toBe("=?base64?ZWNob1/Ouw==?=");
    expect(call.headers.get("Mcp-Param-Region")).toBe("=?base64?IOadseS6rCA=?=");
    expect(call.request.params._meta[MCP_META_PROTOCOL_VERSION_KEY]).toBe(MCP_STATELESS_PROTOCOL_VERSION);
    expect(call.response.result).toMatchObject({resultType: "complete", structuredContent: false});
    const mismatch = await handleStreamableHttpRequest(server, {method: "POST", url: "/mcp", headers: {...Object.fromEntries(call.headers), "mcp-param-region": "wrong"}, body: JSON.stringify(call.request)});
    expect(mismatch.status).toBe(400);
    expect(JSON.parse(mismatch.body ?? "{}").error.code).toBe(-32020);
    expect(exchanges.some(exchange => exchange.request.method === "initialize")).toBe(false);
  });

  it("serves a handshake-free released peer, rejects unsupported versions, and preserves legacy initialization", async () => {
    const server = new McpServer({log: () => {}, toolFilter: ["interop_echo"], moduleTools: [echoTool()]});
    const request = (id: number, method: string, params: Record<string, unknown> = {}, version = MCP_STATELESS_PROTOCOL_VERSION) => server.handleJsonRpcMessage({
      jsonrpc: "2.0", id, method, params: {...params, _meta: {
        [MCP_META_PROTOCOL_VERSION_KEY]: version, [MCP_META_CLIENT_CAPABILITIES_KEY]: {},
      }},
    });
    expect(await request(1, "server/discover")).toMatchObject({kind: "response", response: {result: {
      resultType: "complete", supportedVersions: expect.arrayContaining([MCP_STATELESS_PROTOCOL_VERSION]),
      _meta: {"io.modelcontextprotocol/serverInfo": {name: "kota"}},
    }}});
    expect(await request(2, "tools/call", {name: "interop_echo", arguments: {value: "released peer"}})).toMatchObject({kind: "response", response: {result: {resultType: "complete", structuredContent: {value: "released peer"}}}});
    expect(await request(3, "tools/list", {}, "2099-01-01")).toMatchObject({kind: "response", response: {error: {code: -32022, data: {requested: "2099-01-01", supported: expect.arrayContaining([MCP_STATELESS_PROTOCOL_VERSION])}}}});
    expect(await request(4, "ping")).toMatchObject({kind: "response", response: {error: {code: -32601}}});
    expect(await request(5, "tasks/list")).toMatchObject({kind: "response", response: {error: {code: -32601}}});
    expect(await server.handleJsonRpcMessage({jsonrpc: "2.0", id: 6, method: "initialize", params: {protocolVersion: MCP_LEGACY_PROTOCOL_VERSION, capabilities: {}}})).toMatchObject({kind: "response", response: {result: {protocolVersion: MCP_LEGACY_PROTOCOL_VERSION}}});
    expect(await server.handleJsonRpcMessage({jsonrpc: "2.0", id: 7, method: "tools/call", params: {name: "interop_echo", arguments: {value: "legacy peer"}}})).toMatchObject({kind: "response", response: {result: {structuredContent: {value: "legacy peer"}}}});
  });

  it("rejects schema-invalid arguments before execution and rejects nonconforming structured output", async () => {
    let executions = 0;
    const server = new McpServer({log: () => {}, toolFilter: ["validated"], moduleTools: [{
      tool: {name: "validated", description: "Validate released schemas", input_schema: {type: "object", properties: {count: {type: "integer", minimum: 1}}, required: ["count"]}, output_schema: {allOf: [{type: "boolean"}, {const: true}]}},
      runner: async () => {executions++; return {content: "false", structuredContent: false};}, effect: networkReadEffect(),
    }]});
    const call = (count: number) => server.handleJsonRpcMessage({jsonrpc: "2.0", id: count, method: "tools/call", params: {name: "validated", arguments: {count}, _meta: {[MCP_META_PROTOCOL_VERSION_KEY]: MCP_STATELESS_PROTOCOL_VERSION, [MCP_META_CLIENT_CAPABILITIES_KEY]: {}}}});
    expect(await server.handleJsonRpcMessage({jsonrpc: "2.0", id: "invalid-arguments", method: "tools/call", params: {name: "validated", arguments: [], _meta: {[MCP_META_PROTOCOL_VERSION_KEY]: MCP_STATELESS_PROTOCOL_VERSION, [MCP_META_CLIENT_CAPABILITIES_KEY]: {}}}})).toMatchObject({kind: "response", response: {error: {code: -32602}}});
    expect(await call(0)).toMatchObject({kind: "response", response: {result: {resultType: "complete", isError: true}}});
    expect(executions).toBe(0);
    expect(await call(1)).toMatchObject({kind: "response", response: {error: {code: -32603}}});
    expect(executions).toBe(1);
  });

	httpTest("lists and calls the same production server tool across a real Streamable HTTP listener", async () => {
		const server = new McpServer({ log: () => {}, moduleTools: [echoTool()] });
		const listener = await startMcpStreamableHttpServer({ server });
		listeners.push(listener);
		const client = new McpClient({ type: "http", url: listener.url }, "production-http");
		clients.push(client);
		await client.connect();
		expect((await client.listTools()).some((tool) => tool.name === "interop_echo")).toBe(true);
		const result = completed(await client.callTool("interop_echo", { value: client.getName() }));
		expect(result.structuredContent).toEqual({ value: client.getName() });
	}, 20_000);

	httpTest("enforces HTTP authentication without reflecting bearer credentials", async () => {
		const resource = "http://127.0.0.1/mcp";
		const server = new McpServer({ log: () => {}, moduleTools: [echoTool()] });
		const listener = await startMcpStreamableHttpServer({
			server,
			authorization: {
				resource,
				authorizationServers: ["https://auth.example.test"],
				requiredScopes: ["mcp:read"],
				tokenVerifier: (token) => token === "valid-token"
					? { ok: true, audience: resource, scopes: ["mcp:read"] }
					: { ok: false, reason: "invalid" },
			},
		});
		listeners.push(listener);

		const secret = "invalid-secret-token";
		const unauthorized = new McpClient({
			type: "http",
			url: listener.url,
			headers: { authorization: `Bearer ${secret}` },
		}, "unauthorized-http");
		clients.push(unauthorized);
		let failure: unknown;
		try {
			await unauthorized.connect();
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(Error);
		expect(String(failure)).toContain("authorization");
		expect(String(failure)).not.toContain(secret);

		const authorized = new McpClient({
			type: "http",
			url: listener.url,
			headers: { authorization: "Bearer valid-token" },
		}, "authorized-http");
		clients.push(authorized);
		await authorized.connect();
		expect((await authorized.listTools()).some((tool) => tool.name === "interop_echo")).toBe(true);
	});

	httpTest("rejects a production HTTP tool response beyond the canonical client message limit", async () => {
		const server = new McpServer({
			log: () => {},
			moduleTools: [{
				...echoTool("oversized_result"),
				runner: async () => ({ content: "x".repeat(MCP_HTTP_RESPONSE_BODY_MAX_BYTES + 1) }),
			}],
		});
		const listener = await startMcpStreamableHttpServer({ server });
		listeners.push(listener);
		const client = new McpClient({ type: "http", url: listener.url }, "bounded-http");
		clients.push(client);
		await client.connect();
		await client.listTools();

		await expect(client.callTool("oversized_result", {})).rejects.toThrow(/exceeded \d+ bytes/i);
	}, 20_000);
});
