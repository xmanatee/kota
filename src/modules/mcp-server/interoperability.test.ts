import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { McpClient } from "#core/mcp/client.js";
import { MCP_HTTP_RESPONSE_BODY_MAX_BYTES } from "#core/mcp/client-response-body-limit.js";
import { networkReadEffect } from "#core/tools/effect.js";
import { McpServer } from "./server.js";
import {
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
	});

	it("lists and calls a production server tool across a real stdio child-process pipe", async () => {
		const stdio = new McpClient({
			type: "stdio",
			command: process.execPath,
			args: ["--conditions=source", "--import", "tsx", STDIO_FIXTURE],
		}, "production-stdio");
		clients.push(stdio);

		await stdio.connect();
		const tools = await stdio.listTools();
		expect(tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "interop_echo" })]));
		const result = completed(await stdio.callTool("interop_echo", { value: stdio.getName() }));
		expect(result.structuredContent).toEqual({ value: stdio.getName() });
	}, 20_000);

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
